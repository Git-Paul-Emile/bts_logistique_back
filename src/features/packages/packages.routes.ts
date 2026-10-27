import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { idParamSchema } from '../../core/validation/common.schemas.js';
import { authenticate, requireCsrf } from '../auth/auth.middleware.js';
import {
  addPackageEvent,
  createPackage,
  getPackage,
  listPackages,
  sendTrackingEmail,
  updatePackage,
} from './packages.controller.js';
import {
  createPackageBodySchema,
  listPackagesQuerySchema,
  packageEventBodySchema,
  updatePackageBodySchema,
} from './packages.schemas.js';

/**
 * Routes /packages, ouvertes à tous les rôles. Le périmètre d'un collecteur (son agence) et
 * le tarif personnalisé réservé à l'équipe sont vérifiés par le service, sur chaque colis.
 */
export function createPackagesRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf);

  router.get('/', validate({ query: listPackagesQuerySchema }), asyncHandler(listPackages));
  router.post('/', validate({ body: createPackageBodySchema }), asyncHandler(createPackage));
  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(getPackage));
  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updatePackageBodySchema }),
    asyncHandler(updatePackage)
  );
  router.post(
    '/:id/events',
    validate({ params: idParamSchema, body: packageEventBodySchema }),
    asyncHandler(addPackageEvent)
  );
  router.post(
    '/:id/tracking-email',
    validate({ params: idParamSchema }),
    asyncHandler(sendTrackingEmail)
  );

  return router;
}
