// Lieux du réseau BTS et leur agence (données de référence, remplies par le seeder).
import { prisma } from '../../lib/prisma.js';

export const locationsRepository = {
  /** Lieux actifs, triés par nom, avec l'agence active rattachée s'il y en a une. */
  listActive() {
    return prisma.location.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        code: true,
        name: true,
        countryCode: true,
        isOrigin: true,
        isDestination: true,
        agencies: {
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { code: true, name: true },
          take: 1,
        },
      },
    });
  },
};
