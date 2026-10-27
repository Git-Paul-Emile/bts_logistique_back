// Numéro de suivi : BTS-{pays de destination}-{année}-{6 chiffres}, ex. BTS-CI-2026-482913.
// Généré par le serveur ; l'unicité est garantie par la base (contrainte UNIQUE), et une
// collision fait recommencer avec un autre numéro. Format validé par BTS le 27/10/2026.
import { randomInt } from 'node:crypto';

const SUFFIX_MIN = 100_000;
const SUFFIX_MAX_EXCLUSIVE = 1_000_000;

export const trackingNumbers = {
  /** Partie aléatoire, isolée pour que les tests puissent provoquer une collision. */
  randomSuffix(): number {
    return randomInt(SUFFIX_MIN, SUFFIX_MAX_EXCLUSIVE);
  },

  next(destinationCountryCode: string, year: number): string {
    return `BTS-${destinationCountryCode}-${year}-${trackingNumbers.randomSuffix()}`;
  },
};
