// Erreurs des paiements. Codes stables, testés par le front.
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors/AppError.js';

export class PaymentNotFoundError extends NotFoundError {
  constructor() {
    super('Ce paiement est introuvable.', 'PAYMENT_NOT_FOUND');
  }
}

/** Un colis de la répartition n'existe pas ou appartient à un autre client. */
export class PackageNotOfClientError extends BadRequestError {
  constructor(packageId: string) {
    super('Un colis de la répartition n’appartient pas à ce client.', 'PACKAGE_NOT_OF_CLIENT', {
      package_id: packageId,
    });
  }
}

export class CancelledPackageError extends ConflictError {
  constructor(trackingNumber: string) {
    super(
      `Le colis ${trackingNumber} est annulé : il ne peut plus être réglé.`,
      'PACKAGE_CANCELLED'
    );
  }
}

export class ExceedsRemainingError extends ConflictError {
  constructor(trackingNumber: string, remaining: number) {
    super(
      `La part du colis ${trackingNumber} dépasse son reste à payer : ${remaining.toLocaleString('fr-FR')} F CFA.`,
      'EXCEEDS_REMAINING'
    );
  }
}

export class AlreadyReversedError extends ConflictError {
  constructor() {
    super('Ce paiement a déjà été annulé.', 'ALREADY_REVERSED');
  }
}

export class CannotReverseReversalError extends ConflictError {
  constructor() {
    super(
      'Une écriture d’annulation ne s’annule pas : enregistrez un nouveau paiement.',
      'CANNOT_REVERSE_REVERSAL'
    );
  }
}
