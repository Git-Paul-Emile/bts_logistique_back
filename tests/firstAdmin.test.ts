import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createFirstAdmin } from '../src/features/users/firstAdmin.service.js';
import { createAccount } from './factories/accountFactory.js';
import { resetTestDatabase } from './helpers/testDatabase.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const ADMIN = {
  name: 'Awa Traoré',
  email: 'awa@bts.test',
  agencyCode: 'CI-ABJ',
  password: 'premier-admin-2026',
};

beforeEach(async () => {
  await resetTestDatabase();
});

describe('création du premier administrateur', () => {
  it('crée un administrateur qui peut ensuite se connecter', async () => {
    // Crée l'agence CI-ABJ avec un compte non administrateur.
    await createAccount({ role: 'collector' });

    await createFirstAdmin(ADMIN);
    const login = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('admin');
  });

  it('refuse d’en créer un second quand un administrateur actif existe', async () => {
    await createAccount({ role: 'admin' });

    await expect(createFirstAdmin(ADMIN)).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' });
  });

  it('refuse une agence inconnue', async () => {
    await expect(createFirstAdmin({ ...ADMIN, agencyCode: 'XX-000' })).rejects.toMatchObject({
      code: 'AGENCY_NOT_FOUND',
    });
  });
});
