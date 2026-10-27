import { NotFoundError } from '../../core/errors/AppError.js';

/** Aussi renvoyée pour le client d'une autre agence : un collecteur n'apprend pas qu'il existe. */
export class ClientNotFoundError extends NotFoundError {
  constructor() {
    super('Ce client est introuvable.', 'CLIENT_NOT_FOUND');
  }
}
