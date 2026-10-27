// Middlewares à placer sur toute route réservée au personnel connecté.
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../core/errors/AppError.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import type { UserRole } from '../../generated/prisma/enums.js';
import { ACCESS_COOKIE, readCookie } from './auth.cookies.js';
import { authService } from './auth.service.js';
import { verifyAccessToken } from './auth.tokens.js';

const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Vérifie le jeton d'accès du cookie, relit le compte en base et range la session dans
 * `req.auth`. Sans session valable, ou si le compte a été désactivé ou archivé : 401.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = readCookie(req.cookies, ACCESS_COOKIE);
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) throw new UnauthorizedError();
  req.auth = await authService.resolveSession(claims);
  next();
});

/** Réserve la route aux rôles listés (403 pour les autres). À placer après `authenticate`. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

function sameToken(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Protection CSRF des modifications : l'en-tête X-CSRF-Token doit porter le jeton signé dans
 * le jeton d'accès. Un site tiers peut faire envoyer le cookie, mais ne peut pas lire ce jeton,
 * qui n'est renvoyé qu'au front autorisé par CORS. À placer après `authenticate`.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const received = req.get(CSRF_HEADER);
  if (!req.auth || !received || !sameToken(received, req.auth.csrf)) {
    next(
      new ForbiddenError('Jeton de sécurité absent ou invalide. Rechargez la page.', 'CSRF_INVALID')
    );
    return;
  }
  next();
};
