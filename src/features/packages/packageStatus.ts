// Cycle de vie d'un colis : les changements de statut autorisés.
import type { PackageStatus } from '../../generated/prisma/enums.js';

/**
 * Statuts suivants possibles depuis chaque statut. Un statut non terminal peut aussi être
 * répété, pour ajouter une étape de suivi (nouveau port, nouveau commentaire).
 * Livré, retourné et annulé sont terminaux : plus aucun changement.
 */
const NEXT_STATUSES: Record<PackageStatus, readonly PackageStatus[]> = {
  registered: ['registered', 'in_transit', 'on_hold', 'cancelled'],
  in_transit: ['in_transit', 'arrived', 'on_hold', 'returned'],
  on_hold: ['on_hold', 'in_transit', 'arrived', 'returned', 'cancelled'],
  arrived: ['arrived', 'delivered', 'on_hold', 'returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function canMoveTo(current: PackageStatus, next: PackageStatus): boolean {
  return NEXT_STATUSES[current].includes(next);
}

/** Un colis terminé ne se modifie plus : ses dimensions et son prix sont définitifs. */
export function isClosed(status: PackageStatus): boolean {
  return NEXT_STATUSES[status].length === 0;
}
