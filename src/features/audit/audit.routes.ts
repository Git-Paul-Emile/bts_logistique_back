import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import { listAuditLogs } from './audit.controller.js';
import { listAuditLogsQuerySchema } from './audit.schemas.js';

/** Route /audit-logs : lecture seule, réservée aux administrateurs. Aucune trace ne se modifie. */
export function createAuditRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf, requireRole('admin'));
  router.get('/', validate({ query: listAuditLogsQuerySchema }), asyncHandler(listAuditLogs));
  return router;
}
