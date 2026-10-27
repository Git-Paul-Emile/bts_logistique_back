// Réponse publique du suivi : ce qu'un visiteur qui connaît le numéro peut voir, et rien de plus
// (rules/20-qualite/security.md : filtrer côté serveur, jamais masquer côté client).
import type { PackageStatus, TransportMode } from '../../generated/prisma/enums.js';
import type { TrackingRecord } from './tracking.repository.js';

type Place = { code: string; name: string };

export interface PublicTrackingDto {
  tracking_number: string;
  status: PackageStatus;
  transport_mode: TransportMode;
  /** Initiales seulement (« K. I. ») : le nom complet n'est pas public (règle validée par BTS). */
  recipient_initials: string;
  origin: Place;
  destination: Place;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  cubic_meter: number;
  created_at: string;
  /** Étapes du plus récent au plus ancien, sans commentaire interne ni nom d'agent. */
  events: {
    status: PackageStatus;
    location: Place | null;
    location_detail: string | null;
    date: string;
  }[];
}

const MAX_INITIALS = 3;

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_INITIALS)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}.`)
    .join(' ');
}

export function toPublicTrackingDto(pkg: TrackingRecord): PublicTrackingDto {
  return {
    tracking_number: pkg.trackingNumber,
    status: pkg.status,
    transport_mode: pkg.transportMode,
    recipient_initials: initialsOf(pkg.client.name),
    origin: pkg.origin,
    destination: pkg.destination,
    length_cm: pkg.lengthCm.toNumber(),
    width_cm: pkg.widthCm.toNumber(),
    height_cm: pkg.heightCm.toNumber(),
    weight_kg: pkg.weightKg.toNumber(),
    cubic_meter: pkg.cubicMeter.toNumber(),
    created_at: pkg.createdAt.toISOString(),
    events: pkg.events.map((event) => ({
      status: event.status,
      location: event.location,
      location_detail: event.locationDetail,
      date: event.createdAt.toISOString(),
    })),
  };
}
