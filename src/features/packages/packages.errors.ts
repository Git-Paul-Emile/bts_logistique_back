// Erreurs des colis. Codes stables, testés par le front.
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../core/errors/AppError.js';
import type { PackageStatus } from '../../generated/prisma/enums.js';

/** Aussi renvoyée pour le colis d'une autre agence : un collecteur n'apprend pas qu'il existe. */
export class PackageNotFoundError extends NotFoundError {
  constructor() {
    super('Ce colis est introuvable.', 'PACKAGE_NOT_FOUND');
  }
}

export class UnknownLocationError extends BadRequestError {
  constructor(code: string) {
    super(`Ce lieu n’est pas desservi : ${code}.`, 'UNKNOWN_LOCATION');
  }
}

export class SameRouteError extends BadRequestError {
  constructor() {
    super('La destination doit être différente de l’origine.', 'SAME_ROUTE');
  }
}

export class RateOverrideForbiddenError extends ForbiddenError {
  constructor() {
    super('Seule l’équipe peut appliquer un tarif personnalisé.', 'RATE_OVERRIDE_FORBIDDEN');
  }
}

export class RateBelowMarginError extends BadRequestError {
  constructor() {
    super(
      'Ce tarif est inférieur à la marge du collecteur : choisissez un tarif plus élevé.',
      'RATE_BELOW_MARGIN'
    );
  }
}

export class PaymentExceedsPriceError extends BadRequestError {
  constructor() {
    super('Le montant versé dépasse le prix du colis.', 'PAYMENT_EXCEEDS_PRICE');
  }
}

export class PriceBelowPaidError extends ConflictError {
  constructor() {
    super(
      'Le nouveau prix serait inférieur au montant déjà encaissé pour ce colis.',
      'PRICE_BELOW_PAID'
    );
  }
}

export class PackageClosedError extends ConflictError {
  constructor() {
    super(
      'Ce colis est livré, retourné ou annulé : il ne peut plus être modifié.',
      'PACKAGE_CLOSED'
    );
  }
}

/** Renvoi du lien de suivi impossible : la fiche du client n'a pas d'adresse e-mail. */
export class ClientHasNoEmailError extends ConflictError {
  constructor() {
    super(
      'Ce client n’a pas d’adresse e-mail : copiez le lien de suivi et envoyez-le par message.',
      'CLIENT_HAS_NO_EMAIL'
    );
  }
}

export class InvalidStatusTransitionError extends ConflictError {
  constructor(from: PackageStatus, to: PackageStatus) {
    super(`Un colis ne peut pas passer de « ${from} » à « ${to} ».`, 'INVALID_STATUS_TRANSITION');
  }
}
