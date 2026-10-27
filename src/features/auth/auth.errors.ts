// Erreurs de l'authentification. Les codes sont stables : le front les teste pour afficher
// le bon message.
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../core/errors/AppError.js';

/** Même réponse pour un compte inconnu et un mot de passe faux : rien ne révèle quelles adresses existent. */
export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Adresse e-mail ou mot de passe incorrect.', 'INVALID_CREDENTIALS');
  }
}

/** Renvoyée seulement après un mot de passe correct, pour ne rien révéler aux autres. */
export class AccountDisabledError extends ForbiddenError {
  constructor() {
    super('Ce compte est désactivé. Contactez un administrateur.', 'ACCOUNT_DISABLED');
  }
}

export class SessionExpiredError extends UnauthorizedError {
  constructor() {
    super('Votre session a expiré. Reconnectez-vous.', 'SESSION_EXPIRED');
  }
}

export class InvalidResetTokenError extends BadRequestError {
  constructor() {
    super(
      'Ce lien de réinitialisation n’est plus valable. Demandez-en un nouveau.',
      'INVALID_RESET_TOKEN'
    );
  }
}

export class InvalidEmailTokenError extends BadRequestError {
  constructor() {
    super(
      'Ce lien de confirmation n’est plus valable. Refaites la demande depuis votre profil.',
      'INVALID_EMAIL_TOKEN'
    );
  }
}

export class InvalidInvitationTokenError extends BadRequestError {
  constructor() {
    super(
      'Ce lien d’invitation n’est plus valable. Demandez à un administrateur de vous inviter de nouveau.',
      'INVALID_INVITATION_TOKEN'
    );
  }
}
