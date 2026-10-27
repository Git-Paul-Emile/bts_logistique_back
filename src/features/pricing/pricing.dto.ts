// Deux vues de la grille : publique (prix clients seuls) et administrateur (prix et marges).
// La vue publique est construite sans les marges : elles ne quittent jamais le serveur pour
// un visiteur ou un collecteur (rules/20-qualite/security.md, filtrage côté serveur).
import type { TransportMode } from '../../generated/prisma/enums.js';
import type { RateRecord } from './pricing.repository.js';

export type PricingGridRecord = Record<TransportMode, RateRecord>;

export interface PublicPricingDto {
  rates: Record<TransportMode, { client_rate_per_cbm: number }>;
  updated_at: string;
}

export interface AdminPricingDto {
  rates: Record<TransportMode, { client_rate_per_cbm: number; collector_margin_per_cbm: number }>;
  updated_at: string;
}

/** Date du changement de tarif le plus récent, tous modes confondus. */
function lastUpdate(grid: PricingGridRecord): string {
  const latest = Math.max(grid.sea.effectiveFrom.getTime(), grid.air.effectiveFrom.getTime());
  return new Date(latest).toISOString();
}

export function toPublicPricingDto(grid: PricingGridRecord): PublicPricingDto {
  return {
    rates: {
      sea: { client_rate_per_cbm: grid.sea.clientRatePerCbm },
      air: { client_rate_per_cbm: grid.air.clientRatePerCbm },
    },
    updated_at: lastUpdate(grid),
  };
}

export function toAdminPricingDto(grid: PricingGridRecord): AdminPricingDto {
  const withMargin = (rate: RateRecord) => ({
    client_rate_per_cbm: rate.clientRatePerCbm,
    collector_margin_per_cbm: rate.collectorMarginPerCbm,
  });
  return {
    rates: { sea: withMargin(grid.sea), air: withMargin(grid.air) },
    updated_at: lastUpdate(grid),
  };
}
