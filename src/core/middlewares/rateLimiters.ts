import { rateLimit } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import { errorBody } from '../http/apiResponse.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const GLOBAL_LIMIT = 300;
const SENSITIVE_LIMIT = 10;

const tooManyRequests = errorBody(
  'TOO_MANY_REQUESTS',
  'Trop de requêtes. Réessayez dans quelques minutes.'
);

/** Limite générale appliquée à toute l'API, par adresse IP. */
export const globalRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: GLOBAL_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: StatusCodes.TOO_MANY_REQUESTS,
  message: tooManyRequests,
});

/**
 * Limite stricte pour les routes sensibles : connexion, mot de passe oublié, suivi public.
 * À placer sur ces routes quand elles seront créées.
 */
export const sensitiveRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: SENSITIVE_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: StatusCodes.TOO_MANY_REQUESTS,
  message: tooManyRequests,
});
