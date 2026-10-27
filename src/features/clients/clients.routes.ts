import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { idParamSchema } from '../../core/validation/common.schemas.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import { createClient, getClient, listClients, updateClient } from './clients.controller.js';
import {
  createClientBodySchema,
  listClientsQuerySchema,
  updateClientBodySchema,
} from './clients.schemas.js';

/**
 * Routes /clients. Tous les rôles cherchent et créent des clients (le collecteur en a besoin
 * pour enregistrer un colis, dans son agence seulement) ; la fiche financière et la
 * modification sont réservées à l'équipe.
 */
export function createClientsRouter(): Router {
  const router = Router();
  const staffOnly = requireRole('admin', 'manager');
  router.use(authenticate, requireCsrf);

  router.get('/', validate({ query: listClientsQuerySchema }), asyncHandler(listClients));
  router.post('/', validate({ body: createClientBodySchema }), asyncHandler(createClient));
  router.get('/:id', staffOnly, validate({ params: idParamSchema }), asyncHandler(getClient));
  router.patch(
    '/:id',
    staffOnly,
    validate({ params: idParamSchema, body: updateClientBodySchema }),
    asyncHandler(updateClient)
  );

  return router;
}
