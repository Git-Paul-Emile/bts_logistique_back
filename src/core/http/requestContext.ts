// Contexte de la requête en cours, accessible partout sans passer `req` : l'identifiant de
// requête relie une trace d'audit ou un log à la requête HTTP qui l'a produit.
// Les services restent sans dépendance à Express (rules/00-socle/architecture.md).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Identifiant de la requête en cours, ou null hors requête HTTP (script, tâche planifiée). */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** À placer après le logger de requêtes, qui attribue `req.id`. */
export const requestContext: RequestHandler = (req, _res, next) => {
  storage.run({ requestId: String(req.id) }, next);
};
