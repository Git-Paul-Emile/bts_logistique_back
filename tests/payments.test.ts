// Tests d'intégration de F8 : encaissement réparti sur plusieurs colis, annulation par
// contrepassation, droits et recherche.
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

const PAYMENTS = '/api/v1/payments';
const NOW = new Date('2026-10-22T23:30:00.000Z');

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function sessionAs(role: 'admin' | 'manager' | 'collector') {
  const email = `${role}@bts.test`;
  await createAccount({ email, role, name: `Agent ${role}` });
  return signIn(app, email);
}

function api(session: TestSession) {
  const post = (url: string, body: object) =>
    request(app)
      .post(url)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body);
  return {
    get: (url: string) => request(app).get(url).set('Cookie', session.cookie),
    pay: (body: object) => post(PAYMENTS, body),
    reverse: (id: string, reason = 'Erreur de saisie') =>
      post(`${PAYMENTS}/${id}/reversal`, { reason }),
  };
}

/** Client avec deux colis : 100 000 et 50 000 F CFA. */
async function clientWithTwoPackages() {
  const client = await createClient({ name: 'Kouassi Import' });
  const first = await createPackage({ clientId: client.id, finalPrice: 100000 });
  const second = await createPackage({ clientId: client.id, finalPrice: 50000 });
  return { client, first, second };
}

async function packageState(id: string) {
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { id },
    select: { amountPaid: true, paymentStatus: true },
  });
  return { amountPaid: pkg.amountPaid.toNumber(), paymentStatus: pkg.paymentStatus };
}

