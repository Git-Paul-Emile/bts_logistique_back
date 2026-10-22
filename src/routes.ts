// Routeur de l'API versionnée, monté sur /api/v1 dans app.ts.
// Chaque fonctionnalité expose son propre routeur, branché ici sur son préfixe. Exemple futur :
//   apiRouter.use('/packages', packagesRouter);
import { Router } from 'express';

export const apiRouter: Router = Router();
