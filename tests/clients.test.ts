// Tests d'intégration de F5 : clients, soldes calculés en base, droits par rôle et par agence.
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAccount, createAgency } from './factories/accountFactory.js';
import { createClient, createPackage, createPayment } from './factories/ledgerFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const CLIENTS = '/api/v1/clients';

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function sessionAs(
  role: 'admin' | 'manager' | 'collector',
  agencyCode?: string
): Promise<TestSession> {
  const email = `${role}@bts.test`;
  await createAccount({ email, role, agencyCode });
  return signIn(app, email);
}

function get(session: TestSession, url: string) {
  return request(app).get(url).set('Cookie', session.cookie);
}

function send(session: TestSession, method: 'post' | 'patch', url: string, body: object) {
  const pending = request(app)[method](url);
  return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
}

/** Client débiteur : 150 000 facturés (un colis annulé ne compte pas), 70 000 encaissés. */
async function debtorClient(name = 'Kouassi Import') {
  const client = await createClient({
    name,
    phone: '+225 07 00 11 22 33',
    email: 'kouassi@shop.ci',
  });
  const first = await createPackage({ clientId: client.id, finalPrice: 100000 });
  const second = await createPackage({ clientId: client.id, finalPrice: 50000 });
  await createPackage({ clientId: client.id, finalPrice: 30000, status: 'cancelled' });
  await createPayment({
    clientId: client.id,
    amount: 60000,
    allocations: [
      { packageId: first.id, amount: 40000 },
      { packageId: second.id, amount: 20000 },
    ],
  });
  // Avance non répartie : elle réduit quand même le solde du client.
  await createPayment({ clientId: client.id, amount: 10000 });
  return client;
}

describe('solde des clients', () => {
  it('calcule facturé, encaissé et reste dû à partir des colis et des paiements', async () => {
    const manager = await sessionAs('manager');
    await debtorClient();

    const response = await get(manager, CLIENTS);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      name: 'Kouassi Import',
      total_billed: 150000,
      amount_paid: 70000,
      balance: 80000,
      has_debt: true,
      package_count: 3,
    });
  });

  it('tient compte d’une annulation de paiement', async () => {
    const manager = await sessionAs('manager');
    const client = await createClient({ name: 'Client Annulation' });
    const pkg = await createPackage({ clientId: client.id, finalPrice: 50000 });
    const payment = await createPayment({
      clientId: client.id,
      amount: 50000,
      allocations: [{ packageId: pkg.id, amount: 50000 }],
    });
    await createPayment({
      clientId: client.id,
      amount: -50000,
      reversesPaymentId: payment.id,
      allocations: [{ packageId: pkg.id, amount: -50000 }],
    });

    const response = await get(manager, CLIENTS);

    expect(response.body.data[0]).toMatchObject({ amount_paid: 0, balance: 50000, has_debt: true });
  });

  it('filtre les clients qui ont un impayé et les trie par reste dû', async () => {
    const manager = await sessionAs('manager');
    await debtorClient('Débiteur');
    const settled = await createClient({ name: 'À jour' });
    const paidPackage = await createPackage({ clientId: settled.id, finalPrice: 20000 });
    await createPayment({
      clientId: settled.id,
      amount: 20000,
      allocations: [{ packageId: paidPackage.id, amount: 20000 }],
    });
    await createClient({ name: 'Sans colis' });

    const debtors = await get(manager, `${CLIENTS}?has_debt=true`);
    const byBalance = await get(manager, `${CLIENTS}?sort=-balance`);

    expect(debtors.body.data.map((client: { name: string }) => client.name)).toEqual(['Débiteur']);
    expect(debtors.body.meta.total).toBe(1);
    expect(byBalance.body.data[0].name).toBe('Débiteur');
  });
});

describe('recherche et pagination', () => {
  it('cherche par nom, e-mail ou chiffres du téléphone', async () => {
    const manager = await sessionAs('manager');
    await debtorClient();
    await createClient({ name: 'Autre Client', phone: '+221 77 123 45 67' });

    const byName = await get(manager, `${CLIENTS}?search=kouassi`);
    const byEmail = await get(manager, `${CLIENTS}?search=SHOP.CI`);
    const byPhone = await get(manager, `${CLIENTS}?search=0700 1122`);
    const wildcard = await get(manager, `${CLIENTS}?search=%25`);

    expect(byName.body.data).toHaveLength(1);
    expect(byEmail.body.data).toHaveLength(1);
    expect(byPhone.body.data.map((client: { name: string }) => client.name)).toEqual([
      'Kouassi Import',
    ]);
    expect(wildcard.body.data).toHaveLength(0);
  });

  it('pagine et refuse un tri hors liste', async () => {
    const manager = await sessionAs('manager');
    for (const name of ['Alpha', 'Bravo', 'Charlie']) await createClient({ name });

    const page = await get(manager, `${CLIENTS}?limit=2&page=2`);
    const badSort = await get(manager, `${CLIENTS}?sort=phone`);

    expect(page.body.meta).toEqual({ page: 2, limit: 2, total: 3, hasNext: false });
    expect(page.body.data.map((client: { name: string }) => client.name)).toEqual(['Charlie']);
    expect(badSort.status).toBe(400);
  });
});

