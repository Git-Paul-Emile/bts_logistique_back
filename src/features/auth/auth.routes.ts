import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { createSensitiveRateLimiter } from '../../core/middlewares/rateLimiters.js';
import { validate } from '../../core/middlewares/validate.js';
import {
  acceptInvitation,
  confirmEmail,
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  resetPassword,
} from './auth.controller.js';
import { authenticate } from './auth.middleware.js';
import {
  confirmEmailBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
} from './auth.schemas.js';

/**
 * Routes /auth. Construites par une fonction : chaque application (et chaque test) a ses propres
 * compteurs de rate limiting.
 * refresh et logout n'exigent pas de jeton CSRF (le jeton d'accès peut avoir expiré) : ils sont
 * protégés par SameSite=Lax, le contrôle d'origine et le chemin restreint du cookie.
 */
export function createAuthRouter(): Router {
  const router = Router();
  const loginLimiter = createSensitiveRateLimiter();
  const passwordLimiter = createSensitiveRateLimiter();

  router.post('/login', loginLimiter, validate({ body: loginBodySchema }), asyncHandler(login));
  router.post('/refresh', asyncHandler(refresh));
  router.post('/logout', asyncHandler(logout));
  router.get('/me', authenticate, asyncHandler(me));
  router.post(
    '/password/forgot',
    passwordLimiter,
    validate({ body: forgotPasswordBodySchema }),
    asyncHandler(forgotPassword)
  );
  router.post(
    '/password/reset',
    passwordLimiter,
    validate({ body: resetPasswordBodySchema }),
    asyncHandler(resetPassword)
  );
  // Même corps que la réinitialisation : le jeton reçu par e-mail et le mot de passe choisi.
  router.post(
    '/invitation/accept',
    passwordLimiter,
    validate({ body: resetPasswordBodySchema }),
    asyncHandler(acceptInvitation)
  );
  router.post(
    '/email/confirm',
    passwordLimiter,
    validate({ body: confirmEmailBodySchema }),
    asyncHandler(confirmEmail)
  );

  return router;
}
