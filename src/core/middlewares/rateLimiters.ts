import { rateLimit } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import { errorBody } from '../http/apiResponse.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const GLOBAL_LIMIT = 300;
const SENSITIVE_LIMIT = 10;
/** Assez pour suivre ses colis plusieurs fois, trop peu pour essayer des numéros en masse. */
const TRACKING_LIMIT = 30;

const tooManyRequests = errorBody(
  'TOO_MANY_REQUESTS',
  'Trop de requêtes. Réessayez dans quelques minutes.'
);

// Des fonctions plutôt que des constantes : chaque appel crée ses propres compteurs, ce qui
// isole une application de test de la suivante.
function limitPerIp(limit: number) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
    message: tooManyRequests,
  });
}

/** Limite générale appliquée à toute l'API, par adresse IP. */
export function createGlobalRateLimiter() {
  return limitPerIp(GLOBAL_LIMIT);
}

/** Limite stricte pour les routes sensibles : connexion, mot de passe, liens reçus par e-mail. */
export function createSensitiveRateLimiter() {
  return limitPerIp(SENSITIVE_LIMIT);
}

/** Limite du suivi public : empêche de deviner des numéros de suivi en masse. */
export function createTrackingRateLimiter() {
  return limitPerIp(TRACKING_LIMIT);
}
