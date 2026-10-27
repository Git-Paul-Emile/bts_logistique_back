import { NotFoundError } from '../../core/errors/AppError.js';

/** Aucun tarif n'a encore été saisi : un administrateur doit d'abord remplir la grille. */
export class PricingNotConfiguredError extends NotFoundError {
  constructor() {
    super('Les tarifs ne sont pas encore renseignés.', 'PRICING_NOT_CONFIGURED');
  }
}
