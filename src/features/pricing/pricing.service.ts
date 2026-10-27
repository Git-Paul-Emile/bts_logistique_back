// Règles métier de la grille tarifaire (F4). La marge collecteur est comprise dans le prix
// client (règle validée par BTS le 27/10/2026).
import type { TransportMode } from '../../generated/prisma/enums.js';
import { clock } from '../../lib/clock.js';
import {
  toAdminPricingDto,
  toPublicPricingDto,
  type AdminPricingDto,
  type PricingGridRecord,
  type PublicPricingDto,
} from './pricing.dto.js';
import { PricingNotConfiguredError } from './pricing.errors.js';
import { pricingRepository, type NewRate, type RateRecord } from './pricing.repository.js';
import type { ModeRateInput, UpdatePricingBody } from './pricing.schemas.js';

const MODES: readonly TransportMode[] = ['sea', 'air'];

async function currentGrid(): Promise<PricingGridRecord> {
  const now = clock.now();
  const [sea, air] = await Promise.all(
    MODES.map((mode) => pricingRepository.findCurrentRate(mode, now))
  );
  if (!sea || !air) throw new PricingNotConfiguredError();
  return { sea, air };
}

function hasChanged(current: RateRecord | null, input: ModeRateInput): boolean {
  return (
    !current ||
    current.clientRatePerCbm !== input.client_rate_per_cbm ||
    current.collectorMarginPerCbm !== input.collector_margin_per_cbm
  );
}

export const pricingService = {
  /** Tarif en vigueur d'un mode, marge comprise. Usage interne (calcul du prix d'un colis). */
  async currentRate(mode: TransportMode): Promise<RateRecord> {
    const rate = await pricingRepository.findCurrentRate(mode, clock.now());
    if (!rate) throw new PricingNotConfiguredError();
    return rate;
  },

  async publicGrid(): Promise<PublicPricingDto> {
    return toPublicPricingDto(await currentGrid());
  },

  async adminGrid(): Promise<AdminPricingDto> {
    return toAdminPricingDto(await currentGrid());
  },

  /**
   * Enregistre la nouvelle grille. Seuls les modes dont le prix ou la marge changent reçoivent
   * une nouvelle ligne : renvoyer la même grille n'ajoute rien à l'historique.
   */
  async update(input: UpdatePricingBody, authorId: string): Promise<AdminPricingDto> {
    const now = clock.now();
    const changes: NewRate[] = [];
    const before: Record<string, ModeRateInput | null> = {};
    for (const mode of MODES) {
      const current = await pricingRepository.findCurrentRate(mode, now);
      const rate = input.rates[mode];
      if (!hasChanged(current, rate)) continue;
      before[mode] = current
        ? {
            client_rate_per_cbm: current.clientRatePerCbm,
            collector_margin_per_cbm: current.collectorMarginPerCbm,
          }
        : null;
      changes.push({
        transportMode: mode,
        clientRatePerCbm: rate.client_rate_per_cbm,
        collectorMarginPerCbm: rate.collector_margin_per_cbm,
      });
    }
    if (changes.length > 0) {
      const after = Object.fromEntries(
        changes.map((rate) => [rate.transportMode, input.rates[rate.transportMode]])
      );
      await pricingRepository.addRates(changes, authorId, now, {
        actorId: authorId,
        action: 'pricing.update',
        resourceType: 'pricing',
        resourceId: 'grid',
        before,
        after,
      });
    }
    return toAdminPricingDto(await currentGrid());
  },
};
