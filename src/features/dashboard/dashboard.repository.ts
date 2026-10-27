// Indicateurs du tableau de bord (F12), tous calculés par PostgreSQL : des agrégats, jamais
// des listes de lignes rapatriées puis additionnées en JavaScript.
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PackageStatus } from '../../generated/prisma/enums.js';
import { clientBalancesSql } from '../clients/clients.repository.js';

export interface Period {
  from: Date;
  /** Exclu : début du mois suivant. */
  to: Date;
}

/** Colis du mois qui comptent : un colis annulé n'est ni facturé ni expédié. */
function monthPackages(period: Period, agencyId?: string): Prisma.PackageWhereInput {
  return {
    agencyId,
    createdAt: { gte: period.from, lt: period.to },
    status: { not: 'cancelled' },
  };
}

const SHIPMENTS_UNDER_WAY = ['loading', 'in_transit', 'customs'] as const;

/**
 * Statuts des colis en cours. Les colis terminés (livrés, retournés, annulés) s'accumulent sans
 * fin : les compter forcerait à parcourir toute la table, pour un total qui n'aide à aucune
 * décision. Les en-cours restent en nombre limité et l'index sur le statut sert.
 */
export const ACTIVE_STATUSES = ['registered', 'in_transit', 'arrived', 'on_hold'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const dashboardRepository = {
  async activePackagesByStatus(agencyId?: string): Promise<Partial<Record<PackageStatus, number>>> {
    const groups = await prisma.package.groupBy({
      by: ['status'],
      where: { agencyId, status: { in: [...ACTIVE_STATUSES] } },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  },

  async monthPackages(period: Period, agencyId?: string) {
    const totals = await prisma.package.aggregate({
      where: monthPackages(period, agencyId),
      _count: { _all: true },
      _sum: { cubicMeter: true, finalPrice: true, collectorMargin: true },
    });
    return {
      count: totals._count._all,
      volumeCbm: totals._sum.cubicMeter?.toNumber() ?? 0,
      revenue: totals._sum.finalPrice?.toNumber() ?? 0,
      collectorMargins: totals._sum.collectorMargin?.toNumber() ?? 0,
    };
  },

  /** Marge gagnée par un collecteur sur les colis qu'il a enregistrés dans le mois. */
  async collectorMargin(period: Period, collectorId: string): Promise<number> {
    const totals = await prisma.package.aggregate({
      where: { ...monthPackages(period), collectorId },
      _sum: { collectorMargin: true },
    });
    return totals._sum.collectorMargin?.toNumber() ?? 0;
  },

  /** Encaissé dans le mois, annulations déduites. */
  async collected(period: Period): Promise<number> {
    const totals = await prisma.payment.aggregate({
      where: { createdAt: { gte: period.from, lt: period.to } },
      _sum: { amount: true },
    });
    return totals._sum.amount?.toNumber() ?? 0;
  },

  /** Reste dû par l'ensemble des clients débiteurs, avec la même définition du solde que F5. */
  async receivables(): Promise<{ totalDue: number; debtorCount: number }> {
    const [row] = await prisma.$queryRaw<[{ total_due: Prisma.Decimal | null; debtors: bigint }]>`
      SELECT SUM(b.balance) AS total_due, COUNT(*) AS debtors
      FROM (${clientBalancesSql(Prisma.sql`TRUE`)}) AS b
      WHERE b.balance > 0`;
    return { totalDue: Number(row.total_due ?? 0), debtorCount: Number(row.debtors) };
  },

  shipmentsUnderWay(): Promise<number> {
    return prisma.shipment.count({ where: { status: { in: [...SHIPMENTS_UNDER_WAY] } } });
  },
};
