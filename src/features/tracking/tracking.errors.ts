import { NotFoundError } from '../../core/errors/AppError.js';

/** Même réponse pour un numéro inexistant ou mal formé : rien n'aide à deviner les numéros. */
export class TrackingNotFoundError extends NotFoundError {
  constructor() {
    super('Aucun colis ne correspond à ce numéro. Vérifiez-le et réessayez.', 'TRACKING_NOT_FOUND');
  }
}