describe('collecteur', () => {
  it('ne voit que les clients de son agence, sans aucun montant', async () => {
    await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
    const collector = await sessionAs('collector', 'SN-DKR');
    await debtorClient('Client Abidjan');
    await createClient({ name: 'Client Dakar', agencyCode: 'SN-DKR' });

    const response = await get(collector, `${CLIENTS}?has_debt=true&sort=-balance`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((client: { name: string }) => client.name)).toEqual([
      'Client Dakar',
    ]);
    expect(JSON.stringify(response.body.data)).not.toMatch(/balance|billed|amount|debt/);
  });

  it('crée le client dans sa propre agence, quelle que soit l’agence demandée', async () => {
    await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
    await createAgency();
    const collector = await sessionAs('collector', 'SN-DKR');

    const response = await send(collector, 'post', CLIENTS, {
      name: 'Nouveau Client',
      phone: '+221 77 000 00 01',
      agency_code: 'CI-ABJ',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.agency.code).toBe('SN-DKR');
    expect(response.body.data).not.toHaveProperty('balance');
  });

  it('n’a accès ni à la fiche financière ni à la modification', async () => {
    const collector = await sessionAs('collector');
    const client = await debtorClient();

    const detail = await get(collector, `${CLIENTS}/${client.id}`);
    const update = await send(collector, 'patch', `${CLIENTS}/${client.id}`, { name: 'X' });

    expect(detail.status).toBe(403);
    expect(update.status).toBe(403);
  });
});

describe('fiche, création et modification par l’équipe', () => {
  it('donne la fiche avec les derniers colis et paiements répartis', async () => {
    const manager = await sessionAs('manager');
    const client = await debtorClient();

    const response = await get(manager, `${CLIENTS}/${client.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.client.balance).toBe(80000);
    expect(response.body.data.recent_packages).toHaveLength(3);
    const split = response.body.data.recent_payments.find(
      (payment: { amount: number }) => payment.amount === 60000
    );
    expect(split.allocations).toHaveLength(2);
    expect(split.allocations).toContainEqual(
      expect.objectContaining({ amount: 40000, tracking_number: expect.any(String) })
    );
  });

  it('crée un client dans l’agence choisie et vérifie les champs', async () => {
    const admin = await sessionAs('admin');
    await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');

    const created = await send(admin, 'post', CLIENTS, {
      name: ' Boutique Dakar ',
      phone: '+221 77 000 00 02',
      email: '',
      agency_code: 'SN-DKR',
    });
    const shortPhone = await send(admin, 'post', CLIENTS, { name: 'X', phone: '0700' });
    const unknownAgency = await send(admin, 'post', CLIENTS, {
      name: 'X',
      phone: '+221 77 000 00 03',
      agency_code: 'XX-000',
    });

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`${CLIENTS}/${created.body.data.id}`);
    expect(created.body.data).toMatchObject({
      name: 'Boutique Dakar',
      email: null,
      agency: { code: 'SN-DKR' },
      balance: 0,
      has_debt: false,
    });
    expect(shortPhone.status).toBe(400);
    expect(unknownAgency.body.error.code).toBe('UNKNOWN_AGENCY');
  });

  it('modifie un client et répond 404 pour un client inconnu', async () => {
    const manager = await sessionAs('manager');
    const client = await createClient({ name: 'Ancien Nom' });

    const updated = await send(manager, 'patch', `${CLIENTS}/${client.id}`, {
      name: 'Nouveau Nom',
      address: 'Marcory Zone 4, Abidjan',
    });
    const unknown = await send(
      manager,
      'patch',
      `${CLIENTS}/00000000-0000-7000-8000-000000000000`,
      {
        name: 'X',
      }
    );

    expect(updated.body.data).toMatchObject({
      name: 'Nouveau Nom',
      address: 'Marcory Zone 4, Abidjan',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('CLIENT_NOT_FOUND');
  });
});
