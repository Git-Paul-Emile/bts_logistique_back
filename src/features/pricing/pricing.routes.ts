import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import { getAdminPricing, getPublicPricing, updatePricing } from './pricing.controller.js';
import { updatePricingBodySchema } from './pricing.schemas.js';

/** Routes /pricing : lecture publique des prix, lecture et modification des marges par un admin. */
export function createPricingRouter(): Router {
  const router = Router();
  const adminOnly = [authenticate, requireCsrf, requireRole('admin')];

  router.get('/', asyncHandler(getPublicPricing));
  router.get('/admin', ...adminOnly, asyncHandler(getAdminPricing));
  router.put(
    '/',
    ...adminOnly,
    validate({ body: updatePricingBodySchema }),
    asyncHandler(updatePricing)
  );

  return router;
}
