import { StatusCodes } from 'http-status-codes';

/**
 * Erreur métier connue. Les services lancent ces erreurs sans rien savoir de HTTP :
 * c'est le middleware d'erreur qui les traduit en réponse.
 * `code` est un identifiant stable que le front peut tester (ex. EMAIL_ALREADY_USED).
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Requête invalide.', code = 'BAD_REQUEST', details?: unknown) {
    super(message, StatusCodes.BAD_REQUEST, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise.', code = 'UNAUTHORIZED') {
    super(message, StatusCodes.UNAUTHORIZED, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Vous n’avez pas les droits pour cette action.', code = 'FORBIDDEN') {
    super(message, StatusCodes.FORBIDDEN, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Ressource introuvable.', code = 'NOT_FOUND') {
    super(message, StatusCodes.NOT_FOUND, code);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Cette opération entre en conflit avec des données existantes.',
    code = 'CONFLICT'
  ) {
    super(message, StatusCodes.CONFLICT, code);
  }
}
