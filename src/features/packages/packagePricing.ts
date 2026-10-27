// Calcul du volume, du prix et de la marge d'un colis. Fonctions pures : c'est le serveur qui
// fait foi, le front n'affiche qu'une estimation (même formule que front/src/utils/packagePricing.ts).
import type { PaymentStatus } from '../../generated/prisma/enums.js';

const CUBIC_CM_PER_CUBIC_METER = 1_000_000;
/** Un colis très petit est facturé au minimum sur ce volume. */
export const MIN_CUBIC_METER = 0.001;
const VOLUME_DECIMALS = 4;

export interface Dimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface PackagePrice {
  cubicMeter: number;
  finalPrice: number;
  collectorMargin: number;
}

export function computeCubicMeter({ lengthCm, widthCm, heightCm }: Dimensions): number {
  const volume = (lengthCm * widthCm * heightCm) / CUBIC_CM_PER_CUBIC_METER;
  return Math.max(MIN_CUBIC_METER, Number(volume.toFixed(VOLUME_DECIMALS)));
}

/** Prix et marge arrondis au franc CFA. La marge est comprise dans le prix. */
export function computePackagePrice(
  dimensions: Dimensions,
  ratePerCbm: number,
  marginPerCbm: number
): PackagePrice {
  const cubicMeter = computeCubicMeter(dimensions);
  return {
    cubicMeter,
    finalPrice: Math.round(cubicMeter * ratePerCbm),
    collectorMargin: Math.round(cubicMeter * marginPerCbm),
  };
}

export function computePaymentStatus(amountPaid: number, finalPrice: number): PaymentStatus {
  if (amountPaid >= finalPrice) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}
