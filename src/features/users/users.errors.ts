// Erreurs de la gestion des comptes. Codes stables, testés par le front
// (EMAIL_ALREADY_USED et LAST_ADMIN existent déjà dans front/src/api/endpoints/users.api.ts).
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors/AppError.js';

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('Ce compte est introuvable.', 'USER_NOT_FOUND');
  }
}

export class EmailAlreadyUsedError extends ConflictError {
  constructor() {
    super('Cette adresse e-mail est déjà utilisée par un autre compte.', 'EMAIL_ALREADY_USED');
  }
}

export class UnknownAgencyError extends BadRequestError {
  constructor() {
    super('Cette agence n’existe pas.', 'UNKNOWN_AGENCY');
  }
}

/** La plateforme doit toujours garder au moins un administrateur actif. */
export class LastAdminError extends ConflictError {
  constructor() {
    super(
      'C’est le dernier administrateur actif : nommez d’abord un autre administrateur.',
      'LAST_ADMIN'
    );
  }
}

/** Se désactiver soi-même ferait perdre l'accès à la gestion des comptes. */
export class SelfDeactivationError extends ConflictError {
  constructor() {
    super('Vous ne pouvez pas désactiver votre propre compte.', 'SELF_DEACTIVATION');
  }
}
