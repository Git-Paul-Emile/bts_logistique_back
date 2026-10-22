import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { errorBody, successBody } from '../../core/http/apiResponse.js';
import { healthRepository } from './health.repository.js';

/** GET /health : l'application répond. Ne vérifie aucune dépendance. */
export function getHealth(_req: Request, res: Response) {
  res
    .status(StatusCodes.OK)
    .json(successBody({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));
}

/** GET /ready : l'application et la base de données répondent. Utilisé par l'hébergeur et la supervision. */
export async function getReadiness(req: Request, res: Response) {
  try {
    await healthRepository.pingDatabase();
    res.status(StatusCodes.OK).json(successBody({ status: 'ready', database: 'up' }));
  } catch (error) {
    req.log.warn({ err: error }, 'Base de données indisponible');
    res
      .status(StatusCodes.SERVICE_UNAVAILABLE)
      .json(errorBody('NOT_READY', 'La base de données ne répond pas.'));
  }
}
