// Traduction HTTP de la grille tarifaire.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import type { UpdatePricingBody } from './pricing.schemas.js';
import { pricingService } from './pricing.service.js';

/** Les prix publics changent rarement : les navigateurs et un CDN peuvent les garder une minute. */
const PUBLIC_CACHE = 'public, max-age=60';
/** Les marges ne doivent rester dans aucun cache partagé. */
const PRIVATE_NO_STORE = 'private, no-store';

/** GET /pricing : prix clients en vigueur, pour le simulateur du site. Sans connexion. */
export async function getPublicPricing(_req: Request, res: Response) {
  const grid = await pricingService.publicGrid();
  res.set('Cache-Control', PUBLIC_CACHE).status(StatusCodes.OK).json(successBody(grid));
}

/** GET /pricing/admin : prix et marges (administrateur). */
export async function getAdminPricing(_req: Request, res: Response) {
  const grid = await pricingService.adminGrid();
  res.set('Cache-Control', PRIVATE_NO_STORE).status(StatusCodes.OK).json(successBody(grid));
}

/** PUT /pricing : remplace la grille ; l'ancienne reste dans l'historique. */
export async function updatePricing(req: Request, res: Response) {
  if (!req.auth) throw new UnauthorizedError();
  const grid = await pricingService.update(req.body as UpdatePricingBody, req.auth.userId);
  res.set('Cache-Control', PRIVATE_NO_STORE).status(StatusCodes.OK).json(successBody(grid));
}
