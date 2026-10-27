// Tests des routes ajoutées pour le front : lieux, historique d'import, renvoi du lien de suivi.
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount, createAgency } from './factories/accountFactory.js';
import { createClient, createPackage } from './factories/ledgerFactory.js';
import { queuedEmails } from './helpers/emails.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
});

async function sessionAs(role: 'admin' | 'manager' | 'collector') {
  await createAccount({ email: `${role}@bts.test`, role });
  return signIn(app, `${role}@bts.test`);
}

function post(session: TestSession, url: string, body?: object) {
  return request(app)
    .post(url)
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body);
}

describe('lieux du réseau', () => {
  it('donne les lieux actifs et leur agence, sans connexion', async () => {
    await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
    await prisma.location.create({
      data: {
        code: 'XX-OLD',
        name: 'Ancien hub',
        countryCode: 'XX',
        isOrigin: true,
        active: false,
      },
    });

    const response = await request(app).get('/api/v1/locations');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.body.data).toEqual([
      {
        code: 'SN-DKR',
        name: 'Dakar (Sénégal)',
        country_code: 'SN',
        is_origin: false,
        is_destination: true,
        agency: { code: 'SN-DKR', name: 'Dakar (Sénégal)' },
      },
    ]);
  });
});

describe('historique des imports', () => {
  it('garde les empreintes sans doublon, et les réserve à l’équipe', async () => {
    const manager = await sessionAs('manager');
    const collector = await sessionAs('collector');

    await post(manager, '/api/v1/import-fingerprints', {
      entity: 'payments',
      fingerprints: ['a', 'b'],
    });
    await post(manager, '/api/v1/import-fingerprints', {
      entity: 'payments',
      fingerprints: ['b', 'c'],
    });
    const list = await request(app)
      .get('/api/v1/import-fingerprints?entity=payments')
      .set('Cookie', manager.cookie);
    const forbidden = await request(app)
      .get('/api/v1/import-fingerprints?entity=payments')
      .set('Cookie', collector.cookie);
    const unknown = await request(app)
      .get('/api/v1/import-fingerprints?entity=quotes')
      .set('Cookie', manager.cookie);

    expect([...list.body.data].sort()).toEqual(['a', 'b', 'c']);
    expect(forbidden.status).toBe(403);
    expect(unknown.status).toBe(400);
  });
});

describe('renvoi du lien de suivi', () => {
  it('prépare l’e-mail du lien de suivi, ou refuse si le client n’a pas d’adresse', async () => {
    const manager = await sessionAs('manager');
    const withEmail = await createClient({ email: 'client@shop.ci' });
    const withoutEmail = await createClient();
    const pkg = await createPackage({ clientId: withEmail.id, finalPrice: 1000 });
    const silent = await createPackage({ clientId: withoutEmail.id, finalPrice: 1000 });

    const sent = await post(manager, `/api/v1/packages/${pkg.id}/tracking-email`);
    const refused = await post(manager, `/api/v1/packages/${silent.id}/tracking-email`);
    const emails = await queuedEmails();

    expect(sent.status).toBe(202);
    expect(emails).toEqual([
      {
        kind: 'tracking_link',
        to: 'client@shop.ci',
        data: expect.objectContaining({
          trackingNumber: pkg.trackingNumber,
          trackingUrl: `http://localhost:5173/suivi/${pkg.trackingNumber}`,
        }),
      },
    ]);
    expect(refused.body.error.code).toBe('CLIENT_HAS_NO_EMAIL');
  });
});
