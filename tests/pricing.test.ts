// Tests d'intégration de F4 : grille tarifaire historisée et marges réservées à l'administrateur.
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount } from './factories/accountFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const PRICING = '/api/v1/pricing';
const START = new Date('2026-10-22T08:00:00.000Z');
const LATER = new Date('2026-11-05T10:30:00.000Z');

const GRID = {
  rates: {
    sea: { client_rate_per_cbm: 380000, collector_margin_per_cbm: 38500 },
    air: { client_rate_per_cbm: 750000, collector_margin_per_cbm: 61500 },
  },
};

let app: Express;
let now = START;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  now = START;
  vi.spyOn(clock, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function sessionAs(role: 'admin' | 'manager' | 'collector'): Promise<TestSession> {
  const email = `${role}@bts.test`;
  await createAccount({ email, role });
  return signIn(app, email);
}

function put(session: TestSession, body: object) {
  return request(app)
    .put(PRICING)
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body);
}

describe('lecture publique des prix', () => {
  it('signale une grille pas encore renseignée', async () => {
    const response = await request(app).get(PRICING);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRICING_NOT_CONFIGURED');
  });

  it('donne les prix clients sans connexion, jamais les marges, avec un cache court', async () => {
    await put(await sessionAs('admin'), GRID);

    const response = await request(app).get(PRICING);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      rates: { sea: { client_rate_per_cbm: 380000 }, air: { client_rate_per_cbm: 750000 } },
      updated_at: START.toISOString(),
    });
    expect(JSON.stringify(response.body)).not.toMatch(/margin|38500|61500/);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });
});

describe('marges réservées à l’administrateur', () => {
  it.each(['manager', 'collector'] as const)(
    'refuse au rôle %s la lecture et la modification des marges',
    async (role) => {
      await put(await sessionAs('admin'), GRID);
      const session = await sessionAs(role);

      const read = await request(app).get(`${PRICING}/admin`).set('Cookie', session.cookie);
      const write = await put(session, GRID);

      expect(read.status).toBe(403);
      expect(JSON.stringify(read.body)).not.toMatch(/38500|61500/);
      expect(write.status).toBe(403);
    }
  );

  it('refuse les visiteurs sur la vue administrateur', async () => {
    const response = await request(app).get(`${PRICING}/admin`);

    expect(response.status).toBe(401);
  });

  it('donne prix et marges à l’administrateur, sans cache partagé', async () => {
    const admin = await sessionAs('admin');
    await put(admin, GRID);

    const response = await request(app).get(`${PRICING}/admin`).set('Cookie', admin.cookie);

    expect(response.body.data.rates).toEqual(GRID.rates);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('exige le jeton CSRF pour modifier', async () => {
    const admin = await sessionAs('admin');

    const response = await request(app).put(PRICING).set('Cookie', admin.cookie).send(GRID);

    expect(response.status).toBe(403);
  });
});

describe('modification de la grille', () => {
  it('refuse une marge égale ou supérieure au prix, un montant décimal ou un mode absent', async () => {
    const admin = await sessionAs('admin');

    const marginTooHigh = await put(admin, {
      rates: { ...GRID.rates, sea: { client_rate_per_cbm: 1000, collector_margin_per_cbm: 1000 } },
    });
    const decimal = await put(admin, {
      rates: { ...GRID.rates, air: { client_rate_per_cbm: 750000.5, collector_margin_per_cbm: 0 } },
    });
    const missingMode = await put(admin, { rates: { sea: GRID.rates.sea } });

    expect(marginTooHigh.status).toBe(400);
    expect(marginTooHigh.body.error.details).toContainEqual({
      field: 'rates.sea.collector_margin_per_cbm',
      message: 'La marge collecteur doit être inférieure au prix client.',
    });
    expect(decimal.status).toBe(400);
    expect(missingMode.status).toBe(400);
  });

  it('garde l’historique et n’ajoute une ligne que pour le mode qui change', async () => {
    const admin = await sessionAs('admin');
    await put(admin, GRID);

    now = LATER;
    // Deux semaines plus tard, le jeton d'accès de 15 minutes a expiré : on se reconnecte.
    const adminLater = await signIn(app, 'admin@bts.test');
    const updated = await put(adminLater, {
      rates: {
        ...GRID.rates,
        sea: { client_rate_per_cbm: 400000, collector_margin_per_cbm: 40000 },
      },
    });
    const replayed = await put(adminLater, {
      rates: {
        ...GRID.rates,
        sea: { client_rate_per_cbm: 400000, collector_margin_per_cbm: 40000 },
      },
    });
    const history = await prisma.pricingRate.findMany({
      orderBy: { effectiveFrom: 'asc' },
      select: { transportMode: true, clientRatePerCbm: true },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.data.rates.sea.client_rate_per_cbm).toBe(400000);
    expect(updated.body.data.updated_at).toBe(LATER.toISOString());
    expect(replayed.status).toBe(200);
    expect(history.map((rate) => [rate.transportMode, rate.clientRatePerCbm.toNumber()])).toEqual([
      ['sea', 380000],
      ['air', 750000],
      ['sea', 400000],
    ]);
  });
});
