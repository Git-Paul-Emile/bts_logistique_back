// Traduction HTTP des clients.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import { API_PREFIX } from '../../core/http/paths.js';
import type { IdParam } from '../../core/validation/common.schemas.js';
import type { CreateClientBody, ListClientsQuery, UpdateClientBody } from './clients.schemas.js';
import { clientsService, type Viewer } from './clients.service.js';

function viewerOf(req: Request): Viewer {
  if (!req.auth) throw new UnauthorizedError();
  return { role: req.auth.role, agencyId: req.auth.agencyId };
}

/** GET /clients?search=&has_debt=true&sort=-balance&page=1&limit=20 */
export async function listClients(req: Request, res: Response) {
  const query = res.locals['query'] as ListClientsQuery;
  const { items, meta } = await clientsService.list(viewerOf(req), query);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /clients/:id : fiche, solde, derniers colis et paiements. */
export async function getClient(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await clientsService.detail(viewerOf(req), id)));
}

/** POST /clients */
export async function createClient(req: Request, res: Response) {
  const client = await clientsService.create(viewerOf(req), req.body as CreateClientBody);
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/clients/${client.id}`)
    .json(successBody(client));
}

/** PATCH /clients/:id */
export async function updateClient(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const client = await clientsService.update(viewerOf(req), id, req.body as UpdateClientBody);
  res.status(StatusCodes.OK).json(successBody(client));
}
