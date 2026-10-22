// Point d'entrée : démarre le serveur HTTP et gère l'arrêt propre.
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = createApp().listen(env.PORT, () => {
  logger.info(`API démarrée sur http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Arrêt propre : on termine les requêtes en cours et on ferme la base avant de quitter.
// L'hébergeur envoie SIGTERM à chaque redéploiement ; Ctrl+C envoie SIGINT en local.
function shutdown(signal: NodeJS.Signals) {
  logger.info(`Signal ${signal} reçu, arrêt en cours.`);
  const forceExit = setTimeout(() => {
    logger.error('Arrêt forcé : des requêtes ne se sont pas terminées à temps.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Serveur arrêté.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Une promesse rejetée sans traitement est un bug : on la journalise et on s'arrête,
// l'hébergeur redémarrera le processus dans un état sain.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Promesse rejetée non traitée');
  process.exit(1);
});
