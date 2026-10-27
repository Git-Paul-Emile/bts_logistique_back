// Colis tel qu'il est renvoyé au front (type Package de front/src/types/index.ts).
import type { PackageStatus, PaymentStatus, TransportMode } from '../../generated/prisma/enums.js';
import type { PackageDetailRecord, PackageRecord } from './packages.repository.js';

type Place = { code: string; name: string };

export interface PackageDto {
  id: string;
  tracking_number: string;
  client: { id: string; name: string };
  agency: Place;
  collector: { id: string; name: string } | null;
  shipment_id: string | null;
  description: string | null;
  transport_mode: TransportMode;
  origin: Place;
  destination: Place;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  cubic_meter: number;
  rate_per_cbm: number;
  final_price: number;
  /** Comprise dans final_price. Visible du personnel : le collecteur voit ce qu'il gagne. */
  collector_margin: number;
  status: PackageStatus;
  payment_status: PaymentStatus;
  amount_paid: number;
  created_at: string;
  updated_at: string;
}

export interface PackageEventDto {
  id: string;
  status: PackageStatus;
  location: Place | null;
  location_detail: string | null;
  comment: string | null;
  agent: { id: string; name: string } | null;
  created_at: string;
}

export interface PackageDetailDto extends PackageDto {
  /** Du plus récent au plus ancien. */
  events: PackageEventDto[];
}

export function toPackageDto(pkg: PackageRecord): PackageDto {
  return {
    id: pkg.id,
    tracking_number: pkg.trackingNumber,
    client: pkg.client,
    agency: pkg.agency,
    collector: pkg.collector,
    shipment_id: pkg.shipmentId,
    description: pkg.description,
    transport_mode: pkg.transportMode,
    origin: pkg.origin,
    destination: pkg.destination,
    length_cm: pkg.lengthCm.toNumber(),
    width_cm: pkg.widthCm.toNumber(),
    height_cm: pkg.heightCm.toNumber(),
    weight_kg: pkg.weightKg.toNumber(),
    cubic_meter: pkg.cubicMeter.toNumber(),
    rate_per_cbm: pkg.ratePerCbm.toNumber(),
    final_price: pkg.finalPrice.toNumber(),
    collector_margin: pkg.collectorMargin.toNumber(),
    status: pkg.status,
    payment_status: pkg.paymentStatus,
    amount_paid: pkg.amountPaid.toNumber(),
    created_at: pkg.createdAt.toISOString(),
    updated_at: pkg.updatedAt.toISOString(),
  };
}

export function toPackageDetailDto(pkg: PackageDetailRecord): PackageDetailDto {
  return {
    ...toPackageDto(pkg),
    events: pkg.events.map((event) => ({
      id: event.id,
      status: event.status,
      location: event.location,
      location_detail: event.locationDetail,
      comment: event.comment,
      agent: event.agent,
      created_at: event.createdAt.toISOString(),
    })),
  };
}
