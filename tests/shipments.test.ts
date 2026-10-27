// Tests d'intégration de F9 : conteneurs, chargement des colis et cycle de vie.
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

const SHIPMENTS = '/api/v1/shipments';
const NOW = new Date('2026-11-20T10:00:00.000Z');

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
  await createAccount({ email, role });
  return signIn(app, email);
}

function api(session: TestSession) {
  const send = (method: 'post' | 'patch' | 'delete', url: string, body?: object) => {
    const pending = request(app)[method](url);
    return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
  };
  return {
    get: (url: string) => request(app).get(url).set('Cookie', session.cookie),
    create: (body: object) => send('post', SHIPMENTS, body),
    patch: (id: string, body: object) => send('patch', `${SHIPMENTS}/${id}`, body),
    status: (id: string, body: object) => send('patch', `${SHIPMENTS}/${id}/status`, body),
    load: (id: string, packageIds: string[]) =>
      send('post', `${SHIPMENTS}/${id}/packages`, { package_ids: packageIds }),
    unload: (id: string, packageId: string) =>
      send('delete', `${SHIPMENTS}/${id}/packages/${packageId}`),
  };
}

/** Conteneur maritime Guangzhou vers Abidjan, de 0,5 m³ pour tester la capacité. */
async function smallContainer(session: TestSession, extra: object = {}) {
  // Les lieux sont créés par la fabrique de colis ; on en crée un pour qu'ils existent.
  await createPackage({ clientId: (await createClient()).id, finalPrice: 1 });
  const response = await api(session).create({
    container_number: 'msku-998811-4',
    transport_mode: 'sea',
    carrier: 'Maersk',
    origin_code: 'CN-CAN',
    destination_code: 'CI-ABJ',
    max_volume_cbm: 0.5,
    departure_date: '2026-11-25',
    estimated_arrival: '2026-12-30',
    ...extra,
  });
  return response.body.data as { id: string };
}

/** Colis de 0,24 m³ chacun, à l'entrepôt. */
async function boxes(
  count: number,
  options: Partial<Omit<Parameters<typeof createPackage>[0], 'clientId'>> = {}
) {
  const client = await createClient();
  const created = [];
  for (let index = 0; index < count; index += 1) {
    created.push(await createPackage({ clientId: client.id, finalPrice: 50000, ...options }));
  }
  return created;
}

describe('création et liste', () => {
  it('crée un conteneur et refuse un numéro déjà enregistré', async () => {
    const manager = await sessionAs('manager');

    await smallContainer(manager);
    const duplicate = await api(manager).create({
      container_number: 'MSKU-998811-4',
      transport_mode: 'sea',
      carrier: 'CMA CGM',
      origin_code: 'CN-CAN',
      destination_code: 'CI-ABJ',
      max_volume_cbm: 68,
    });
    const list = await api(manager).get(SHIPMENTS);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONTAINER_NUMBER_TAKEN');
    expect(list.body.data[0]).toMatchObject({
      container_number: 'MSKU-998811-4',
      status: 'planned',
      current_volume_cbm: 0,
      package_count: 0,
      departure_date: '2026-11-25',
      estimated_arrival: '2026-12-30',
    });
  });

  it('refuse une arrivée prévue avant le départ', async () => {
    const manager = await sessionAs('manager');

    const response = await api(manager).create({
      container_number: 'X-1',
      transport_mode: 'air',
      carrier: 'Ethiopian',
      origin_code: 'CN-CAN',
      destination_code: 'CI-ABJ',
      max_volume_cbm: 15,
      departure_date: '2026-12-10',
      estimated_arrival: '2026-12-01',
    });

    expect(response.status).toBe(400);
  });

  it('réserve les conteneurs à l’équipe', async () => {
    const collector = await sessionAs('collector');

    const response = await api(collector).get(SHIPMENTS);

    expect(response.status).toBe(403);
  });
});

