import { prisma } from '../../lib/prisma.js';

export const healthRepository = {
  /** Envoie la requête la plus simple possible : elle échoue si la base ne répond pas. */
  async pingDatabase(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};
