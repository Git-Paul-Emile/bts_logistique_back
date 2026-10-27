// Règles métier des conteneurs et lots (F9) : création, chargement des colis dans la limite
// de la capacité, et cycle de vie. Le statut du conteneur n'est pas propagé aux colis :
// chaque colis garde son propre suivi, mis à jour depuis sa fiche.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta, parseSort } from '../../core/http/pagination.js';
import { clock } from '../../lib/clock.js';
import { UnknownLocationError } from '../packages/packages.errors.js';
import {
  acceptsPackages,
  canShipmentMoveTo,
  isLoadable,
  isShipmentClosed,
} from './shipmentStatus.js';
import {
  toShipmentDetailDto,
  toShipmentDto,
  type ShipmentDetailDto,
  type ShipmentDto,
} from './shipments.dto.js';
import {
  CapacityBelowLoadError,
  CapacityExceededError,
  ContainerNumberTakenError,
  InvalidShipmentTransitionError,
  PackageNotInShipmentError,
  PackageNotLoadableError,
  ShipmentClosedError,
  ShipmentNotFoundError,
  ShipmentNotLoadingError,
} from './shipments.errors.js';
import { shipmentsRepository, type ShipmentsQueries } from './shipments.repository.js';
import type {
  AssignPackagesBody,
  CreateShipmentBody,
  ListShipmentsQuery,
  ShipmentSortField,
  ShipmentStatusBody,
  UpdateShipmentBody,
} from './shipments.schemas.js';

const SORT_COLUMNS = { created_at: 'createdAt', departure_date: 'departureDate' } as const;
const VOLUME_DECIMALS = 4;

/** « AAAA-MM-JJ » ou null vers une date (colonne DATE), undefined si le champ est absent. */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

const roundVolume = (cbm: number) => Number(cbm.toFixed(VOLUME_DECIMALS));

async function detailOf(queries: ShipmentsQueries, id: string): Promise<ShipmentDetailDto> {
  const shipment = await queries.findById(id);
  if (!shipment) throw new ShipmentNotFoundError();
  const [load, packages] = await Promise.all([queries.loadOf(id), queries.packagesOf(id)]);
  return toShipmentDetailDto(shipment, load, packages);
}

async function placeId(queries: ShipmentsQueries, code: string, role: 'origin' | 'destination') {
  const location = await queries.findLocation(code);
  const allowed = role === 'origin' ? location?.isOrigin : location?.isDestination;
  if (!location?.active || !allowed) throw new UnknownLocationError(code);
  return location.id;
}

/** Vérifie que chaque colis peut entrer dans ce conteneur ; renvoie leur volume total. */
async function loadableVolume(
  queries: ShipmentsQueries,
  shipment: { id: string; transportMode: string; destinationId: string },
  packageIds: string[]
): Promise<number> {
  const packages = await queries.findPackages(packageIds);
  const missing = packageIds.find((id) => !packages.some((pkg) => pkg.id === id));
  if (missing) throw new PackageNotLoadableError(missing, 'colis introuvable');
  for (const pkg of packages) {
    const reject = (reason: string) => new PackageNotLoadableError(pkg.trackingNumber, reason);
    if (pkg.shipmentId === shipment.id) throw reject('il est déjà dans ce conteneur');
    if (pkg.shipmentId) throw reject('il est déjà dans un autre conteneur');
    if (!isLoadable(pkg.status)) throw reject('il n’est plus à l’entrepôt');
    if (pkg.transportMode !== shipment.transportMode) throw reject('mode de transport différent');
    if (pkg.destinationId !== shipment.destinationId) throw reject('destination différente');
  }
  return packages.reduce((sum, pkg) => sum + pkg.cubicMeter.toNumber(), 0);
}

