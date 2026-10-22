import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('socle de l’API', () => {
  it('répond sur /health sans dépendre de la base', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('renvoie un identifiant de requête dans les en-têtes', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('répond 404 au format d’erreur standard pour une route inconnue', async () => {
    const response = await request(app).get('/api/v1/route-inexistante');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route introuvable : GET /api/v1/route-inexistante',
      },
    });
  });

  it('applique les en-têtes de sécurité de helmet', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