describe('encaissement', () => {
  it('répartit un versement sur plusieurs colis du client', async () => {
    const manager = await sessionAs('manager');
    const { client, first, second } = await clientWithTwoPackages();

    const response = await api(manager).pay({
      client_id: client.id,
      amount: 120000,
      method: 'mobile_money',
      reference: 'WAVE-123',
      allocations: [
        { package_id: first.id, amount: 100000 },
        { package_id: second.id, amount: 20000 },
      ],
    });
    const balance = await api(manager).get(`/api/v1/clients/${client.id}`);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`${PAYMENTS}/${response.body.data.id}`);
    expect(response.body.data).toMatchObject({
      amount: 120000,
      reference: 'WAVE-123',
      author: { name: 'Agent manager' },
      reversed_by_payment_id: null,
    });
    expect(response.body.data.allocations).toHaveLength(2);
    expect(await packageState(first.id)).toEqual({ amountPaid: 100000, paymentStatus: 'paid' });
    expect(await packageState(second.id)).toEqual({ amountPaid: 20000, paymentStatus: 'partial' });
    expect(balance.body.data.client.balance).toBe(30000);
    expect(await prisma.notification.count({ where: { category: 'payment' } })).toBe(1);
  });

  it('passe un colis de partiel à payé au second versement', async () => {
    const manager = await sessionAs('manager');
    const { client, second } = await clientWithTwoPackages();
    const pay = (amount: number) =>
      api(manager).pay({
        client_id: client.id,
        amount,
        method: 'cash',
        allocations: [{ package_id: second.id, amount }],
      });

    await pay(20000);
    const afterFirst = await packageState(second.id);
    await pay(30000);

    expect(afterFirst.paymentStatus).toBe('partial');
    expect(await packageState(second.id)).toEqual({ amountPaid: 50000, paymentStatus: 'paid' });
  });

  it('refuse une répartition incohérente', async () => {
    const manager = await sessionAs('manager');
    const { client, first } = await clientWithTwoPackages();
    const base = { client_id: client.id, method: 'cash' };

    const wrongSum = await api(manager).pay({
      ...base,
      amount: 1000,
      allocations: [{ package_id: first.id, amount: 900 }],
    });
    const duplicate = await api(manager).pay({
      ...base,
      amount: 2000,
      allocations: [
        { package_id: first.id, amount: 1000 },
        { package_id: first.id, amount: 1000 },
      ],
    });
    const zero = await api(manager).pay({ ...base, amount: 0, allocations: [] });

    expect([wrongSum.status, duplicate.status, zero.status]).toEqual([400, 400, 400]);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('refuse une part supérieure au reste à payer, sans rien écrire', async () => {
    const manager = await sessionAs('manager');
    const { client, first, second } = await clientWithTwoPackages();

    const response = await api(manager).pay({
      client_id: client.id,
      amount: 110000,
      method: 'cash',
      allocations: [
        { package_id: first.id, amount: 50000 },
        { package_id: second.id, amount: 60000 },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EXCEEDS_REMAINING');
    expect(await prisma.payment.count()).toBe(0);
    expect(await packageState(first.id)).toEqual({ amountPaid: 0, paymentStatus: 'unpaid' });
  });

  it('refuse le colis d’un autre client et un colis annulé', async () => {
    const manager = await sessionAs('manager');
    const { client } = await clientWithTwoPackages();
    const other = await createClient({ name: 'Autre client' });
    const foreign = await createPackage({ clientId: other.id, finalPrice: 10000 });
    const cancelled = await createPackage({
      clientId: client.id,
      finalPrice: 10000,
      status: 'cancelled',
    });
    const payFor = (packageId: string) =>
      api(manager).pay({
        client_id: client.id,
        amount: 5000,
        method: 'cash',
        allocations: [{ package_id: packageId, amount: 5000 }],
      });

    const foreignResponse = await payFor(foreign.id);
    const cancelledResponse = await payFor(cancelled.id);

    expect(foreignResponse.body.error.code).toBe('PACKAGE_NOT_OF_CLIENT');
    expect(cancelledResponse.body.error.code).toBe('PACKAGE_CANCELLED');
  });
});

describe('annulation par contrepassation', () => {
  it('annule le paiement par une écriture inverse et rétablit les colis', async () => {
    const manager = await sessionAs('manager');
    const { client, first, second } = await clientWithTwoPackages();
    const payment = (
      await api(manager).pay({
        client_id: client.id,
        amount: 120000,
        method: 'mobile_money',
        allocations: [
          { package_id: first.id, amount: 100000 },
          { package_id: second.id, amount: 20000 },
        ],
      })
    ).body.data;

    const reversal = await api(manager).reverse(payment.id, 'Montant saisi deux fois');
    const original = await api(manager).get(`${PAYMENTS}/${payment.id}`);
    const balance = await api(manager).get(`/api/v1/clients/${client.id}`);

    expect(reversal.status).toBe(201);
    expect(reversal.body.data).toMatchObject({
      amount: -120000,
      reverses_payment_id: payment.id,
      notes: 'Montant saisi deux fois',
    });
    expect(
      reversal.body.data.allocations.map((part: { amount: number }) => part.amount).sort()
    ).toEqual([-100000, -20000]);
    expect(original.body.data).toMatchObject({
      amount: 120000,
      reversed_by_payment_id: reversal.body.data.id,
    });
    expect(await packageState(first.id)).toEqual({ amountPaid: 0, paymentStatus: 'unpaid' });
    expect(await packageState(second.id)).toEqual({ amountPaid: 0, paymentStatus: 'unpaid' });
    expect(balance.body.data.client.balance).toBe(150000);
    expect(await prisma.payment.count()).toBe(2);
  });

  it('n’annule un paiement qu’une fois, et n’annule pas une annulation', async () => {
    const manager = await sessionAs('manager');
    const { client, first } = await clientWithTwoPackages();
    const payment = (
      await api(manager).pay({
        client_id: client.id,
        amount: 1000,
        method: 'cash',
        allocations: [{ package_id: first.id, amount: 1000 }],
      })
    ).body.data;
    const reversal = (await api(manager).reverse(payment.id)).body.data;

    const twice = await api(manager).reverse(payment.id);
    const ofReversal = await api(manager).reverse(reversal.id);

    expect(twice.body.error.code).toBe('ALREADY_REVERSED');
    expect(ofReversal.body.error.code).toBe('CANNOT_REVERSE_REVERSAL');
  });

  it('n’offre aucune route pour modifier ou supprimer un paiement', async () => {
    const manager = await sessionAs('manager');
    const { client, first } = await clientWithTwoPackages();
    const payment = (
      await api(manager).pay({
        client_id: client.id,
        amount: 1000,
        method: 'cash',
        allocations: [{ package_id: first.id, amount: 1000 }],
      })
    ).body.data;
    const url = `${PAYMENTS}/${payment.id}`;

    const patch = await request(app)
      .patch(url)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrf)
      .send({ amount: 1 });
    const remove = await request(app)
      .delete(url)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrf);

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});

describe('droits et recherche', () => {
  it('réserve les paiements à l’équipe', async () => {
    const collector = await sessionAs('collector');
    const { client, first } = await clientWithTwoPackages();

    const list = await api(collector).get(PAYMENTS);
    const pay = await api(collector).pay({
      client_id: client.id,
      amount: 1000,
      method: 'cash',
      allocations: [{ package_id: first.id, amount: 1000 }],
    });

    expect(list.status).toBe(403);
    expect(pay.status).toBe(403);
  });

  it('cherche par numéro de suivi ou référence, filtre par mode et par période', async () => {
    const manager = await sessionAs('manager');
    const { client, first, second } = await clientWithTwoPackages();
    const pay = (packageId: string, method: string, reference: string) =>
      api(manager).pay({
        client_id: client.id,
        amount: 1000,
        method,
        reference,
        allocations: [{ package_id: packageId, amount: 1000 }],
      });
    await pay(first.id, 'cash', 'REC-001');
    await pay(second.id, 'transfer', 'VIR-002');
    // 23 h 30 UTC le 22 : la journée du 22 est incluse jusqu'à minuit, celle du 21 non.
    const today = '2026-10-22';
    const yesterday = '2026-10-21';

    const byTracking = await api(manager).get(`${PAYMENTS}?search=${second.trackingNumber}`);
    const byReference = await api(manager).get(`${PAYMENTS}?search=rec-001`);
    const transfers = await api(manager).get(`${PAYMENTS}?method=transfer`);
    const todayOnly = await api(manager).get(`${PAYMENTS}?from=${today}&to=${today}`);
    const before = await api(manager).get(`${PAYMENTS}?to=${yesterday}`);

    expect(byTracking.body.data.map((p: { reference: string }) => p.reference)).toEqual([
      'VIR-002',
    ]);
    expect(byReference.body.data).toHaveLength(1);
    expect(transfers.body.data).toHaveLength(1);
    expect(todayOnly.body.meta.total).toBe(2);
    expect(before.body.meta.total).toBe(0);
  });
});
