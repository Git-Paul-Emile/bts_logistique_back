// Logger structuré (JSON) partagé par toute l'application. Remplace console.log.
// En développement, pino-pretty rend les logs lisibles ; en production, ils restent en JSON
// pour être collectés par l'hébergeur ou l'outil de supervision.
import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL,
  // Ne jamais écrire de secrets ou de données d'authentification dans les logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
    ],
    censor: '[masqué]',
  },
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
    },
  }),
});
