// Traduction HTTP des conteneurs et lots.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successBody } from '../../core/http/apiResponse.js';
import { API_PREFIX } from '../../core/http/paths.js';
import type { IdParam } from '../../core/validation/common.schemas.js';
import type {
  AssignPackagesBody,
  CreateShipmentBody,
  ListShipmentsQuery,
  ShipmentPackageParams,
  ShipmentStatusBody,
  UpdateShipmentBody,
} from './shipments.schemas.js';
import { shipmentsService } from './shipments.service.js';

/** GET /shipments?search=&status=&transport_mode=&sort=-created_at */
export async function listShipments(_req: Request, res: Response) {
  const { items, meta } = await shipmentsService.list(res.locals['query'] as ListShipmentsQuery);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /shipments/:id : conteneur et colis chargés. */
export async function getShipment(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await shipmentsService.detail(id)));
}

/** POST /shipments */
export async function createShipment(req: Request, res: Response) {
  const shipment = await shipmentsService.create(req.body as CreateShipmentBody);
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/shipments/${shipment.id}`)
    .json(successBody(shipment));
}

/** PATCH /shipments/:id */
export async function updateShipment(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const shipment = await shipmentsService.update(id, req.body as UpdateShipmentBody);
  res.status(StatusCodes.OK).json(successBody(shipment));
}

/** PATCH /shipments/:id/status */
export async function changeShipmentStatus(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const shipment = await shipmentsService.changeStatus(id, req.body as ShipmentStatusBody);
  res.status(StatusCodes.OK).json(successBody(shipment));
}

/** POST /shipments/:id/packages : chargement de colis. */
export async function assignPackages(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const shipment = await shipmentsService.assignPackages(id, req.body as AssignPackagesBody);
  res.status(StatusCodes.OK).json(successBody(shipment));
}

/** DELETE /shipments/:id/packages/:packageId : retrait d'un colis chargé par erreur. */
export async function removePackage(req: Request, res: Response) {
  const { id, packageId } = req.params as ShipmentPackageParams;
  res.status(StatusCodes.OK).json(successBody(await shipmentsService.removePackage(id, packageId)));
}
