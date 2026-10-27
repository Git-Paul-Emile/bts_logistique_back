// Tableau de bord (F12). Un collecteur voit l'activité de son agence et sa propre marge ;
// l'équipe voit toutes les agences et les chiffres financiers.
import { clock } from '../../lib/clock.js';
import type { PackageStatus } from '../../generated/prisma/enums.js';
import type { Viewer } from '../auth/auth.service.js';
import {
  ACTIVE_STATUSES,
  dashboardRepository,
  type ActiveStatus,
  type Period,
} from './dashboard.repository.js';

const VOLUME_DECIMALS = 4;

export interface DashboardDto {
  /** Mois des indicateurs mensuels, AAAA-MM (UTC). */
  month: string;
  /** Colis en cours dans chaque statut, tous les mois confondus. */
  packages_in_progress: Record<ActiveStatus, number>;
  month_activity: {
    packages: number;
    volume_cbm: number;
    /** Collecteur : sa marge du mois. Équipe : total des marges dues aux collecteurs. */
    collector_margin: number;
  };
  /** Réservé à l'équipe ; null pour un collecteur. */
  finance: {
    revenue: number;
    collected: number;
    total_due: number;
    debtor_count: number;
    shipments_under_way: number;
  } | null;
}

/** Mois demandé (AAAA-MM), ou le mois en cours, en bornes UTC. */
function periodOf(month: string | undefined): { label: string; period: Period } {
  const label = month ?? clock.now().toISOString().slice(0, 7);
  const [year, monthNumber] = label.split('-').map(Number) as [number, number];
  return {
    label,
    period: {
      from: new Date(Date.UTC(year, monthNumber - 1, 1)),
      to: new Date(Date.UTC(year, monthNumber, 1)),
    },
  };
}

function activeStatuses(
  counts: Partial<Record<PackageStatus, number>>
): Record<ActiveStatus, number> {
  return Object.fromEntries(
    ACTIVE_STATUSES.map((status) => [status, counts[status] ?? 0])
  ) as Record<ActiveStatus, number>;
}

/** Chiffres réservés à l'équipe. Le chiffre d'affaires vient de l'activité du mois déjà lue. */
async function financeOf(period: Period, revenue: number): Promise<DashboardDto['finance']> {
  const [collected, receivables, shipmentsUnderWay] = await Promise.all([
    dashboardRepository.collected(period),
    dashboardRepository.receivables(),
    dashboardRepository.shipmentsUnderWay(),
  ]);
  return {
    revenue,
    collected,
    total_due: receivables.totalDue,
    debtor_count: receivables.debtorCount,
    shipments_under_way: shipmentsUnderWay,
  };
}

export const dashboardService = {
  async summary(viewer: Viewer, month?: string): Promise<DashboardDto> {
    const { label, period } = periodOf(month);
    const isCollector = viewer.role === 'collector';
    const agencyId = isCollector ? viewer.agencyId : undefined;
    const [statusCounts, activity, ownMargin] = await Promise.all([
      dashboardRepository.activePackagesByStatus(agencyId),
      dashboardRepository.monthPackages(period, agencyId),
      isCollector ? dashboardRepository.collectorMargin(period, viewer.userId) : null,
    ]);
    const finance = isCollector ? null : await financeOf(period, activity.revenue);
    return {
      month: label,
      packages_in_progress: activeStatuses(statusCounts),
      month_activity: {
        packages: activity.count,
        volume_cbm: Number(activity.volumeCbm.toFixed(VOLUME_DECIMALS)),
        collector_margin: ownMargin ?? activity.collectorMargins,
      },
      finance,
    };
  },
};
