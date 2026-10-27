import { BadRequestError } from '../../core/errors/AppError.js';

/** Le mot de passe actuel, demandé avant une action sensible, est faux. */
export class WrongCurrentPasswordError extends BadRequestError {
  constructor() {
    super('Le mot de passe actuel est incorrect.', 'WRONG_CURRENT_PASSWORD');
  }
}

export class SamePasswordError extends BadRequestError {
  constructor() {
    super('Le nouveau mot de passe doit être différent de l’actuel.', 'SAME_PASSWORD');
  }
}
