import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors/AppError.js';

/** Toute route non déclarée aboutit ici, avant le middleware d'erreur. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route introuvable : ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
};
