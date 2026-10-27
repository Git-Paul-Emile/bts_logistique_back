// Tests d'intégration de F2 : comptes, rôles, invitation et archivage.
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { EmailMessage } from '../src/infrastructure/email/emailMessages.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { createAccount, createAgency } from './factories/accountFactory.js';
import { queuedEmails } from './helpers/emails.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const USERS = '/api/v1/users';
const START = new Date('2026-10-22T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const CHOSEN_PASSWORD = 'mon-premier-mot-de-passe';

let app: Express;
let now = START;
let sentEmails: EmailMessage[] = [];

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  now = START;
  sentEmails = [];
  vi.spyOn(clock, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function adminSession(email = 'admin@bts.test'): Promise<TestSession> {
  await createAccount({ email, role: 'admin', name: 'Awa Admin' });
  return signIn(app, email);
}

function as(session: TestSession) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', session.cookie),
    post: (url: string, body?: object) =>
      request(app)
        .post(url)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send(body),
    patch: (url: string, body: object) =>
      request(app)
        .patch(url)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send(body),
  };
}

const NEW_COLLECTOR = {
  name: 'Koffi Collecteur',
  email: 'Koffi@BTS.test ',
  phone: '+225 07 00 00 01',
  role: 'collector',
  agency_code: 'CI-ABJ',
};

function invitationToken(email: EmailMessage | undefined): string {
  if (email?.kind !== 'invitation') throw new Error('E-mail d’invitation attendu.');
  return new URL(email.data.acceptUrl).searchParams.get('token') ?? '';
}

describe('droits d’accès', () => {
  it.each(['manager', 'collector'] as const)(
    'refuse toutes les routes au rôle %s (403)',
    async (role) => {
      await createAccount({ email: 'agent@bts.test', role });
      const target = await createAccount({ email: 'cible@bts.test' });
      const session = await signIn(app, 'agent@bts.test');

      const responses = await Promise.all([
        as(session).get(USERS),
        as(session).get(`${USERS}/${target.id}`),
        as(session).post(USERS, NEW_COLLECTOR),
        as(session).patch(`${USERS}/${target.id}`, { name: 'Pirate' }),
        as(session).patch(`${USERS}/${target.id}/status`, { active: false }),
        as(session).post(`${USERS}/${target.id}/restore`),
      ]);

      expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
    }
  );

  it('refuse les visiteurs non connectés (401)', async () => {
    const response = await request(app).get(USERS);

    expect(response.status).toBe(401);
  });

  it('exige le jeton CSRF pour une modification, même pour un administrateur', async () => {
    const session = await adminSession();

    const response = await request(app)
      .post(USERS)
      .set('Cookie', session.cookie)
      .send(NEW_COLLECTOR);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('invitation d’un nouveau compte', () => {
  it('crée le compte sans mot de passe, envoie le lien, puis la personne choisit son mot de passe', async () => {
    const admin = await adminSession();

    const created = await as(admin).post(USERS, NEW_COLLECTOR);
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);
    const token = invitationToken(sentEmails[0]);
    const loginBefore = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'koffi@bts.test', password: CHOSEN_PASSWORD });
    const accepted = await request(app)
      .post('/api/v1/auth/invitation/accept')
      .send({ token, password: CHOSEN_PASSWORD });
    const reused = await request(app)
      .post('/api/v1/auth/invitation/accept')
      .send({ token, password: 'un-autre-mot-de-passe' });

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`${USERS}/${created.body.data.id}`);
    expect(created.body.data).toMatchObject({
      email: 'koffi@bts.test',
      role: 'collector',
      active: true,
      invitation_pending: true,
      agency: { code: 'CI-ABJ' },
    });
    expect(sentEmails[0]).toMatchObject({
      kind: 'invitation',
      to: 'koffi@bts.test',
      data: { invitedBy: 'Awa Admin' },
    });
    expect(loginBefore.status).toBe(401);
    expect(accepted.status).toBe(204);
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe('INVALID_INVITATION_TOKEN');
    expect((await signIn(app, 'koffi@bts.test', CHOSEN_PASSWORD)).csrf).toEqual(expect.any(String));
  });

  it('refuse un lien d’invitation de plus de 7 jours', async () => {
    const admin = await adminSession();
    await as(admin).post(USERS, NEW_COLLECTOR);
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);

    now = new Date(START.getTime() + 7 * DAY_MS + 1);
    const accepted = await request(app)
      .post('/api/v1/auth/invitation/accept')
      .send({ token: invitationToken(sentEmails[0]), password: CHOSEN_PASSWORD });

    expect(accepted.status).toBe(400);
  });

  it('refuse une adresse déjà utilisée, quelle que soit la casse', async () => {
    const admin = await adminSession();
    await createAccount({ email: 'koffi@bts.test' });

    const response = await as(admin).post(USERS, NEW_COLLECTOR);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_USED');
  });

  it('refuse une agence inconnue', async () => {
    const admin = await adminSession();

    const response = await as(admin).post(USERS, { ...NEW_COLLECTOR, agency_code: 'XX-000' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_AGENCY');
  });

  it('ignore les champs non prévus (état, mot de passe)', async () => {
    const admin = await adminSession();

    const response = await as(admin).post(USERS, {
      ...NEW_COLLECTOR,
      active: false,
      password_hash: 'injecte',
      archived_at: '2020-01-01',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      active: true,
      archived_at: null,
      invitation_pending: true,
    });
  });
});

describe('liste des comptes', () => {
  it('pagine, cherche et trie, sans les comptes archivés par défaut', async () => {
    const admin = await adminSession();
    await createAccount({ name: 'Bintou', email: 'bintou@bts.test' });
    await createAccount({ name: 'Cédric', email: 'cedric@bts.test' });
    await createAccount({ name: 'Zoé Archivée', email: 'zoe@bts.test', archived: true });

    const page2 = await as(admin).get(`${USERS}?limit=2&page=2&sort=name`);
    const search = await as(admin).get(`${USERS}?search=CEDRIC`);
    const archived = await as(admin).get(`${USERS}?archived=true`);
    const descending = await as(admin).get(`${USERS}?sort=-name`);

    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, hasNext: false });
    expect(page2.body.data.map((user: { name: string }) => user.name)).toEqual(['Cédric']);
    expect(search.body.data).toHaveLength(1);
    expect(archived.body.data.map((user: { email: string }) => user.email)).toEqual([
      'zoe@bts.test',
    ]);
    expect(descending.body.data[0].name).toBe('Cédric');
  });

  it('refuse un tri hors de la liste autorisée', async () => {
    const admin = await adminSession();

    const response = await as(admin).get(`${USERS}?sort=password_hash`);

    expect(response.status).toBe(400);
  });

  it('ne renvoie jamais l’empreinte du mot de passe', async () => {
    const admin = await adminSession();

    const response = await as(admin).get(USERS);

    expect(JSON.stringify(response.body)).not.toMatch(/hash|\$2[aby]\$/);
  });
});

