// Cycle de vie d'un conteneur ou d'un lot aérien.
import type { PackageStatus, ShipmentStatus } from '../../generated/prisma/enums.js';

/** Statuts suivants possibles. La douane peut être sautée ; aucun retour en arrière. */
const NEXT_STATUSES: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  planned: ['loading'],
  loading: ['in_transit'],
  in_transit: ['customs', 'arrived'],
  customs: ['arrived'],
  arrived: ['unloaded'],
  unloaded: [],
};

export function canShipmentMoveTo(current: ShipmentStatus, next: ShipmentStatus): boolean {
  return NEXT_STATUSES[current].includes(next);
}

/** On ne charge ou ne décharge des colis qu'avant le départ. */
export function acceptsPackages(status: ShipmentStatus): boolean {
  return status === 'planned' || status === 'loading';
}

/** Un conteneur dépoté est terminé : il ne se modifie plus. */
export function isShipmentClosed(status: ShipmentStatus): boolean {
  return NEXT_STATUSES[status].length === 0;
}

/** Seul un colis encore à l'entrepôt peut entrer dans un conteneur. */
export function isLoadable(status: PackageStatus): boolean {
  return status === 'registered' || status === 'on_hold';
}
