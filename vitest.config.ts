import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Valeurs factices : la configuration est validée au chargement, même pour les tests
    // qui ne touchent pas à la base. Une base de test dédiée sera ajoutée avec les premiers modèles.
    env: {
      NODE_ENV: 'test',
      APP_NAME: 'BTS Logistique API (test)',
      PORT: '4001',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5173',
      FRONT_URL: 'http://localhost:5173',
      TRUST_PROXY: 'false',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/bts_logistique_test?schema=public',
      JWT_ACCESS_SECRET: 'secret-de-test-uniquement-pour-vitest-access-0123',
      JWT_REFRESH_SECRET: 'secret-de-test-uniquement-pour-vitest-refresh-4567',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      BCRYPT_ROUNDS: '4',
    },
  },
});
