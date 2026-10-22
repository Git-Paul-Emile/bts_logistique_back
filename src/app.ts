// Construction de l'application Express, sans démarrer de serveur.
// Séparée de server.ts pour pouvoir la tester avec Supertest sans ouvrir de port.
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { env } from './config/env.js';
import { globalRateLimiter } from './core/middlewares/rateLimiters.js';
import { requestLogger } from './core/middlewares/requestLogger.js';
import { notFound } from './core/middlewares/notFound.js';
import { errorHandler } from './core/middlewares/errorHandler.js';
import { healthRouter } from './features/health/health.routes.js';
import { apiRouter } from './routes.js';

const JSON_BODY_LIMIT = '100kb';
const API_PREFIX = '/api/v1';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Derrière un proxy (hébergeur, Nginx), lire la vraie IP du client pour le rate limiting.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  // L'ordre des middlewares est imposé par rules/10-stack/backend.md.
  // 1. Sécurité globale
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  // Compression gzip des réponses (rules/20-qualite/performance.md).
  app.use(compression());
  // 2. Parsing
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  // 3. Rate limiting
  app.use(globalRateLimiter);
  // 4. Logging avec identifiant de requête
  app.use(requestLogger);

  // Supervision, hors version de l'API.
  app.use(healthRouter);
  // 5 à 8. Authentification, autorisation, validation et controllers : déclarés route par route
  // dans chaque fonctionnalité, branchée sur ce routeur.
  app.use(API_PREFIX, apiRouter);

  // 9. Route inconnue, puis middleware d'erreur, toujours en dernier.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
