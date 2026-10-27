// Ajoute à la requête Express la session vérifiée par le middleware `authenticate`.
import type { AuthContext } from '../features/auth/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Présent seulement après le middleware `authenticate`. */
      auth?: AuthContext;
    }
  }
}

export {};
