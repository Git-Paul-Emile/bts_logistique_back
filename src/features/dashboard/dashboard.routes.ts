import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf } from '../auth/auth.middleware.js';
import { getDashboard } from './dashboard.controller.js';
import { dashboardQuerySchema } from './dashboard.schemas.js';

/** Route /dashboard, ouverte à tous les rôles ; le contenu dépend du rôle et de l'agence. */
export function createDashboardRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf);
  router.get('/', validate({ query: dashboardQuerySchema }), asyncHandler(getDashboard));
  return router;
}
