// Empreintes des lignes déjà importées depuis Excel : un même fichier importé deux fois ne
// recrée pas les lignes qui n'ont pas de clé naturelle (paiements, colis sans numéro).
import { prisma } from '../../lib/prisma.js';

export const importsRepository = {
  async fingerprints(entity: string): Promise<string[]> {
    const rows = await prisma.importFingerprint.findMany({
      where: { entity },
      select: { fingerprint: true },
    });
    return rows.map((row) => row.fingerprint);
  },

  /** Ajoute les empreintes ; celles déjà connues sont ignorées (contrainte d'unicité). */
  async addFingerprints(entity: string, fingerprints: string[], now: Date): Promise<void> {
    await prisma.importFingerprint.createMany({
      data: fingerprints.map((fingerprint) => ({ entity, fingerprint, createdAt: now })),
      skipDuplicates: true,
    });
  },
};
