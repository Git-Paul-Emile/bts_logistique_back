// Routeur de l'API versionnée, monté sur /api/v1 dans app.ts.
// Chaque fonctionnalité expose son propre routeur, branché ici sur son préfixe.
import { Router } from 'express';
import { createAuditRouter } from './features/audit/audit.routes.js';
import { createAuthRouter } from './features/auth/auth.routes.js';
import { createClientsRouter } from './features/clients/clients.routes.js';
import { createDashboardRouter } from './features/dashboard/dashboard.routes.js';
import { createImportsRouter } from './features/imports/imports.routes.js';
import { createLocationsRouter } from './features/locations/locations.routes.js';
import { createNotificationsRouter } from './features/notifications/notifications.routes.js';
import { createPackagesRouter } from './features/packages/packages.routes.js';
import { createPaymentsRouter } from './features/payments/payments.routes.js';
import { createPricingRouter } from './features/pricing/pricing.routes.js';
import { createProfileRouter } from './features/profile/profile.routes.js';
import { createShipmentsRouter } from './features/shipments/shipments.routes.js';
import { createTrackingRouter } from './features/tracking/tracking.routes.js';
import { createUsersRouter } from './features/users/users.routes.js';

export function createApiRouter(): Router {
  const apiRouter = Router();
  apiRouter.use('/auth', createAuthRouter());
  apiRouter.use('/users', createUsersRouter());
  apiRouter.use('/me', createProfileRouter());
  apiRouter.use('/pricing', createPricingRouter());
  apiRouter.use('/clients', createClientsRouter());
  apiRouter.use('/packages', createPackagesRouter());
  apiRouter.use('/tracking', createTrackingRouter());
  apiRouter.use('/payments', createPaymentsRouter());
  apiRouter.use('/shipments', createShipmentsRouter());
  apiRouter.use('/notifications', createNotificationsRouter());
  apiRouter.use('/dashboard', createDashboardRouter());
  apiRouter.use('/audit-logs', createAuditRouter());
  apiRouter.use('/locations', createLocationsRouter());
  apiRouter.use('/import-fingerprints', createImportsRouter());
  return apiRouter;
}
