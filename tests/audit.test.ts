// Tests d'intégration du journal d'audit (F13).
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount } from './factories/accountFactory.js';
import { createClient, createPackage } from './factories/ledgerFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const NOW = new Date('2026-10-22T08:00:00.000Z');
const GRID = {
  rates: {
    sea: { client_rate_per_cbm: 380000, collector_margin_per_cbm: 38500 },
    air: { client_rate_per_cbm: 750000, collector_margin_per_cbm: 61500 },
  },
};

let app: Express;
let admin: TestSession;
let adminId: string;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
  adminId = (await createAccount({ email: 'admin@bts.test', role: 'admin', name: 'Awa Admin' })).id;
  admin = await signIn(app, 'admin@bts.test');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function send(
  session: TestSession,
  method: 'post' | 'patch' | 'put' | 'delete',
  url: string,
  body?: object
) {
  const pending = request(app)[method](url);
  return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
}

async function trail(action: string) {
  return prisma.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: 'asc' },
    select: { actorId: true, resourceId: true, before: true, after: true, requestId: true },
  });
}

describe('traces des actions sensibles', () => {
  it('trace un changement de tarifs, avec l’identifiant de la requête', async () => {
    const first = await send(admin, 'put', '/api/v1/pricing', GRID);
    await send(admin, 'put', '/api/v1/pricing', {
      rates: {
        ...GRID.rates,
        sea: { client_rate_per_cbm: 400000, collector_margin_per_cbm: 40000 },
      },
    });
    const entries = await trail('pricing.update');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actorId: adminId,
      resourceId: 'grid',
      before: { sea: null, air: null },
      after: GRID.rates,
      requestId: first.headers['x-request-id'],
    });
    expect(entries[1]?.before).toEqual({ sea: GRID.rates.sea });
  });

  it('trace l’invitation, le changement de rôle, la désactivation et la restauration d’un compte', async () => {
    const invited = (
      await send(admin, 'post', '/api/v1/users', {
        name: 'Koffi',
        email: 'koffi@bts.test',
        role: 'collector',
        agency_code: 'CI-ABJ',
      })
    ).body.data;
    await send(admin, 'patch', `/api/v1/users/${invited.id}`, { role: 'manager' });
    await send(admin, 'patch', `/api/v1/users/${invited.id}/status`, { active: false });
    await prisma.user.update({ where: { id: invited.id }, data: { archivedAt: NOW } });
    await send(admin, 'post', `/api/v1/users/${invited.id}/restore`);

    const [update] = await trail('user.update');
    const [deactivate] = await trail('user.deactivate');
    const [restore] = await trail('user.restore');

    expect(await trail('user.invite')).toHaveLength(1);
    expect(update?.before).toMatchObject({ role: 'collector' });
    expect(update?.after).toMatchObject({ role: 'manager' });
    expect(deactivate).toMatchObject({ before: { active: true }, after: { active: false } });
    expect(restore?.after).toEqual({ archived_at: null });
    const allTraces = JSON.stringify(await prisma.auditLog.findMany());
    expect(allTraces).not.toMatch(/password|hash|token/i);
  });

  it('trace la suppression de son propre compte', async () => {
    await createAccount({ email: 'agent@bts.test' });
    const agent = await signIn(app, 'agent@bts.test');

    await send(agent, 'delete', '/api/v1/me', { password: 'mot-de-passe-solide-2026' });

    expect(await trail('user.archive_self')).toHaveLength(1);
  });

  it('trace l’encaissement et l’annulation d’un paiement', async () => {
    const client = await createClient();
    const pkg = await createPackage({ clientId: client.id, finalPrice: 50000 });
    const payment = (
      await send(admin, 'post', '/api/v1/payments', {
        client_id: client.id,
        amount: 20000,
        method: 'cash',
        allocations: [{ package_id: pkg.id, amount: 20000 }],
      })
    ).body.data;
    const reversal = (
      await send(admin, 'post', `/api/v1/payments/${payment.id}/reversal`, { reason: 'Doublon' })
    ).body.data;

    const [recorded] = await trail('payment.record');
    const [reversed] = await trail('payment.reverse');

    expect(recorded?.after).toMatchObject({
      amount: 20000,
      allocations: [{ package_id: pkg.id, amount: 20000 }],
    });
    expect(reversed).toMatchObject({
      resourceId: payment.id,
      after: { reversed_by: reversal.id, reason: 'Doublon' },
    });
  });

  it('trace la correction d’un colis sans effacer ce qui n’a pas changé', async () => {
    const client = await createClient();
    const pkg = await createPackage({ clientId: client.id, finalPrice: 60000 });
    await prisma.package.update({ where: { id: pkg.id }, data: { description: 'Cartons' } });

    await send(admin, 'patch', `/api/v1/packages/${pkg.id}`, { length_cm: 100 });
    const [entry] = await trail('package.update');

    expect(entry?.before).toMatchObject({ length_cm: 80, description: 'Cartons', weight_kg: 25 });
    expect(entry?.after).toMatchObject({ length_cm: 100, description: 'Cartons', weight_kg: 25 });
  });

  it('n’écrit aucune trace quand l’action est refusée', async () => {
    const response = await send(admin, 'patch', `/api/v1/users/${adminId}`, { role: 'manager' });

    expect(response.body.error.code).toBe('LAST_ADMIN');
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('consultation du journal', () => {
  it('est réservée à l’administrateur et filtre par action et par ressource', async () => {
    await send(admin, 'put', '/api/v1/pricing', GRID);
    const invited = (
      await send(admin, 'post', '/api/v1/users', {
        name: 'Koffi',
        email: 'koffi@bts.test',
        role: 'manager',
        agency_code: 'CI-ABJ',
      })
    ).body.data;
    const manager = await (async () => {
      await createAccount({ email: 'manager@bts.test', role: 'manager' });
      return signIn(app, 'manager@bts.test');
    })();

    const forbidden = await request(app).get('/api/v1/audit-logs').set('Cookie', manager.cookie);
    const all = await request(app).get('/api/v1/audit-logs').set('Cookie', admin.cookie);
    const invites = await request(app)
      .get(`/api/v1/audit-logs?action=user.invite&resource_id=${invited.id}`)
      .set('Cookie', admin.cookie);
    const badAction = await request(app)
      .get('/api/v1/audit-logs?action=n-importe')
      .set('Cookie', admin.cookie);

    expect(forbidden.status).toBe(403);
    expect(all.body.meta.total).toBe(2);
    expect(invites.body.data).toHaveLength(1);
    expect(invites.body.data[0]).toMatchObject({
      action: 'user.invite',
      actor: { id: adminId, name: 'Awa Admin' },
      resource_type: 'user',
    });
    expect(badAction.status).toBe(400);
  });

  it('n’offre aucune route pour modifier ou supprimer une trace', async () => {
    await send(admin, 'put', '/api/v1/pricing', GRID);
    const entry = await prisma.auditLog.findFirstOrThrow();

    const patch = await send(admin, 'patch', `/api/v1/audit-logs/${entry.id}`, { action: 'x' });
    const remove = await send(admin, 'delete', `/api/v1/audit-logs/${entry.id}`);

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});
