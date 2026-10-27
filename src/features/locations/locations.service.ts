// Lieux du réseau, tels que le front les affiche dans les listes de choix.
import { locationsRepository } from './locations.repository.js';

export interface LocationDto {
  code: string;
  name: string;
  country_code: string;
  is_origin: boolean;
  is_destination: boolean;
  agency: { code: string; name: string } | null;
}

export const locationsService = {
  async list(): Promise<LocationDto[]> {
    const locations = await locationsRepository.listActive();
    return locations.map((location) => ({
      code: location.code,
      name: location.name,
      country_code: location.countryCode,
      is_origin: location.isOrigin,
      is_destination: location.isDestination,
      agency: location.agencies[0] ?? null,
    }));
  },
};
