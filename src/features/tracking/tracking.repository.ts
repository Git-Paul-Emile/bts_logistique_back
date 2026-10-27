// Lecture d'un colis pour le suivi public (F7). Ne sélectionne que les colonnes affichables :
// ni prix, ni paiements, ni coordonnées, ni agents.
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

const placeSelect = { select: { code: true, name: true } } as const;

const trackingSelect = {
  trackingNumber: true,
  status: true,
  transportMode: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  cubicMeter: true,
  createdAt: true,
  // Seulement pour en tirer les initiales du destinataire.
  client: { select: { name: true } },
  origin: placeSelect,
  destination: placeSelect,
  events: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true, locationDetail: true, createdAt: true, location: placeSelect },
  },
} satisfies Prisma.PackageSelect;

export type TrackingRecord = Prisma.PackageGetPayload<{ select: typeof trackingSelect }>;

export const trackingRepository = {
  findByTrackingNumber(trackingNumber: string): Promise<TrackingRecord | null> {
    return prisma.package.findUnique({ where: { trackingNumber }, select: trackingSelect });
  },
};
