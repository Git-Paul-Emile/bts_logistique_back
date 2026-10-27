// Tests unitaires des règles pures des colis : calcul du prix et cycle de vie.
import { describe, expect, it } from 'vitest';
import {
  computeCubicMeter,
  computePackagePrice,
  computePaymentStatus,
  MIN_CUBIC_METER,
} from '../../src/features/packages/packagePricing.js';
import { canMoveTo, isClosed } from '../../src/features/packages/packageStatus.js';

describe('calcul du prix d’un colis', () => {
  it('calcule le volume en m³ à partir des centimètres', () => {
    expect(computeCubicMeter({ lengthCm: 80, widthCm: 60, heightCm: 50 })).toBe(0.24);
  });

  it('facture au minimum 0,001 m³', () => {
    expect(computeCubicMeter({ lengthCm: 1, widthCm: 1, heightCm: 1 })).toBe(MIN_CUBIC_METER);
  });

  it('arrondit le prix et la marge au franc CFA', () => {
    expect(computePackagePrice({ lengthCm: 33, widthCm: 33, heightCm: 33 }, 380000, 38500)).toEqual(
      {
        cubicMeter: 0.0359,
        finalPrice: 13642,
        collectorMargin: 1382,
      }
    );
  });

  it('déduit le statut de paiement du montant encaissé', () => {
    expect(computePaymentStatus(0, 1000)).toBe('unpaid');
    expect(computePaymentStatus(400, 1000)).toBe('partial');
    expect(computePaymentStatus(1000, 1000)).toBe('paid');
  });
});

describe('cycle de vie d’un colis', () => {
  it('suit le parcours normal jusqu’à la livraison', () => {
    expect(canMoveTo('registered', 'in_transit')).toBe(true);
    expect(canMoveTo('in_transit', 'arrived')).toBe(true);
    expect(canMoveTo('arrived', 'delivered')).toBe(true);
  });

  it('permet d’ajouter une étape sans changer de statut', () => {
    expect(canMoveTo('in_transit', 'in_transit')).toBe(true);
  });

  it('interdit de revenir en arrière ou de sauter une étape', () => {
    expect(canMoveTo('delivered', 'registered')).toBe(false);
    expect(canMoveTo('arrived', 'registered')).toBe(false);
    expect(canMoveTo('registered', 'delivered')).toBe(false);
  });

  it('considère livré, retourné et annulé comme terminés', () => {
    expect(['delivered', 'returned', 'cancelled'].every((s) => isClosed(s as 'delivered'))).toBe(
      true
    );
    expect(isClosed('in_transit')).toBe(false);
  });
});
