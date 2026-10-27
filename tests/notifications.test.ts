// Tests d'intégration de l'API des notifications du personnel (F10).
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount, createAgency } from './factories/accountFactory.js';
import { createClient, createPackage } from './factories/ledgerFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const NOTIFICATIONS = '/api/v1/notifications';

let app: Express;

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
});

async function sessionAs(
  email: string,
  role: 'admin' | 'manager' | 'collector',
  agencyCode?: string
) {
  await createAccount({ email, role, agencyCode });
  return signIn(app, email);
}

function api(session: TestSession) {
  const send = (method: 'patch' | 'post', url: string, body?: object) => {
    const pending = request(app)[method](url);
    return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
  };
  return {
    list: (query = '') =>
      request(app).get(`${NOTIFICATIONS}${query}`).set('Cookie', session.cookie),
    unread: async () =>
      (await request(app).get(`${NOTIFICATIONS}/unread-count`).set('Cookie', session.cookie)).body
        .data.count as number,
    setRead: (ids: string[], read: boolean) =>
      send('patch', `${NOTIFICATIONS}/read`, { ids, read }),
    readAll: () => send('post', `${NOTIFICATIONS}/read-all`),
  };
}

/** Une notification de colis à Abidjan, une à Dakar, et une de paiement sans colis. */
async function seedNotifications() {
  await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
  const abidjanPkg = await createPackage({ clientId: (await createClient()).id, finalPrice: 1 });
  const dakarPkg = await createPackage({
    clientId: (await createClient({ agencyCode: 'SN-DKR' })).id,
    finalPrice: 1,
  });
  const create = (data: { category: 'package' | 'payment'; title: string; packageId?: string }) =>
    prisma.notification.create({ data: { ...data, message: data.title }, select: { id: true } });
  return {
    abidjan: await create({
      category: 'package',
      title: 'Colis Abidjan',
      packageId: abidjanPkg.id,
    }),
    dakar: await create({ category: 'package', title: 'Colis Dakar', packageId: dakarPkg.id }),
    payment: await create({ category: 'payment', title: 'Paiement reçu' }),
  };
}

describe('état lu ou non lu', () => {
  it('est propre à chaque personne', async () => {
    const { abidjan } = await seedNotifications();
    const awa = await sessionAs('awa@bts.test', 'manager');
    const koffi = await sessionAs('koffi@bts.test', 'admin');

    await api(awa).setRead([abidjan.id], true);
    const awaList = await api(awa).list();
    const koffiList = await api(koffi).list();

    const readOf = (body: { data: { id: string; read: boolean }[] }) =>
      body.data.find((notification) => notification.id === abidjan.id)?.read;
    expect(readOf(awaList.body)).toBe(true);
    expect(readOf(koffiList.body)).toBe(false);
    expect(await api(awa).unread()).toBe(2);
    expect(await api(koffi).unread()).toBe(3);
  });

  it('filtre les non lues et par catégorie, et remet une notification en non lue', async () => {
    const { abidjan } = await seedNotifications();
    const awa = await sessionAs('awa@bts.test', 'manager');
    await api(awa).setRead([abidjan.id], true);

    const unreadOnly = await api(awa).list('?read=false');
    const payments = await api(awa).list('?category=payment');
    await api(awa).setRead([abidjan.id], false);

    expect(unreadOnly.body.meta.total).toBe(2);
    expect(payments.body.data.map((n: { title: string }) => n.title)).toEqual(['Paiement reçu']);
    expect(await api(awa).unread()).toBe(3);
  });

  it('marque tout comme lu', async () => {
    await seedNotifications();
    const awa = await sessionAs('awa@bts.test', 'manager');

    const response = await api(awa).readAll();

    expect(response.status).toBe(204);
    expect(await api(awa).unread()).toBe(0);
  });
});

describe('périmètre du collecteur', () => {
  it('ne voit que les notifications des colis de son agence', async () => {
    const { dakar } = await seedNotifications();
    const collector = await sessionAs('collecteur@bts.test', 'collector', 'SN-DKR');

    const response = await api(collector).list();

    expect(response.body.data.map((n: { id: string }) => n.id)).toEqual([dakar.id]);
    expect(await api(collector).unread()).toBe(1);
  });

  it('ne peut marquer lues que celles qu’il voit, même avec « tout lire »', async () => {
    const { abidjan } = await seedNotifications();
    const collector = await sessionAs('collecteur@bts.test', 'collector', 'SN-DKR');

    await api(collector).setRead([abidjan.id], true);
    await api(collector).readAll();
    const reads = await prisma.notificationRead.findMany({ select: { notificationId: true } });

    expect(reads).toHaveLength(1);
    expect(reads[0]?.notificationId).not.toBe(abidjan.id);
  });
});
