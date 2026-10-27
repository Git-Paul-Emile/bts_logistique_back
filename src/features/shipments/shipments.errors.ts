// Erreurs des conteneurs et lots. Codes stables, testés par le front.
import { ConflictError, NotFoundError } from '../../core/errors/AppError.js';
import type { ShipmentStatus } from '../../generated/prisma/enums.js';

export class ShipmentNotFoundError extends NotFoundError {
  constructor() {
    super('Ce conteneur est introuvable.', 'SHIPMENT_NOT_FOUND');
  }
}

export class ContainerNumberTakenError extends ConflictError {
  constructor() {
    super('Ce numéro de conteneur ou de vol est déjà enregistré.', 'CONTAINER_NUMBER_TAKEN');
  }
}

export class ShipmentClosedError extends ConflictError {
  constructor() {
    super('Ce conteneur est dépoté : il ne peut plus être modifié.', 'SHIPMENT_CLOSED');
  }
}

export class ShipmentNotLoadingError extends ConflictError {
  constructor() {
    super(
      'Ce conteneur est déjà parti : on ne peut plus y ajouter ou en retirer des colis.',
      'SHIPMENT_NOT_LOADING'
    );
  }
}

export class InvalidShipmentTransitionError extends ConflictError {
  constructor(from: ShipmentStatus, to: ShipmentStatus) {
    super(
      `Un conteneur ne peut pas passer de « ${from} » à « ${to} ».`,
      'INVALID_STATUS_TRANSITION'
    );
  }
}

export class CapacityExceededError extends ConflictError {
  constructor(remainingCbm: number) {
    super(
      `Capacité insuffisante : il reste ${remainingCbm.toLocaleString('fr-FR')} m³ dans ce conteneur.`,
      'CAPACITY_EXCEEDED'
    );
  }
}

export class CapacityBelowLoadError extends ConflictError {
  constructor(loadedCbm: number) {
    super(
      `Le conteneur contient déjà ${loadedCbm.toLocaleString('fr-FR')} m³ : la capacité ne peut pas être inférieure.`,
      'CAPACITY_BELOW_LOAD'
    );
  }
}

/** Un colis ne peut pas entrer dans ce conteneur ; `reason` dit pourquoi. */
export class PackageNotLoadableError extends ConflictError {
  constructor(trackingNumber: string, reason: string) {
    super(
      `Le colis ${trackingNumber} ne peut pas être chargé : ${reason}.`,
      'PACKAGE_NOT_LOADABLE'
    );
  }
}

export class PackageNotInShipmentError extends NotFoundError {
  constructor() {
    super('Ce colis n’est pas dans ce conteneur.', 'PACKAGE_NOT_IN_SHIPMENT');
  }
}
