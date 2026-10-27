// Traduction HTTP des colis.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import { API_PREFIX } from '../../core/http/paths.js';
import type { IdParam } from '../../core/validation/common.schemas.js';
import type { Viewer } from '../auth/auth.service.js';
import type {
  CreatePackageBody,
  ListPackagesQuery,
  PackageEventBody,
  UpdatePackageBody,
} from './packages.schemas.js';
import { packagesService } from './packages.service.js';

function viewerOf(req: Request): Viewer {
  if (!req.auth) throw new UnauthorizedError();
  return { userId: req.auth.userId, role: req.auth.role, agencyId: req.auth.agencyId };
}

/** GET /packages?search=&status=&payment_status=&transport_mode=&agency_code=&client_id= */
export async function listPackages(req: Request, res: Response) {
  const query = res.locals['query'] as ListPackagesQuery;
  const { items, meta } = await packagesService.list(viewerOf(req), query);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /packages/:id : colis et historique complet de ses étapes. */
export async function getPackage(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await packagesService.detail(viewerOf(req), id)));
}

/** POST /packages : enregistrement, numéro de suivi et prix calculés par le serveur. */
export async function createPackage(req: Request, res: Response) {
  const pkg = await packagesService.register(viewerOf(req), req.body as CreatePackageBody);
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/packages/${pkg.id}`)
    .json(successBody(pkg));
}

/** PATCH /packages/:id */
export async function updatePackage(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const pkg = await packagesService.update(viewerOf(req), id, req.body as UpdatePackageBody);
  res.status(StatusCodes.OK).json(successBody(pkg));
}

/** POST /packages/:id/tracking-email : renvoie le lien de suivi au client (202 : envoi différé). */
export async function sendTrackingEmail(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  await packagesService.sendTrackingLink(viewerOf(req), id);
  res.status(StatusCodes.ACCEPTED).end();
}

/** POST /packages/:id/events : nouvelle étape de suivi (changement de statut). */
export async function addPackageEvent(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const pkg = await packagesService.addEvent(viewerOf(req), id, req.body as PackageEventBody);
  res.status(StatusCodes.CREATED).json(successBody(pkg));
}
