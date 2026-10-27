import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { createTrackingRateLimiter } from '../../core/middlewares/rateLimiters.js';
import { validate } from '../../core/middlewares/validate.js';
import { getTracking } from './tracking.controller.js';
import { trackingParamSchema } from './tracking.schemas.js';

/** Route /tracking : publique, sans connexion, limitée par adresse IP. */
export function createTrackingRouter(): Router {
  const router = Router();
  router.get(
    '/:trackingNumber',
    createTrackingRateLimiter(),
    validate({ params: trackingParamSchema }),
    asyncHandler(getTracking)
  );
  return router;
}
