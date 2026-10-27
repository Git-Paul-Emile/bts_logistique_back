// Traduction HTTP du suivi public.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successBody } from '../../core/http/apiResponse.js';
import type { TrackingParam } from './tracking.schemas.js';
import { trackingService } from './tracking.service.js';

/** Le statut d'un colis change rarement d'une minute à l'autre. */
const TRACKING_CACHE = 'public, max-age=60';

/** GET /tracking/:trackingNumber : étapes du colis, sans connexion. */
export async function getTracking(req: Request, res: Response) {
  const { trackingNumber } = req.params as TrackingParam;
  const tracking = await trackingService.find(trackingNumber);
  res.set('Cache-Control', TRACKING_CACHE).status(StatusCodes.OK).json(successBody(tracking));
}
