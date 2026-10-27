// Traduction HTTP des lieux du réseau.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successBody } from '../../core/http/apiResponse.js';
import { locationsService } from './locations.service.js';

/** Le réseau change rarement : les navigateurs et un CDN peuvent garder la liste cinq minutes. */
const LOCATIONS_CACHE = 'public, max-age=300';

/** GET /locations : villes de départ et d'arrivée, et leur agence. Sans connexion. */
export async function listLocations(_req: Request, res: Response) {
  const locations = await locationsService.list();
  res.set('Cache-Control', LOCATIONS_CACHE).status(StatusCodes.OK).json(successBody(locations));
}