export const shipmentsService = {
  async list(query: ListShipmentsQuery): Promise<{ items: ShipmentDto[]; meta: PaginationMeta }> {
    const sort = parseSort<ShipmentSortField>(query.sort);
    const { items, total } = await shipmentsRepository.list({
      status: query.status,
      transportMode: query.transport_mode,
      search: query.search,
      orderBy: { field: SORT_COLUMNS[sort.field], direction: sort.direction },
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    const loads = await shipmentsRepository.loads(items.map((shipment) => shipment.id));
    return {
      items: items.map((shipment) =>
        toShipmentDto(shipment, loads.get(shipment.id) ?? { volumeCbm: 0, packageCount: 0 })
      ),
      meta: paginationMeta(query.page, query.limit, total),
    };
  },

  detail(id: string): Promise<ShipmentDetailDto> {
    return detailOf(shipmentsRepository, id);
  },

  async create(input: CreateShipmentBody): Promise<ShipmentDetailDto> {
    if (await shipmentsRepository.isContainerNumberTaken(input.container_number)) {
      throw new ContainerNumberTakenError();
    }
    const id = await shipmentsRepository.create({
      containerNumber: input.container_number,
      transportMode: input.transport_mode,
      carrier: input.carrier,
      originId: await placeId(shipmentsRepository, input.origin_code, 'origin'),
      destinationId: await placeId(shipmentsRepository, input.destination_code, 'destination'),
      maxVolumeCbm: input.max_volume_cbm,
      departureDate: toDate(input.departure_date) ?? null,
      estimatedArrival: toDate(input.estimated_arrival) ?? null,
      notes: input.notes ?? null,
    });
    return detailOf(shipmentsRepository, id);
  },

  /** La capacité ne peut pas descendre sous le volume déjà chargé. */
  async update(id: string, input: UpdateShipmentBody): Promise<ShipmentDetailDto> {
    return shipmentsRepository.inTransaction(async (queries) => {
      const shipment = await queries.findShipmentRoute(id);
      if (!shipment) throw new ShipmentNotFoundError();
      if (isShipmentClosed(shipment.status)) throw new ShipmentClosedError();
      if (input.max_volume_cbm !== undefined) {
        const { volumeCbm } = await queries.loadOf(id);
        if (input.max_volume_cbm < volumeCbm)
          throw new CapacityBelowLoadError(roundVolume(volumeCbm));
      }
      await queries.update(id, {
        carrier: input.carrier,
        maxVolumeCbm: input.max_volume_cbm,
        departureDate: toDate(input.departure_date),
        estimatedArrival: toDate(input.estimated_arrival),
        notes: input.notes,
      });
      return detailOf(queries, id);
    });
  },

  /** Passe au statut suivant. À l'arrivée, la date réelle est notée (aujourd'hui par défaut). */
  async changeStatus(id: string, input: ShipmentStatusBody): Promise<ShipmentDetailDto> {
    return shipmentsRepository.inTransaction(async (queries) => {
      const shipment = await queries.findShipmentRoute(id);
      if (!shipment) throw new ShipmentNotFoundError();
      if (!canShipmentMoveTo(shipment.status, input.status)) {
        throw new InvalidShipmentTransitionError(shipment.status, input.status);
      }
      const arrival =
        input.status === 'arrived'
          ? new Date(input.actual_arrival ?? clock.now().toISOString().slice(0, 10))
          : undefined;
      await queries.update(id, { status: input.status, actualArrival: arrival });
      return detailOf(queries, id);
    });
  },

  /** Charge des colis, tout ou rien, dans la limite de la capacité restante. */
  async assignPackages(id: string, input: AssignPackagesBody): Promise<ShipmentDetailDto> {
    return shipmentsRepository.inTransaction(async (queries) => {
      const shipment = await queries.findShipmentRoute(id);
      if (!shipment) throw new ShipmentNotFoundError();
      if (!acceptsPackages(shipment.status)) throw new ShipmentNotLoadingError();
      const added = await loadableVolume(queries, shipment, input.package_ids);
      const { volumeCbm } = await queries.loadOf(id);
      const remaining = shipment.maxVolumeCbm.toNumber() - volumeCbm;
      if (added > remaining) throw new CapacityExceededError(roundVolume(remaining));
      await queries.assign(id, input.package_ids);
      return detailOf(queries, id);
    });
  },

  /** Retire un colis chargé par erreur, tant que le conteneur n'est pas parti. */
  async removePackage(id: string, packageId: string): Promise<ShipmentDetailDto> {
    return shipmentsRepository.inTransaction(async (queries) => {
      const shipment = await queries.findShipmentRoute(id);
      if (!shipment) throw new ShipmentNotFoundError();
      if (!acceptsPackages(shipment.status)) throw new ShipmentNotLoadingError();
      if (!(await queries.unassign(id, packageId))) throw new PackageNotInShipmentError();
      return detailOf(queries, id);
    });
  },
};
