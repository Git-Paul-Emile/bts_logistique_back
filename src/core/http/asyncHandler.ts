import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Transmet au middleware d'erreur toute erreur levée par un controller asynchrone.
 * Évite de répéter un try / catch dans chaque controller.
 * Note : Express 5 le fait déjà pour les promesses rejetées ; ce wrapper reste explicite
 * et garantit le même comportement pour les fonctions qui lèvent avant leur premier await.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
