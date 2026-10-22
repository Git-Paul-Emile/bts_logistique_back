import type { RequestHandler } from 'express';
import type { z } from 'zod';

interface RequestSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

/**
 * Valide la requête avec des schémas Zod, avant le controller.
 * Les champs non déclarés dans un schéma sont retirés (protection contre l'assignation de masse).
 * - body et params validés remplacent req.body et req.params ;
 * - query validée est rangée dans res.locals.query, car req.query est en lecture seule en Express 5.
 * En cas d'erreur, la ZodError part au middleware d'erreur, qui répond 400 avec le détail par champ.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) res.locals['query'] = schemas.query.parse(req.query);
    next();
  };
}
