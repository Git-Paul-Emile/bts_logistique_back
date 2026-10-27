// Tests d'intégration de F3 : profil, mot de passe et suppression de son propre compte.
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { EmailMessage } from '../src/infrastructure/email/emailMessages.js';
import { clock } from '../src/lib/clock.js';
import { createAccount, DEFAULT_PASSWORD } from './factories/accountFactory.js';
import { queuedEmails } from './helpers/emails.js';
import { resetTestDatabase } from './helpers/testDatabase.js';
import { signIn, type TestSession } from './helpers/session.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const ME = '/api/v1/me';
const START = new Date('2026-10-22T08:00:00.000Z');
const NEW_PASSWORD = 'nouveau-mot-de-passe-2026';

let app: Express;
let sentEmails: EmailMessage[] = [];

beforeEach(async () => {
  await resetTestDatabase();
  app = createApp();
  sentEmails = [];
  vi.spyOn(clock, 'now').mockReturnValue(START);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function as(session: TestSession) {
  const send = (method: 'patch' | 'post' | 'delete', url: string, body?: object) => {
    const pending = request(app)[method](url);
    return pending.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
  };
  return {
    me: () => request(app).get('/api/v1/auth/me').set('Cookie', session.cookie),
    patch: (body: object) => send('patch', ME, body),
    changePassword: (body: object) => send('post', `${ME}/password`, body),
    deleteAccount: (body: object) => send('delete', ME, body),
  };
}

async function sessionFor(
  email = 'marie@bts.test',
  role: 'admin' | 'manager' | 'collector' = 'collector'
) {
  await createAccount({ email, role, name: 'Marie Kouassi' });
  return signIn(app, email);
}

function confirmToken(email: EmailMessage | undefined): string {
  if (email?.kind !== 'email_change') throw new Error('E-mail de confirmation attendu.');
  return new URL(email.data.confirmUrl).searchParams.get('token') ?? '';
}

function confirm(token: string) {
  return request(app).post('/api/v1/auth/email/confirm').send({ token });
}

describe('coordonnées', () => {
  it('modifie le nom et le téléphone tout de suite, quel que soit le rôle', async () => {
    const session = await sessionFor();

    const response = await as(session).patch({
      name: 'Marie K. Traoré',
      phone: '+225 01 02 03 04',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      user: { name: 'Marie K. Traoré', phone: '+225 01 02 03 04', initials: 'MK' },
      pending_email: null,
    });
  });

  it('exige le jeton CSRF', async () => {
    const session = await sessionFor();

    const response = await request(app).patch(ME).set('Cookie', session.cookie).send({ name: 'X' });

    expect(response.status).toBe(403);
  });
});

describe('changement d’adresse e-mail', () => {
  it('ne change l’adresse qu’après ouverture du lien envoyé à la nouvelle adresse', async () => {
    const session = await sessionFor();

    const requested = await as(session).patch({ email: 'Marie.Nouvelle@bts.test' });
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);
    const meBefore = await as(session).me();
    const confirmed = await confirm(confirmToken(sentEmails[0]));
    const replayed = await confirm(confirmToken(sentEmails[0]));

    expect(requested.body.data.pending_email).toBe('marie.nouvelle@bts.test');
    expect(sentEmails[0]).toMatchObject({ kind: 'email_change', to: 'marie.nouvelle@bts.test' });
    expect(meBefore.body.data.user.email).toBe('marie@bts.test');
    expect(confirmed.status).toBe(204);
    expect(replayed.status).toBe(400);
    expect(replayed.body.error.code).toBe('INVALID_EMAIL_TOKEN');
    expect((await as(session).me()).body.data.user.email).toBe('marie.nouvelle@bts.test');
    expect((await signIn(app, 'marie.nouvelle@bts.test')).csrf).toEqual(expect.any(String));
  });

  it('refuse une adresse déjà utilisée par un autre compte', async () => {
    const session = await sessionFor();
    await createAccount({ email: 'pris@bts.test' });

    const response = await as(session).patch({ email: 'pris@bts.test' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_USED');
    expect(await queuedEmails()).toHaveLength(0);
  });

  it('refuse la confirmation si l’adresse a été prise entre-temps', async () => {
    const session = await sessionFor();
    await as(session).patch({ email: 'convoitee@bts.test' });
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(1);
    await createAccount({ email: 'convoitee@bts.test' });

    const response = await confirm(confirmToken(sentEmails[0]));

    expect(response.status).toBe(409);
    expect((await as(session).me()).body.data.user.email).toBe('marie@bts.test');
  });

  it('ne garde valable que le dernier lien demandé', async () => {
    const session = await sessionFor();
    await as(session).patch({ email: 'premiere@bts.test' });
    await as(session).patch({ email: 'seconde@bts.test' });
    sentEmails = await queuedEmails();
    expect(sentEmails).toHaveLength(2);

    const first = await confirm(confirmToken(sentEmails[0]));
    const second = await confirm(confirmToken(sentEmails[1]));

    expect(first.status).toBe(400);
    expect(second.status).toBe(204);
  });
});

describe('changement de mot de passe', () => {
  it('ferme les autres connexions et garde celle en cours', async () => {
    const current = await sessionFor();
    const otherDevice = await signIn(app, 'marie@bts.test');

    const changed = await as(current).changePassword({
      current_password: DEFAULT_PASSWORD,
      new_password: NEW_PASSWORD,
    });
    const otherRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', otherDevice.cookie);

    expect(changed.status).toBe(204);
    expect((await as(current).me()).status).toBe(200);
    expect((await as(otherDevice).me()).status).toBe(401);
    expect(otherRefresh.status).toBe(401);
    expect((await signIn(app, 'marie@bts.test', NEW_PASSWORD)).csrf).toEqual(expect.any(String));
  });

  it('refuse un mot de passe actuel faux, identique ou un nouveau trop court', async () => {
    const session = await sessionFor();

    const wrong = await as(session).changePassword({
      current_password: 'pas-le-bon',
      new_password: NEW_PASSWORD,
    });
    const same = await as(session).changePassword({
      current_password: DEFAULT_PASSWORD,
      new_password: DEFAULT_PASSWORD,
    });
    const short = await as(session).changePassword({
      current_password: DEFAULT_PASSWORD,
      new_password: 'court',
    });

    expect(wrong.body.error.code).toBe('WRONG_CURRENT_PASSWORD');
    expect(same.body.error.code).toBe('SAME_PASSWORD');
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('suppression de son propre compte', () => {
  it('archive le compte, ferme la session et empêche de se reconnecter', async () => {
    const session = await sessionFor();

    const deleted = await as(session).deleteAccount({ password: DEFAULT_PASSWORD });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'marie@bts.test', password: DEFAULT_PASSWORD });

    expect(deleted.status).toBe(204);
    expect(deleted.headers['set-cookie']?.toString()).toMatch(/bts_access=;/);
    expect((await as(session).me()).status).toBe(401);
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('exige le mot de passe actuel', async () => {
    const session = await sessionFor();

    const response = await as(session).deleteAccount({ password: 'pas-le-bon' });

    expect(response.status).toBe(400);
    expect((await as(session).me()).status).toBe(200);
  });

  it('refuse le départ du dernier administrateur actif, l’accepte s’il en reste un', async () => {
    const onlyAdmin = await sessionFor('admin@bts.test', 'admin');

    const refused = await as(onlyAdmin).deleteAccount({ password: DEFAULT_PASSWORD });
    await createAccount({ email: 'second-admin@bts.test', role: 'admin' });
    const accepted = await as(onlyAdmin).deleteAccount({ password: DEFAULT_PASSWORD });

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('LAST_ADMIN');
    expect(accepted.status).toBe(204);
  });
});
