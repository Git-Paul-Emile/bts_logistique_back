// Tests d'intégration de F6 : enregistrement, prix serveur, numéro de suivi, périmètre d'agence,
// corrections et cycle de vie des colis.
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { trackingNumbers } from '../src/features/packages/trackingNumber.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount } from './factories/accountFactory.js';
import { createClient } from './factories/ledgerFactory.js';
import { queuedEmails } from './helpers/emails.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const PACKAGES = '/api/v1/packages';
const NOW = new Date('2026-10-22T08:00:00.000Z');
/** 80 × 60 × 50 cm = 0,24 m³ : 0,24 × 380 000 = 91 200 F CFA, marge 0,24 × 38 500 = 9 240. */
const BOX = { length_cm: 80, width_cm: 60, height_cm: 50, weight_kg: 25 };

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
  await seedNetwork();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Villes et agences du test : départ Guangzhou, arrivées Abidjan et Dakar. */
async function seedNetwork() {
  const places = [
    { code: 'CN-CAN', name: 'Guangzhou (Chine)', countryCode: 'CN', isOrigin: true },
    { code: 'CI-ABJ', name: "Abidjan (Côte d'Ivoire)", countryCode: 'CI', isDestination: true },
    { code: 'SN-DKR', name: 'Dakar (Sénégal)', countryCode: 'SN', isDestination: true },
  ];
  for (const place of places) {
    const location = await prisma.location.create({ data: place, select: { id: true } });
    await prisma.agency.create({
      data: { code: place.code, name: place.name, locationId: location.id },
    });
  }
}

async function setGrid(seaMargin = 38500) {
  const author = await prisma.user.findFirstOrThrow({ select: { id: true } });
  await prisma.pricingRate.createMany({
    data: [
      {
        transportMode: 'sea',
        clientRatePerCbm: 380000,
        collectorMarginPerCbm: seaMargin,
        authorId: author.id,
        effectiveFrom: NOW,
      },
      {
        transportMode: 'air',
        clientRatePerCbm: 750000,
        collectorMarginPerCbm: 61500,
        authorId: author.id,
        effectiveFrom: NOW,
      },
    ],
  });
}

async function sessionAs(role: 'admin' | 'manager' | 'collector', agencyCode = 'CI-ABJ') {
  const email = `${role}-${agencyCode.toLowerCase()}@bts.test`;
  await createAccount({ email, role, agencyCode, name: `Agent ${role}` });
  return signIn(app, email);
}

function api(session: TestSession) {
  const send = (method: 'post' | 'patch', url: string, body: object) => {
    const pending = request(app)[method](url);
    return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
  };
  return {
    get: (url: string) => request(app).get(url).set('Cookie', session.cookie),
    register: (body: object) => send('post', PACKAGES, body),
    patch: (id: string, body: object) => send('patch', `${PACKAGES}/${id}`, body),
    event: (id: string, body: object) => send('post', `${PACKAGES}/${id}/events`, body),
  };
}

function newPackage(clientId: string, extra: object = {}) {
  return {
    client_id: clientId,
    origin_code: 'CN-CAN',
    destination_code: 'CI-ABJ',
    transport_mode: 'sea',
    ...BOX,
    ...extra,
  };
}

