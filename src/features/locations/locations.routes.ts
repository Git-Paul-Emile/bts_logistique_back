import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { listLocations } from './locations.controller.js';

/** Route publique /locations : les formulaires envoient des codes de lieu, pas des libellés. */
export function createLocationsRouter(): Router {
  const router = Router();
  router.get('/', asyncHandler(listLocations));
  return router;
}
