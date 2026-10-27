// Tests d'intégration de F1 : de la requête HTTP jusqu'à PostgreSQL (PGlite).
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/core/middlewares/errorHandler.js';
import { authenticate, requireCsrf } from '../src/features/auth/auth.middleware.js';
import type { EmailMessage } from '../src/infrastructure/email/emailMessages.js';
import { clock } from '../src/lib/clock.js';
import { createAccount, DEFAULT_PASSWORD } from './factories/accountFactory.js';
import { queuedEmails } from './helpers/emails.js';
import { resetTestDatabase } from './helpers/testDatabase.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const AUTH = '/api/v1/auth';
const FRONT_ORIGIN = 'http://localhost:5173';
const START = new Date('2026-10-22T08:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NEW_PASSWORD = 'nouveau-mot-de-passe-2026';

let now = START;
let sentEmails: EmailMessage[] = [];

beforeEach(async () => {
  await resetTestDatabase();
  now = START;
  sentEmails = [];
  vi.spyOn(clock, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Lien de réinitialisation contenu dans l'e-mail envoyé. */
function resetUrlOf(email: EmailMessage | undefined): string {
  if (email?.kind !== 'password_reset') throw new Error('E-mail de réinitialisation attendu.');
  return email.data.resetUrl;
}

function advance(ms: number) {
  now = new Date(now.getTime() + ms);
}

/** Valeur d'un cookie posé par la réponse, ou undefined. */
function cookieValue(response: request.Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((line) => line.startsWith(`${name}=`));
  return cookie?.split(';')[0]?.slice(name.length + 1);
}

function setCookieLine(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((line) => line.startsWith(`${name}=`)) ?? '';
}

async function login(app = createApp(), email = 'marie@bts.test', password = DEFAULT_PASSWORD) {
  return request(app).post(`${AUTH}/login`).send({ email, password });
}

describe('connexion', () => {
  it('ouvre une session avec des cookies HttpOnly et renvoie le profil sans données internes', async () => {
    await createAccount({ email: 'marie@bts.test', name: 'Marie Kouassi', role: 'admin' });

    const response = await login();

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: expect.any(String),
      name: 'Marie Kouassi',
      email: 'marie@bts.test',
      phone: null,
      role: 'admin',
      agency: { code: 'CI-ABJ', name: "Abidjan (Côte d'Ivoire)" },
      initials: 'MK',
    });
    expect(response.body.data.csrf_token).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash/i);
    expect(setCookieLine(response, 'bts_access')).toMatch(/HttpOnly/);
    expect(setCookieLine(response, 'bts_access')).toMatch(/SameSite=Lax/);
    expect(setCookieLine(response, 'bts_access')).toMatch(/Path=\/api\/v1;/);
    expect(setCookieLine(response, 'bts_refresh')).toMatch(/Path=\/api\/v1\/auth;/);
  });

  it('accepte l’adresse quelle que soit la casse et les espaces saisis', async () => {
    await createAccount({ email: 'marie@bts.test' });

    const response = await login(createApp(), '  Marie@BTS.test ');

    expect(response.status).toBe(200);
  });

  it('répond exactement pareil pour un mot de passe faux et un compte inconnu', async () => {
    await createAccount({ email: 'marie@bts.test' });

    const wrongPassword = await login(createApp(), 'marie@bts.test', 'pas-le-bon-mot-de-passe');
    const unknownAccount = await login(createApp(), 'inconnu@bts.test', 'pas-le-bon-mot-de-passe');

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownAccount.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuse un compte désactivé ou archivé, même avec le bon mot de passe', async () => {
    await createAccount({ email: 'off@bts.test', active: false });
    await createAccount({ email: 'archive@bts.test', archived: true });

    const disabled = await login(createApp(), 'off@bts.test');
    const archived = await login(createApp(), 'archive@bts.test');

    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(archived.status).toBe(403);
  });

  it('refuse un compte invité qui n’a pas encore choisi de mot de passe', async () => {
    await createAccount({ email: 'invite@bts.test', password: null });

    const response = await login(createApp(), 'invite@bts.test');

    expect(response.status).toBe(401);
  });

  it('bloque les tentatives répétées (429)', async () => {
    const app = createApp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await login(app, 'x@bts.test', 'mauvais')).status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('refuse une connexion envoyée depuis une origine non autorisée', async () => {
    await createAccount({ email: 'marie@bts.test' });

    const response = await request(createApp())
      .post(`${AUTH}/login`)
      .set('Origin', 'https://site-malveillant.example')
      .send({ email: 'marie@bts.test', password: DEFAULT_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('session', () => {
  it('donne la personne connectée sur /me, et 401 sans session', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const agent = request.agent(createApp());
    const opened = await agent.post(`${AUTH}/login`).send({
      email: 'marie@bts.test',
      password: DEFAULT_PASSWORD,
    });

    const me = await agent.get(`${AUTH}/me`);
    const anonymous = await request(createApp()).get(`${AUTH}/me`);

    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('marie@bts.test');
    expect(me.body.data.csrf_token).toBe(opened.body.data.csrf_token);
    expect(anonymous.status).toBe(401);
  });

  it('n’accepte plus le jeton d’accès après 15 minutes', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const agent = request.agent(createApp());
    await agent.post(`${AUTH}/login`).send({ email: 'marie@bts.test', password: DEFAULT_PASSWORD });

    const beforeExpiry = await agent.get(`${AUTH}/me`);
    advance(16 * MINUTE_MS);
    const afterExpiry = await agent.get(`${AUTH}/me`);

    expect(beforeExpiry.status).toBe(200);
    expect(afterExpiry.status).toBe(401);
  });

  it('refuse /me dès que le compte est désactivé', async () => {
    const account = await createAccount({ email: 'marie@bts.test' });
    const agent = request.agent(createApp());
    await agent.post(`${AUTH}/login`).send({ email: 'marie@bts.test', password: DEFAULT_PASSWORD });
    const { prisma } = await import('../src/lib/prisma.js');
    await prisma.user.update({ where: { id: account.id }, data: { active: false } });

    const me = await agent.get(`${AUTH}/me`);

    expect(me.status).toBe(401);
  });
});

describe('rafraîchissement', () => {
  it('remplace le jeton à chaque usage', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const opened = await login(app);
    const firstRefresh = cookieValue(opened, 'bts_refresh');

    const refreshed = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${firstRefresh}`);

    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, 'bts_refresh')).toEqual(expect.any(String));
    expect(cookieValue(refreshed, 'bts_refresh')).not.toBe(firstRefresh);
    expect(refreshed.body.data.csrf_token).not.toBe(opened.body.data.csrf_token);
  });

  it('révoque toute la connexion si un jeton déjà utilisé est présenté de nouveau', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const stolen = cookieValue(await login(app), 'bts_refresh');
    const legitimate = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${stolen}`);
    const legitimateToken = cookieValue(legitimate, 'bts_refresh');

    const replay = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${stolen}`);
    const afterReplay = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${legitimateToken}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');
    expect(setCookieLine(replay, 'bts_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(afterReplay.status).toBe(401);
  });

  it('refuse un jeton expiré après 7 jours', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const token = cookieValue(await login(app), 'bts_refresh');

    advance(7 * DAY_MS + MINUTE_MS);
    const response = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${token}`);

    expect(response.status).toBe(401);
  });

  it('refuse le rafraîchissement sans cookie', async () => {
    const response = await request(createApp()).post(`${AUTH}/refresh`);

    expect(response.status).toBe(401);
  });
});

describe('déconnexion', () => {
  it('ferme la session et efface les cookies', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const token = cookieValue(await login(app), 'bts_refresh');

    const logout = await request(app).post(`${AUTH}/logout`).set('Cookie', `bts_refresh=${token}`);
    const refreshAfter = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${token}`);

    expect(logout.status).toBe(204);
    expect(setCookieLine(logout, 'bts_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(refreshAfter.status).toBe(401);
  });
});

describe('déconnexion immédiate', () => {
  it('refuse aussitôt le jeton d’accès de la session fermée, même renvoyé tel quel', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const opened = await login(app);
    const access = `bts_access=${cookieValue(opened, 'bts_access')}`;
    const refresh = `bts_refresh=${cookieValue(opened, 'bts_refresh')}`;

    const before = await request(app).get(`${AUTH}/me`).set('Cookie', access);
    await request(app).post(`${AUTH}/logout`).set('Cookie', refresh);
    const after = await request(app).get(`${AUTH}/me`).set('Cookie', access);

    expect(before.status).toBe(200);
    expect(after.status).toBe(401);
  });
});

describe('mot de passe oublié', () => {
  it('répond 204 sans envoyer d’e-mail pour une adresse inconnue', async () => {
    const response = await request(createApp())
      .post(`${AUTH}/password/forgot`)
      .send({ email: 'inconnu@bts.test' });

    expect(response.status).toBe(204);
    expect(await queuedEmails()).toHaveLength(0);
  });

  it('permet de choisir un nouveau mot de passe avec le lien reçu, une seule fois', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    const oldSession = cookieValue(await login(app), 'bts_refresh');

    const forgot = await request(app)
      .post(`${AUTH}/password/forgot`)
      .send({ email: 'marie@bts.test' });
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);
    const resetUrl = new URL(resetUrlOf(sentEmails[0]));
    const token = resetUrl.searchParams.get('token');
    const reset = await request(app)
      .post(`${AUTH}/password/reset`)
      .send({ token, password: NEW_PASSWORD });
    const reused = await request(app)
      .post(`${AUTH}/password/reset`)
      .send({ token, password: 'encore-un-autre-mot-2026' });

    expect(forgot.status).toBe(204);
    expect(resetUrl.pathname).toBe('/reinitialiser-mot-de-passe');
    expect(reset.status).toBe(204);
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe('INVALID_RESET_TOKEN');
    expect((await login(app)).status).toBe(401);
    expect((await login(app, 'marie@bts.test', NEW_PASSWORD)).status).toBe(200);
    const oldRefresh = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', `bts_refresh=${oldSession}`);
    expect(oldRefresh.status).toBe(401);
  });

  it('refuse un lien de plus d’une heure', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const app = createApp();
    await request(app).post(`${AUTH}/password/forgot`).send({ email: 'marie@bts.test' });
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);
    const token = new URL(resetUrlOf(sentEmails[0])).searchParams.get('token');

    advance(61 * MINUTE_MS);
    const reset = await request(app)
      .post(`${AUTH}/password/reset`)
      .send({ token, password: NEW_PASSWORD });

    expect(reset.status).toBe(400);
  });

  it('impose au moins 12 caractères', async () => {
    const response = await request(createApp())
      .post(`${AUTH}/password/reset`)
      .send({ token: 'quelconque', password: 'court' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('protection CSRF', () => {
  function protectedApp() {
    const app = express();
    app.use(cookieParser());
    app.post('/action', authenticate, requireCsrf, (_req, res) => {
      res.status(200).json({ success: true, data: { done: true } });
    });
    app.use(errorHandler);
    return app;
  }

  it('exige le jeton CSRF de la session pour une modification', async () => {
    await createAccount({ email: 'marie@bts.test' });
    const opened = await login();
    const access = cookieValue(opened, 'bts_access');
    const csrf = opened.body.data.csrf_token as string;
    const app = protectedApp();

    const withoutHeader = await request(app).post('/action').set('Cookie', `bts_access=${access}`);
    const wrongHeader = await request(app)
      .post('/action')
      .set('Cookie', `bts_access=${access}`)
      .set('X-CSRF-Token', 'jeton-invente');
    const rightHeader = await request(app)
      .post('/action')
      .set('Origin', FRONT_ORIGIN)
      .set('Cookie', `bts_access=${access}`)
      .set('X-CSRF-Token', csrf);

    expect(withoutHeader.status).toBe(403);
    expect(withoutHeader.body.error.code).toBe('CSRF_INVALID');
    expect(wrongHeader.status).toBe(403);
    expect(rightHeader.status).toBe(200);
  });
});
