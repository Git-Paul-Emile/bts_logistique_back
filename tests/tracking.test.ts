// Tests d'intégration de F7 : suivi public d'un colis, sans connexion.
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount } from './factories/accountFactory.js';
import { createClient, createPackage, createPayment } from './factories/ledgerFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const TRACKING = '/api/v1/tracking';
const TRACKING_LIMIT = 30;

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
});

/** Colis réel avec des données sensibles partout : coordonnées, prix, paiement, commentaire. */
async function trackedPackage() {
  const agent = await createAccount({ name: 'Thomas Lefèvre', email: 'thomas@bts.test' });
  const client = await createClient({
    name: 'Kouassi Import Export',
    phone: '+225 07 99 88 77 66',
    email: 'kouassi@shop.ci',
  });
  const pkg = await createPackage({ clientId: client.id, finalPrice: 91234 });
  await createPayment({
    clientId: client.id,
    amount: 45678,
    allocations: [{ packageId: pkg.id, amount: 45678 }],
  });
  await prisma.packageEvent.create({
    data: {
      packageId: pkg.id,
      status: 'in_transit',
      locationDetail: 'Port de Guangzhou',
      comment: 'Client injoignable, relancer le gérant',
      agentId: agent.id,
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { status: 'in_transit' } });
  return pkg;
}

describe('suivi public', () => {
  it('donne les étapes sans connexion, avec un cache court', async () => {
    const pkg = await trackedPackage();

    const response = await request(app).get(`${TRACKING}/${pkg.trackingNumber}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.body.data).toMatchObject({
      tracking_number: pkg.trackingNumber,
      status: 'in_transit',
      recipient_initials: 'K. I. E.',
      cubic_meter: 0.24,
      events: [{ status: 'in_transit', location_detail: 'Port de Guangzhou' }],
    });
  });

  it('ne renvoie ni coordonnées, ni nom complet, ni montants, ni commentaire interne, ni agent', async () => {
    const pkg = await trackedPackage();

    const response = await request(app).get(`${TRACKING}/${pkg.trackingNumber}`);
    const body = JSON.stringify(response.body);

    for (const secret of [
      'Kouassi',
      '07 99 88',
      'kouassi@shop.ci',
      '91234',
      '45678',
      'injoignable',
      'Thomas',
      'price',
      'amount',
      'margin',
      'payment',
      'client',
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it('accepte un numéro saisi en minuscules ou avec des espaces', async () => {
    const pkg = await trackedPackage();
    const typed = ` ${pkg.trackingNumber.toLowerCase().replace('-2026-', '-2026- ')} `;

    const response = await request(app).get(`${TRACKING}/${encodeURIComponent(typed)}`);

    expect(response.status).toBe(200);
  });

  it('répond exactement pareil pour un numéro inconnu ou mal formé', async () => {
    const unknown = await request(app).get(`${TRACKING}/BTS-CI-2026-999999`);
    const malformed = await request(app).get(`${TRACKING}/n-importe-quoi`);

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(malformed.body);
    expect(unknown.body.error.code).toBe('TRACKING_NOT_FOUND');
  });

  it('bloque les essais de numéros en masse (429)', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= TRACKING_LIMIT; attempt += 1) {
      statuses.push((await request(app).get(`${TRACKING}/BTS-CI-2026-${100000 + attempt}`)).status);
    }

    expect(statuses.slice(0, TRACKING_LIMIT).every((status) => status === 404)).toBe(true);
    expect(statuses[TRACKING_LIMIT]).toBe(429);
  });
});
