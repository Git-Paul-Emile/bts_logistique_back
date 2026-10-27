// Ouvre une session de test et renvoie de quoi l'utiliser : cookie d'accès et jeton CSRF.
import type { Express } from 'express';
import request from 'supertest';
import { DEFAULT_PASSWORD } from '../factories/accountFactory.js';

export interface TestSession {
  cookie: string;
  csrf: string;
}

/** Valeur d'un cookie posé par une réponse, ou undefined. */
export function cookieValue(response: request.Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((line) => line.startsWith(`${name}=`));
  return cookie?.split(';')[0]?.slice(name.length + 1);
}

export async function signIn(
  app: Express,
  email: string,
  password = DEFAULT_PASSWORD
): Promise<TestSession> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Connexion de test refusée (${response.status}) pour ${email}`);
  }
  return {
    cookie: `bts_access=${cookieValue(response, 'bts_access')}; bts_refresh=${cookieValue(response, 'bts_refresh')}`,
    csrf: response.body.data.csrf_token as string,
  };
}
