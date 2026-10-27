import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { idParamSchema } from '../../core/validation/common.schemas.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import {
  createUser,
  getUser,
  listUsers,
  restoreUser,
  setUserStatus,
  updateUser,
} from './users.controller.js';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  userStatusBodySchema,
} from './users.schemas.js';

/** Routes /users : gestion des comptes du personnel, réservée aux administrateurs. */
export function createUsersRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf, requireRole('admin'));

  router.get('/', validate({ query: listUsersQuerySchema }), asyncHandler(listUsers));
  router.post('/', validate({ body: createUserBodySchema }), asyncHandler(createUser));
  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(getUser));
  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateUserBodySchema }),
    asyncHandler(updateUser)
  );
  router.patch(
    '/:id/status',
    validate({ params: idParamSchema, body: userStatusBodySchema }),
    asyncHandler(setUserStatus)
  );
  router.post('/:id/restore', validate({ params: idParamSchema }), asyncHandler(restoreUser));

  return router;
}
