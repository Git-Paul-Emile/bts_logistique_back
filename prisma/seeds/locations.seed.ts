// Villes du réseau BTS et agence de chacune. Source unique : le front les lit par GET /locations.
// Relançable sans risque : chaque ligne est retrouvée par son code (upsert).
import { prisma } from '../../src/lib/prisma.js';
import type { Seeder } from './seeder.js';

interface LocationSeed {
  code: string;
  name: string;
  countryCode: string;
  isOrigin: boolean;
  isDestination: boolean;
}

const LOCATIONS: readonly LocationSeed[] = [
  {
    code: 'CN-CAN',
    name: 'Guangzhou (Chine)',
    countryCode: 'CN',
    isOrigin: true,
    isDestination: false,
  },
  { code: 'CN-YIW', name: 'Yiwu (Chine)', countryCode: 'CN', isOrigin: true, isDestination: false },
  { code: 'AE-DXB', name: 'Dubaï (EAU)', countryCode: 'AE', isOrigin: true, isDestination: false },
  {
    code: 'TR-IST',
    name: 'Istanbul (Turquie)',
    countryCode: 'TR',
    isOrigin: true,
    isDestination: false,
  },
  {
    code: 'FR-PAR',
    name: 'Paris / Le Havre (France)',
    countryCode: 'FR',
    isOrigin: true,
    isDestination: false,
  },
  {
    code: 'CI-ABJ',
    name: "Abidjan (Côte d'Ivoire)",
    countryCode: 'CI',
    isOrigin: false,
    isDestination: true,
  },
  {
    code: 'SN-DKR',
    name: 'Dakar (Sénégal)',
    countryCode: 'SN',
    isOrigin: false,
    isDestination: true,
  },
  {
    code: 'ML-BKO',
    name: 'Bamako (Mali)',
    countryCode: 'ML',
    isOrigin: false,
    isDestination: true,
  },
  {
    code: 'BF-OUA',
    name: 'Ouagadougou (Burkina Faso)',
    countryCode: 'BF',
    isOrigin: false,
    isDestination: true,
  },
  {
    code: 'CM-DLA',
    name: 'Douala (Cameroun)',
    countryCode: 'CM',
    isOrigin: false,
    isDestination: true,
  },
  { code: 'TG-LFW', name: 'Lomé (Togo)', countryCode: 'TG', isOrigin: false, isDestination: true },
  {
    code: 'BJ-COO',
    name: 'Cotonou (Bénin)',
    countryCode: 'BJ',
    isOrigin: false,
    isDestination: true,
  },
];

export const locationsSeeder: Seeder = {
  name: 'Lieux et agences',
  async run() {
    for (const { code, ...fields } of LOCATIONS) {
      const location = await prisma.location.upsert({
        where: { code },
        create: { code, ...fields },
        update: fields,
        select: { id: true },
      });
      // Une agence par ville, sous le même code et le même libellé que la ville.
      await prisma.agency.upsert({
        where: { code },
        create: { code, name: fields.name, locationId: location.id },
        update: { name: fields.name, locationId: location.id },
        select: { id: true },
      });
    }
  },
};
