import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { idParamSchema } from '../../core/validation/common.schemas.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import {
  assignPackages,
  changeShipmentStatus,
  createShipment,
  getShipment,
  listShipments,
  removePackage,
  updateShipment,
} from './shipments.controller.js';
import {
  assignPackagesBodySchema,
  createShipmentBodySchema,
  listShipmentsQuerySchema,
  shipmentPackageParamsSchema,
  shipmentStatusBodySchema,
  updateShipmentBodySchema,
} from './shipments.schemas.js';

/** Routes /shipments : conteneurs et lots, réservés à l'équipe (administrateur, gestionnaire). */
export function createShipmentsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf, requireRole('admin', 'manager'));

  router.get('/', validate({ query: listShipmentsQuerySchema }), asyncHandler(listShipments));
  router.post('/', validate({ body: createShipmentBodySchema }), asyncHandler(createShipment));
  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(getShipment));
  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateShipmentBodySchema }),
    asyncHandler(updateShipment)
  );
  router.patch(
    '/:id/status',
    validate({ params: idParamSchema, body: shipmentStatusBodySchema }),
    asyncHandler(changeShipmentStatus)
  );
  router.post(
    '/:id/packages',
    validate({ params: idParamSchema, body: assignPackagesBodySchema }),
    asyncHandler(assignPackages)
  );
  router.delete(
    '/:id/packages/:packageId',
    validate({ params: shipmentPackageParamsSchema }),
    asyncHandler(removePackage)
  );

  return router;
}