describe('enregistrement d’un colis', () => {
  it('calcule numéro, volume, prix et marge côté serveur et ignore les montants envoyés', async () => {
    const collector = await sessionAs('collector');
    await setGrid();
    const client = await createClient({ agencyCode: 'CI-ABJ' });

    const response = await api(collector).register(
      newPackage(client.id, { final_price: 1, collector_margin: 999999, tracking_number: 'X' })
    );

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`${PACKAGES}/${response.body.data.id}`);
    expect(response.body.data).toMatchObject({
      cubic_meter: 0.24,
      rate_per_cbm: 380000,
      final_price: 91200,
      collector_margin: 9240,
      status: 'registered',
      payment_status: 'unpaid',
      amount_paid: 0,
      agency: { code: 'CI-ABJ' },
      collector: { name: 'Agent collector' },
    });
    expect(response.body.data.tracking_number).toMatch(/^BTS-CI-2026-\d{6}$/);
    expect(response.body.data.events).toEqual([
      expect.objectContaining({
        status: 'registered',
        location: expect.objectContaining({ code: 'CN-CAN' }),
      }),
    ]);
    expect(await prisma.notification.count({ where: { category: 'package' } })).toBe(1);
  });

  it('enregistre le paiement initial et sa répartition dans la même opération', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();

    const response = await api(manager).register(
      newPackage(client.id, { initial_payment: { amount: 50000, method: 'cash' } })
    );
    const allocation = await prisma.paymentAllocation.findFirstOrThrow({
      select: { amount: true },
    });

    expect(response.body.data).toMatchObject({ amount_paid: 50000, payment_status: 'partial' });
    expect(allocation.amount.toNumber()).toBe(50000);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('refuse un paiement initial supérieur au prix', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();

    const response = await api(manager).register(
      newPackage(client.id, { initial_payment: { amount: 91201, method: 'cash' } })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PAYMENT_EXCEEDS_PRICE');
  });

  it('tire un autre numéro quand le premier existe déjà', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    vi.spyOn(trackingNumbers, 'randomSuffix')
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(654321);

    const first = await api(manager).register(newPackage(client.id));
    const second = await api(manager).register(newPackage(client.id));

    expect(first.body.data.tracking_number).toBe('BTS-CI-2026-123456');
    expect(second.status).toBe(201);
    expect(second.body.data.tracking_number).toBe('BTS-CI-2026-654321');
  });

  it('n’écrit rien si l’enregistrement échoue en cours de route', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    vi.spyOn(trackingNumbers, 'randomSuffix').mockReturnValue(111111);
    await api(manager).register(newPackage(client.id));

    // Toutes les tentatives tombent sur un numéro déjà pris : l'opération échoue entièrement.
    const failed = await api(manager).register(
      newPackage(client.id, { initial_payment: { amount: 1000, method: 'cash' } })
    );

    expect(failed.status).toBe(409);
    expect(await prisma.package.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.packageEvent.count()).toBe(1);
  });

  it('réserve le tarif personnalisé à l’équipe et refuse un tarif sous la marge', async () => {
    const collector = await sessionAs('collector');
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient({ agencyCode: 'CI-ABJ' });

    const byCollector = await api(collector).register(
      newPackage(client.id, { rate_per_cbm: 400000 })
    );
    const byManager = await api(manager).register(newPackage(client.id, { rate_per_cbm: 400000 }));
    const belowMargin = await api(manager).register(newPackage(client.id, { rate_per_cbm: 10000 }));

    expect(byCollector.status).toBe(403);
    expect(byCollector.body.error.code).toBe('RATE_OVERRIDE_FORBIDDEN');
    expect(byManager.body.data.final_price).toBe(96000);
    expect(belowMargin.body.error.code).toBe('RATE_BELOW_MARGIN');
  });

  it('refuse un lieu non desservi, un itinéraire en boucle et une grille vide', async () => {
    const manager = await sessionAs('manager');
    const client = await createClient();

    const noGrid = await api(manager).register(newPackage(client.id));
    await setGrid();
    const wrongOrigin = await api(manager).register(
      newPackage(client.id, { origin_code: 'SN-DKR' })
    );
    const loop = await api(manager).register(
      newPackage(client.id, { destination_code: 'CN-CAN', origin_code: 'CN-CAN' })
    );

    expect(noGrid.body.error.code).toBe('PRICING_NOT_CONFIGURED');
    expect(wrongOrigin.body.error.code).toBe('UNKNOWN_LOCATION');
    expect(loop.status).toBe(400);
  });
});

