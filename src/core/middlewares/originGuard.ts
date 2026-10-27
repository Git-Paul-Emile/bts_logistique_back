import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { ForbiddenError } from '../errors/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse toute modification envoyée par un navigateur depuis une origine non autorisée.
 * CORS seul ne bloque rien côté serveur : il empêche seulement de lire la réponse.
 * Couvre aussi les routes sans session (connexion, mot de passe oublié), que le jeton CSRF
 * ne peut pas protéger. Une requête sans en-tête Origin ne vient pas d'un navigateur moderne :
 * elle n'emporte donc pas les cookies d'une victime et passe.
 */
export const originGuard: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (SAFE_METHODS.has(req.method) || !origin || env.CORS_ORIGINS.includes(origin)) {
    next();
    return;
  }
  next(new ForbiddenError('Origine de la requête non autorisée.', 'ORIGIN_NOT_ALLOWED'));
};
