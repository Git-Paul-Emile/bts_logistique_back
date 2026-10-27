// Suivi public d'un colis par son numéro (F7), sans connexion.
import { toPublicTrackingDto, type PublicTrackingDto } from './tracking.dto.js';
import { TrackingNotFoundError } from './tracking.errors.js';
import { trackingRepository } from './tracking.repository.js';

/** Le numéro saisi est comparé sans espaces et en majuscules : « bts-ci-2026-482913 » marche. */
export function normalizeTrackingNumber(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export const trackingService = {
  async find(trackingNumber: string): Promise<PublicTrackingDto> {
    const pkg = await trackingRepository.findByTrackingNumber(
      normalizeTrackingNumber(trackingNumber)
    );
    if (!pkg) throw new TrackingNotFoundError();
    return toPublicTrackingDto(pkg);
  },
};
