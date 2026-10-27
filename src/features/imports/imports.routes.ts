import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import { addFingerprints, listFingerprints } from './imports.controller.js';
import { addFingerprintsBodySchema, fingerprintsQuerySchema } from './imports.schemas.js';

/** Routes /import-fingerprints : réservées à l'équipe, seule à importer des fichiers. */
export function createImportsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf, requireRole('admin', 'manager'));
  router.get('/', validate({ query: fingerprintsQuerySchema }), asyncHandler(listFingerprints));
  router.post('/', validate({ body: addFingerprintsBodySchema }), asyncHandler(addFingerprints));
  return router;
}