describe('modification d’un compte', () => {
  it('modifie le nom, le téléphone et l’agence', async () => {
    const admin = await adminSession();
    await createAgency('SN-DKR', 'Dakar (Sénégal)', 'SN');
    const target = await createAccount();

    const response = await as(admin).patch(`${USERS}/${target.id}`, {
      name: 'Nouveau Nom',
      phone: '',
      agency_code: 'SN-DKR',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      name: 'Nouveau Nom',
      phone: null,
      agency: { code: 'SN-DKR' },
    });
  });

  it('refuse de prendre l’adresse d’un autre compte', async () => {
    const admin = await adminSession();
    const target = await createAccount();
    await createAccount({ email: 'pris@bts.test' });

    const response = await as(admin).patch(`${USERS}/${target.id}`, { email: 'PRIS@bts.test' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_USED');
  });

  it('refuse de retirer le rôle au dernier administrateur actif', async () => {
    const admin = await adminSession();
    const self = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@bts.test' } });

    const response = await as(admin).patch(`${USERS}/${self.id}`, { role: 'manager' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_ADMIN');
  });

  it('applique un retrait du rôle administrateur dès la requête suivante', async () => {
    const first = await adminSession('premier@bts.test');
    const secondAccount = await createAccount({ email: 'second@bts.test', role: 'admin' });
    const second = await signIn(app, 'second@bts.test');

    const demoted = await as(first).patch(`${USERS}/${secondAccount.id}`, { role: 'manager' });
    const afterDemotion = await as(second).get(USERS);

    expect(demoted.status).toBe(200);
    expect(afterDemotion.status).toBe(403);
  });

  it('répond 404 pour un compte inconnu et 400 pour un identifiant mal formé', async () => {
    const admin = await adminSession();

    const unknown = await as(admin).get(`${USERS}/00000000-0000-7000-8000-000000000000`);
    const malformed = await as(admin).get(`${USERS}/pas-un-uuid`);

    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');
    expect(malformed.status).toBe(400);
  });
});

describe('activation et désactivation', () => {
  it('refuse qu’un administrateur se désactive lui-même', async () => {
    const admin = await adminSession();
    const self = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@bts.test' } });

    const response = await as(admin).patch(`${USERS}/${self.id}/status`, { active: false });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SELF_DEACTIVATION');
  });

  it('coupe immédiatement l’accès du compte désactivé, puis le rend à la réactivation', async () => {
    const admin = await adminSession();
    const target = await createAccount({ email: 'agent@bts.test' });
    const targetSession = await signIn(app, 'agent@bts.test');

    const deactivated = await as(admin).patch(`${USERS}/${target.id}/status`, { active: false });
    const meAfter = await as(targetSession).get('/api/v1/auth/me');
    const refreshAfter = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', targetSession.cookie);
    const reactivated = await as(admin).patch(`${USERS}/${target.id}/status`, { active: true });

    expect(deactivated.body.data.active).toBe(false);
    expect(meAfter.status).toBe(401);
    expect(refreshAfter.status).toBe(401);
    expect(reactivated.body.data.active).toBe(true);
    expect((await signIn(app, 'agent@bts.test')).csrf).toEqual(expect.any(String));
  });
});

describe('restauration d’un compte archivé', () => {
  it('rend l’accès au compte et le remet dans la liste principale', async () => {
    const admin = await adminSession();
    const archived = await createAccount({ email: 'parti@bts.test', archived: true });

    const restored = await as(admin).post(`${USERS}/${archived.id}/restore`);
    const list = await as(admin).get(USERS);

    expect(restored.status).toBe(200);
    expect(restored.body.data.archived_at).toBeNull();
    expect(list.body.data.map((user: { email: string }) => user.email)).toContain('parti@bts.test');
    expect((await signIn(app, 'parti@bts.test')).csrf).toEqual(expect.any(String));
  });
});
