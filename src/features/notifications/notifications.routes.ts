import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf } from '../auth/auth.middleware.js';
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  setRead,
} from './notifications.controller.js';
import { listNotificationsQuerySchema, setReadBodySchema } from './notifications.schemas.js';

/** Routes /notifications, ouvertes à tous les rôles ; un collecteur ne voit que son agence. */
export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf);

  router.get(
    '/',
    validate({ query: listNotificationsQuerySchema }),
    asyncHandler(listNotifications)
  );
  router.get('/unread-count', asyncHandler(getUnreadCount));
  router.patch('/read', validate({ body: setReadBodySchema }), asyncHandler(setRead));
  router.post('/read-all', asyncHandler(markAllRead));

  return router;
}
