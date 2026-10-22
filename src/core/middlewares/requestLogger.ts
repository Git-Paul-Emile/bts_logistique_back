import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../../lib/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Journalise chaque requête et lui attribue un identifiant unique.
 * L'identifiant est renvoyé dans l'en-tête X-Request-Id : avec lui, on retrouve toute la trace
 * d'une requête dans les logs. Chaque handler dispose aussi de `req.log` pour journaliser.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
