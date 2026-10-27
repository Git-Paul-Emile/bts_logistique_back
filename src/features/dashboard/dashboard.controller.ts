// Traduction HTTP du tableau de bord.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import type { DashboardQuery } from './dashboard.schemas.js';
import { dashboardService } from './dashboard.service.js';

/** GET /dashboard?month=AAAA-MM : indicateurs du mois (par défaut, le mois en cours). */
export async function getDashboard(req: Request, res: Response) {
  if (!req.auth) throw new UnauthorizedError();
  const { month } = res.locals['query'] as DashboardQuery;
  const viewer = { userId: req.auth.userId, role: req.auth.role, agencyId: req.auth.agencyId };
  const summary = await dashboardService.summary(viewer, month);
  res.set('Cache-Control', 'private, no-store').status(StatusCodes.OK).json(successBody(summary));
}
