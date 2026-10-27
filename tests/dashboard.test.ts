// Tests d'intégration du tableau de bord (F12).
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount, createAgency } from './factories/accountFactory.js';
import { createClient, createPackage, createPayment } from './factories/ledgerFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const DASHBOARD = '/api/v1/dashboard';
const october = (day: number) => new Date(Date.UTC(2026, 9, day, 10));
const september = (day: number) => new Date(Date.UTC(2026, 8, day, 10));

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  vi.spyOn(clock, 'now').mockReturnValue(october(22));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Abidjan : 3 colis en octobre (dont 1 annulé), 1 livré en septembre ; Dakar : 1 colis en
 * octobre. Chaque colis mesure 0,24 m³.
 */
async function seedActivity() {
  await createAgency();
  await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
  const abidjanCollector = await createAccount({ email: 'c-abj@bts.test', role: 'collector' });
  const dakarCollector = await createAccount({
    email: 'c-dkr@bts.test',
    role: 'collector',
    agencyCode: 'SN-DKR',
  });
  const abidjanClient = await createClient();
  const dakarClient = await createClient({ agencyCode: 'SN-DKR' });

  const p1 = await createPackage({
    clientId: abidjanClient.id,
    finalPrice: 100000,
    status: 'in_transit',
    createdAt: october(5),
    collectorId: abidjanCollector.id,
    collectorMargin: 10000,
  });
  await createPackage({
    clientId: abidjanClient.id,
    finalPrice: 50000,
    createdAt: october(10),
    collectorMargin: 5000,
  });
  await createPackage({
    clientId: abidjanClient.id,
    finalPrice: 30000,
    status: 'cancelled',
    createdAt: october(12),
  });
  const p4 = await createPackage({
    clientId: abidjanClient.id,
    finalPrice: 70000,
    status: 'delivered',
    createdAt: september(20),
  });
  await createPackage({
    clientId: dakarClient.id,
    finalPrice: 40000,
    createdAt: october(15),
    collectorId: dakarCollector.id,
    collectorMargin: 4000,
  });
  await createPayment({
    clientId: abidjanClient.id,
    amount: 60000,
    allocations: [{ packageId: p1.id, amount: 60000 }],
    createdAt: october(20),
  });
  await createPayment({
    clientId: abidjanClient.id,
    amount: 70000,
    allocations: [{ packageId: p4.id, amount: 70000 }],
    createdAt: september(25),
  });

  const [origin, destination] = await Promise.all([
    prisma.location.findUniqueOrThrow({ where: { code: 'CN-CAN' } }),
    prisma.location.findUniqueOrThrow({ where: { code: 'CI-ABJ' } }),
  ]);
  await prisma.shipment.create({
    data: {
      containerNumber: 'MSKU-1',
      transportMode: 'sea',
      carrier: 'Maersk',
      originId: origin.id,
      destinationId: destination.id,
      maxVolumeCbm: 68,
      status: 'in_transit',
    },
  });
}

describe('tableau de bord de l’équipe', () => {
  it('calcule les indicateurs du mois en cours pour toutes les agences', async () => {
    await seedActivity();
    await createAccount({ email: 'manager@bts.test', role: 'manager' });
    const manager = await signIn(app, 'manager@bts.test');

    const response = await request(app).get(DASHBOARD).set('Cookie', manager.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      month: '2026-10',
      // Seulement les colis en cours : le livré et l'annulé ne comptent pas.
      packages_in_progress: { registered: 2, in_transit: 1, arrived: 0, on_hold: 0 },
      month_activity: { packages: 3, volume_cbm: 0.72, collector_margin: 19000 },
      finance: {
        revenue: 190000,
        collected: 60000,
        // Abidjan : 220 000 facturés, 130 000 payés ; Dakar : 40 000 facturés, rien de payé.
        total_due: 130000,
        debtor_count: 2,
        shipments_under_way: 1,
      },
    });
  });

  it('donne les indicateurs d’un autre mois', async () => {
    await seedActivity();
    await createAccount({ email: 'manager@bts.test', role: 'manager' });
    const manager = await signIn(app, 'manager@bts.test');

    const response = await request(app)
      .get(`${DASHBOARD}?month=2026-09`)
      .set('Cookie', manager.cookie);
    const invalid = await request(app)
      .get(`${DASHBOARD}?month=2026-13`)
      .set('Cookie', manager.cookie);

    expect(response.body.data.month_activity.packages).toBe(1);
    expect(response.body.data.finance).toMatchObject({ revenue: 70000, collected: 70000 });
    expect(invalid.status).toBe(400);
  });
});

describe('tableau de bord du collecteur', () => {
  it('se limite à son agence et à sa marge, sans aucun chiffre financier', async () => {
    await seedActivity();
    const collector = await signIn(app, 'c-abj@bts.test');

    const response = await request(app).get(DASHBOARD).set('Cookie', collector.cookie);

    expect(response.body.data.packages_in_progress).toEqual({
      registered: 1,
      in_transit: 1,
      arrived: 0,
      on_hold: 0,
    });
    expect(response.body.data.month_activity).toEqual({
      packages: 2,
      volume_cbm: 0.48,
      collector_margin: 10000,
    });
    expect(response.body.data.finance).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/revenue|collected|total_due/);
  });
});
