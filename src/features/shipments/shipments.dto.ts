// Conteneur tel qu'il est renvoyé au front (type Shipment de front/src/types/index.ts).
import type { PackageStatus, ShipmentStatus, TransportMode } from '../../generated/prisma/enums.js';
import type { ShipmentLoad, ShipmentRecord, ShipmentsQueries } from './shipments.repository.js';

type Place = { code: string; name: string };
type LoadedPackage = Awaited<ReturnType<ShipmentsQueries['packagesOf']>>[number];

const VOLUME_DECIMALS = 4;

export interface ShipmentDto {
  id: string;
  container_number: string;
  transport_mode: TransportMode;
  carrier: string;
  status: ShipmentStatus;
  origin: Place;
  destination: Place;
  max_volume_cbm: number;
  /** Somme des volumes des colis chargés. */
  current_volume_cbm: number;
  package_count: number;
  departure_date: string | null;
  estimated_arrival: string | null;
  actual_arrival: string | null;
  notes: string | null;
  created_at: string;
}

export interface ShipmentDetailDto extends ShipmentDto {
  packages: {
    id: string;
    tracking_number: string;
    client_name: string;
    status: PackageStatus;
    cubic_meter: number;
  }[];
}

/** Date seule (colonne DATE), au format AAAA-MM-JJ. */
function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function toShipmentDto(shipment: ShipmentRecord, load: ShipmentLoad): ShipmentDto {
  return {
    id: shipment.id,
    container_number: shipment.containerNumber,
    transport_mode: shipment.transportMode,
    carrier: shipment.carrier,
    status: shipment.status,
    origin: shipment.origin,
    destination: shipment.destination,
    max_volume_cbm: shipment.maxVolumeCbm.toNumber(),
    current_volume_cbm: Number(load.volumeCbm.toFixed(VOLUME_DECIMALS)),
    package_count: load.packageCount,
    departure_date: toDateOnly(shipment.departureDate),
    estimated_arrival: toDateOnly(shipment.estimatedArrival),
    actual_arrival: toDateOnly(shipment.actualArrival),
    notes: shipment.notes,
    created_at: shipment.createdAt.toISOString(),
  };
}

export function toShipmentDetailDto(
  shipment: ShipmentRecord,
  load: ShipmentLoad,
  packages: LoadedPackage[]
): ShipmentDetailDto {
  return {
    ...toShipmentDto(shipment, load),
    packages: packages.map((pkg) => ({
      id: pkg.id,
      tracking_number: pkg.trackingNumber,
      client_name: pkg.client.name,
      status: pkg.status,
      cubic_meter: pkg.cubicMeter.toNumber(),
    })),
  };
}
