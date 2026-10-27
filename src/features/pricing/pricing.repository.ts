// Accès base de données de la grille tarifaire (F4). Une ligne par changement de tarif.
import { prisma } from '../../lib/prisma.js';
import { recordAudit, type AuditEntry } from '../audit/audit.repository.js';
import type { TransportMode } from '../../generated/prisma/enums.js';

export interface RateRecord {
  transportMode: TransportMode;
  clientRatePerCbm: number;
  collectorMarginPerCbm: number;
  effectiveFrom: Date;
}

export interface NewRate {
  transportMode: TransportMode;
  clientRatePerCbm: number;
  collectorMarginPerCbm: number;
}

export const pricingRepository = {
  /** Tarif en vigueur d'un mode : le plus récent dont la date d'effet est passée. */
  async findCurrentRate(mode: TransportMode, now: Date): Promise<RateRecord | null> {
    const rate = await prisma.pricingRate.findFirst({
      where: { transportMode: mode, effectiveFrom: { lte: now } },
      // L'identifiant UUID v7 suit l'ordre de création : il départage deux tarifs de même date.
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      select: {
        transportMode: true,
        clientRatePerCbm: true,
        collectorMarginPerCbm: true,
        effectiveFrom: true,
      },
    });
    if (!rate) return null;
    return {
      transportMode: rate.transportMode,
      clientRatePerCbm: rate.clientRatePerCbm.toNumber(),
      collectorMarginPerCbm: rate.collectorMarginPerCbm.toNumber(),
      effectiveFrom: rate.effectiveFrom,
    };
  },

  /** Ajoute les nouveaux tarifs et leur trace d'audit ensemble ; les anciens restent en base. */
  async addRates(
    rates: NewRate[],
    authorId: string,
    effectiveFrom: Date,
    audit: AuditEntry
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.pricingRate.createMany({
        data: rates.map((rate) => ({ ...rate, authorId, effectiveFrom })),
      });
      await recordAudit(tx, audit);
    });
  },
};
