import type { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { errorBody } from '../http/apiResponse.js';
import { Prisma } from '../../generated/prisma/client.js';

// Codes d'erreur Prisma traduits en réponses compréhensibles.
// Liste complète : https://www.prisma.io/docs/orm/reference/error-reference
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';

/**
 * Middleware d'erreur unique, placé en dernier dans app.ts.
 * Il ne renvoie jamais de stack trace, de message Prisma ou de nom de table au client.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(errorBody(error.code, error.message, error.details));
    return;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    res
      .status(StatusCodes.BAD_REQUEST)
      .json(errorBody('VALIDATION_ERROR', 'Certaines données sont invalides.', details));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === PRISMA_UNIQUE_VIOLATION) {
      res
        .status(StatusCodes.CONFLICT)
        .json(errorBody('ALREADY_EXISTS', 'Cette valeur est déjà utilisée.'));
      return;
    }
    if (error.code === PRISMA_RECORD_NOT_FOUND) {
      res.status(StatusCodes.NOT_FOUND).json(errorBody('NOT_FOUND', 'Ressource introuvable.'));
      return;
    }
  }

  // Erreur imprévue : on la journalise avec son contexte, le client reçoit un message générique.
  req.log.error({ err: error }, 'Erreur non gérée');
  res
    .status(StatusCodes.INTERNAL_SERVER_ERROR)
    .json(errorBody('INTERNAL_ERROR', 'Une erreur interne est survenue. Réessayez plus tard.'));
};