describe('chargement des colis', () => {
  it('charge des colis et calcule le volume chargé', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);
    const [first, second] = await boxes(2);

    const response = await api(manager).load(shipment.id, [first!.id, second!.id]);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ current_volume_cbm: 0.48, package_count: 2 });
    expect(response.body.data.packages).toHaveLength(2);
  });

  it('refuse de dépasser la capacité, sans charger aucun colis', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);
    const three = await boxes(3);

    const response = await api(manager).load(
      shipment.id,
      three.map((pkg) => pkg.id)
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(await prisma.package.count({ where: { shipmentId: shipment.id } })).toBe(0);
  });

  it('refuse un colis d’un autre mode, d’une autre destination ou déjà parti', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);
    const [byAir] = await boxes(1, { transportMode: 'air' });
    const [toDakar] = await boxes(1, { destination: 'SN-DKR' });
    const [inTransit] = await boxes(1, { status: 'in_transit' });

    const air = await api(manager).load(shipment.id, [byAir!.id]);
    const dakar = await api(manager).load(shipment.id, [toDakar!.id]);
    const gone = await api(manager).load(shipment.id, [inTransit!.id]);

    expect(air.body.error.message).toMatch(/mode de transport différent/);
    expect(dakar.body.error.message).toMatch(/destination différente/);
    expect(gone.body.error.message).toMatch(/plus à l’entrepôt/);
  });

  it('ne met jamais un colis dans deux conteneurs', async () => {
    const manager = await sessionAs('manager');
    const first = await smallContainer(manager);
    const second = (
      await api(manager).create({
        container_number: 'MSKU-2',
        transport_mode: 'sea',
        carrier: 'Maersk',
        origin_code: 'CN-CAN',
        destination_code: 'CI-ABJ',
        max_volume_cbm: 10,
      })
    ).body.data;
    const [pkg] = await boxes(1);
    await api(manager).load(first.id, [pkg!.id]);

    const response = await api(manager).load(second.id, [pkg!.id]);

    expect(response.body.error.message).toMatch(/déjà dans un autre conteneur/);
  });

  it('retire un colis chargé par erreur, mais plus après le départ', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);
    const [first, second] = await boxes(2);
    await api(manager).load(shipment.id, [first!.id, second!.id]);

    const removed = await api(manager).unload(shipment.id, first!.id);
    await api(manager).status(shipment.id, { status: 'loading' });
    await api(manager).status(shipment.id, { status: 'in_transit' });
    const afterDeparture = await api(manager).unload(shipment.id, second!.id);

    expect(removed.body.data.package_count).toBe(1);
    expect(afterDeparture.body.error.code).toBe('SHIPMENT_NOT_LOADING');
  });

  it('refuse une capacité inférieure au volume déjà chargé', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);
    const [pkg] = await boxes(1);
    await api(manager).load(shipment.id, [pkg!.id]);

    const response = await api(manager).patch(shipment.id, { max_volume_cbm: 0.1 });

    expect(response.body.error.code).toBe('CAPACITY_BELOW_LOAD');
  });
});

describe('cycle de vie du conteneur', () => {
  it('avance étape par étape, note l’arrivée réelle et se ferme une fois dépoté', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);

    for (const status of ['loading', 'in_transit', 'arrived']) {
      expect((await api(manager).status(shipment.id, { status })).status).toBe(200);
    }
    const arrived = await api(manager).get(`${SHIPMENTS}/${shipment.id}`);
    await api(manager).status(shipment.id, { status: 'unloaded' });
    const edit = await api(manager).patch(shipment.id, { carrier: 'Autre' });

    expect(arrived.body.data.actual_arrival).toBe('2026-11-20');
    expect(edit.body.error.code).toBe('SHIPMENT_CLOSED');
  });

  it('refuse de sauter le départ ou de revenir en arrière', async () => {
    const manager = await sessionAs('manager');
    const shipment = await smallContainer(manager);

    const skip = await api(manager).status(shipment.id, { status: 'arrived' });
    await api(manager).status(shipment.id, { status: 'loading' });
    const back = await api(manager).status(shipment.id, { status: 'planned' });

    expect(skip.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(back.status).toBe(409);
  });
});
