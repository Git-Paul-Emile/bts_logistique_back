import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { createSensitiveRateLimiter } from '../../core/middlewares/rateLimiters.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf } from '../auth/auth.middleware.js';
import { changePassword, deleteAccount, updateProfile } from './profile.controller.js';
import {
  changePasswordBodySchema,
  deleteAccountBodySchema,
  updateProfileBodySchema,
} from './profile.schemas.js';

/**
 * Routes /me : ouvertes à tous les rôles, chacun sur son propre compte uniquement.
 * La lecture du profil se fait par GET /auth/me.
 */
export function createProfileRouter(): Router {
  const router = Router();
  // Les routes qui vérifient le mot de passe actuel sont limitées : une session volée ne doit
  // pas permettre de le deviner par essais successifs.
  const passwordCheckLimiter = createSensitiveRateLimiter();
  router.use(authenticate, requireCsrf);

  router.patch('/', validate({ body: updateProfileBodySchema }), asyncHandler(updateProfile));
  router.post(
    '/password',
    passwordCheckLimiter,
    validate({ body: changePasswordBodySchema }),
    asyncHandler(changePassword)
  );
  router.delete(
    '/',
    passwordCheckLimiter,
    validate({ body: deleteAccountBodySchema }),
    asyncHandler(deleteAccount)
  );

  return router;
}