describe('périmètre d’agence du collecteur', () => {
  it('ne voit, ne modifie et ne suit que les colis de son agence', async () => {
    const manager = await sessionAs('manager');
    const dakarCollector = await sessionAs('collector', 'SN-DKR');
    await setGrid();
    const abidjanClient = await createClient({ agencyCode: 'CI-ABJ' });
    const abidjanPackage = (await api(manager).register(newPackage(abidjanClient.id))).body.data;

    const list = await api(dakarCollector).get(PACKAGES);
    const detail = await api(dakarCollector).get(`${PACKAGES}/${abidjanPackage.id}`);
    const patch = await api(dakarCollector).patch(abidjanPackage.id, { description: 'X' });
    const event = await api(dakarCollector).event(abidjanPackage.id, {
      status: 'in_transit',
      location: 'Port',
    });
    const foreignClient = await api(dakarCollector).register(newPackage(abidjanClient.id));

    expect(list.body.data).toEqual([]);
    expect(detail.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(event.status).toBe(404);
    expect(foreignClient.body.error.code).toBe('CLIENT_NOT_FOUND');
  });
});

describe('correction d’un colis', () => {
  it('recalcule le prix, et la marge avec le taux figé à l’enregistrement', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    const pkg = (await api(manager).register(newPackage(client.id))).body.data;
    // La grille change ensuite : le colis garde son taux de marge d'origine.
    await prisma.pricingRate.updateMany({ data: { collectorMarginPerCbm: 1000 } });

    const response = await api(manager).patch(pkg.id, {
      length_cm: 100,
      description: 'Pièces auto',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      cubic_meter: 0.3,
      final_price: 114000,
      collector_margin: 11550,
      description: 'Pièces auto',
    });
  });

  it('refuse un prix inférieur au montant déjà encaissé', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    const pkg = (
      await api(manager).register(
        newPackage(client.id, { initial_payment: { amount: 90000, method: 'cash' } })
      )
    ).body.data;

    const response = await api(manager).patch(pkg.id, { length_cm: 40 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRICE_BELOW_PAID');
  });
});

describe('cycle de vie et étapes de suivi', () => {
  it('suit le parcours jusqu’à la livraison, puis refuse toute nouvelle étape', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    const pkg = (await api(manager).register(newPackage(client.id))).body.data;

    for (const status of ['in_transit', 'arrived', 'delivered']) {
      const step = await api(manager).event(pkg.id, { status, location: 'Port d’Abidjan' });
      expect(step.status).toBe(201);
    }
    const afterDelivery = await api(manager).event(pkg.id, { status: 'in_transit', location: 'X' });
    const editAfterDelivery = await api(manager).patch(pkg.id, { description: 'X' });
    const detail = await api(manager).get(`${PACKAGES}/${pkg.id}`);

    expect(afterDelivery.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(editAfterDelivery.body.error.code).toBe('PACKAGE_CLOSED');
    expect(detail.body.data.status).toBe('delivered');
    expect(detail.body.data.events.map((event: { status: string }) => event.status)).toEqual([
      'delivered',
      'arrived',
      'in_transit',
      'registered',
    ]);
    expect(detail.body.data.events[0].agent.name).toBe('Agent manager');
  });

  it('refuse de sauter une étape', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient();
    const pkg = (await api(manager).register(newPackage(client.id))).body.data;

    const response = await api(manager).event(pkg.id, { status: 'delivered', location: 'X' });

    expect(response.status).toBe(409);
  });

  it('prépare l’e-mail au client, ou le note non envoyé sans adresse', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const withEmail = await createClient({ email: 'client@shop.ci' });
    const withoutEmail = await createClient();
    const first = (await api(manager).register(newPackage(withEmail.id))).body.data;
    const second = (await api(manager).register(newPackage(withoutEmail.id))).body.data;

    await api(manager).event(first.id, {
      status: 'in_transit',
      location: 'Port',
      notify_client: true,
    });
    await api(manager).event(second.id, {
      status: 'in_transit',
      location: 'Port',
      notify_client: true,
    });
    const emails = await prisma.notification.findMany({
      where: { category: 'email' },
      select: { packageId: true, deliveryStatus: true },
    });

    expect(emails).toContainEqual({ packageId: first.id, deliveryStatus: 'queued' });
    expect(emails).toContainEqual({ packageId: second.id, deliveryStatus: 'skipped' });
  });
});

describe('e-mails aux clients', () => {
  it('inscrit l’e-mail d’enregistrement et celui de suivi, lié à sa notification', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const client = await createClient({ name: 'Kouassi Import', email: 'kouassi@shop.ci' });
    const silent = await createClient();

    const pkg = (await api(manager).register(newPackage(client.id))).body.data;
    await api(manager).register(newPackage(silent.id));
    await api(manager).event(pkg.id, {
      status: 'in_transit',
      location: 'Port',
      notify_client: true,
    });
    const emails = await queuedEmails();
    const statusEmail = await prisma.emailOutbox.findFirstOrThrow({
      where: { kind: 'package_status' },
      select: { notification: { select: { category: true, packageId: true } } },
    });

    expect(emails.map((email) => [email.kind, email.to])).toEqual([
      ['package_registered', 'kouassi@shop.ci'],
      ['package_status', 'kouassi@shop.ci'],
    ]);
    expect(emails[0]?.data).toMatchObject({
      trackingNumber: pkg.tracking_number,
      trackingUrl: `http://localhost:5173/suivi/${pkg.tracking_number}`,
    });
    expect(statusEmail.notification).toEqual({ category: 'email', packageId: pkg.id });
  });
});

describe('liste des colis', () => {
  it('cherche par numéro ou par client, filtre et pagine', async () => {
    const manager = await sessionAs('manager');
    await setGrid();
    const kouassi = await createClient({ name: 'Kouassi Import' });
    const other = await createClient({ name: 'Autre' });
    const pkg = (await api(manager).register(newPackage(kouassi.id))).body.data;
    await api(manager).register(newPackage(other.id, { transport_mode: 'air' }));

    const byClient = await api(manager).get(`${PACKAGES}?search=kouassi`);
    const byNumber = await api(manager).get(`${PACKAGES}?search=${pkg.tracking_number.slice(-6)}`);
    const air = await api(manager).get(`${PACKAGES}?transport_mode=air`);
    const page = await api(manager).get(`${PACKAGES}?limit=1&page=2`);

    expect(byClient.body.data.map((p: { id: string }) => p.id)).toEqual([pkg.id]);
    expect(byNumber.body.data).toHaveLength(1);
    expect(air.body.data[0].transport_mode).toBe('air');
    expect(page.body.meta).toEqual({ page: 2, limit: 1, total: 2, hasNext: false });
  });
});
