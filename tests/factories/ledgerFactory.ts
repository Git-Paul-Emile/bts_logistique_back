// Fabrique de clients, colis et paiements pour les tests de soldes.
import { prisma } from '../../src/lib/prisma.js';
import type { PackageStatus, TransportMode } from '../../src/generated/prisma/enums.js';
import { createAccount, createAgency } from './accountFactory.js';

let sequence = 0;

async function locationId(code: string, name: string, countryCode: string, isOrigin: boolean) {
  const location = await prisma.location.upsert({
    where: { code },
    create: { code, name, countryCode, isOrigin, isDestination: !isOrigin },
    update: {},
    select: { id: true },
  });
  return location.id;
}

export async function createClient(
  options: { name?: string; phone?: string; email?: string; agencyCode?: string } = {}
) {
  sequence += 1;
  const agencyId = options.agencyCode
    ? (await prisma.agency.findUniqueOrThrow({ where: { code: options.agencyCode } })).id
    : await createAgency();
  return prisma.client.create({
    data: {
      name: options.name ?? `Client ${sequence}`,
      phone: options.phone ?? `+225 07 00 00 ${String(sequence).padStart(2, '0')}`,
      email: options.email ?? null,
      agencyId,
    },
    select: { id: true, name: true },
  });
}

export async function createPackage(options: {
  clientId: string;
  finalPrice: number;
  status?: PackageStatus;
  transportMode?: TransportMode;
  /** Destination : Abidjan par défaut, ou Dakar. */
  destination?: 'CI-ABJ' | 'SN-DKR';
  createdAt?: Date;
  collectorId?: string;
  collectorMargin?: number;
}) {
  sequence += 1;
  const client = await prisma.client.findUniqueOrThrow({ where: { id: options.clientId } });
  return prisma.package.create({
    data: {
      trackingNumber: `BTS-CI-2026-${String(sequence).padStart(5, '0')}`,
      clientId: options.clientId,
      agencyId: client.agencyId,
      originId: await locationId('CN-CAN', 'Guangzhou (Chine)', 'CN', true),
      destinationId:
        options.destination === 'SN-DKR'
          ? await locationId('SN-DKR', 'Dakar (Sénégal)', 'SN', false)
          : await locationId('CI-ABJ', "Abidjan (Côte d'Ivoire)", 'CI', false),
      transportMode: options.transportMode ?? 'sea',
      lengthCm: 80,
      widthCm: 60,
      heightCm: 50,
      weightKg: 25,
      cubicMeter: 0.24,
      ratePerCbm: 250000,
      finalPrice: options.finalPrice,
      collectorMargin: options.collectorMargin ?? 0,
      collectorMarginPerCbm: 0,
      collectorId: options.collectorId ?? null,
      ...(options.createdAt && { createdAt: options.createdAt }),
      status: options.status ?? 'registered',
    },
    select: { id: true, trackingNumber: true },
  });
}

async function author(): Promise<string> {
  const existing = await prisma.user.findFirst({ select: { id: true } });
  return existing?.id ?? (await createAccount({ email: 'caisse@bts.test' })).id;
}

/** Paiement d'un client, réparti sur ses colis (ou non réparti : avance). */
export async function createPayment(options: {
  clientId: string;
  amount: number;
  allocations?: { packageId: string; amount: number }[];
  reversesPaymentId?: string;
  createdAt?: Date;
}) {
  const payment = await prisma.payment.create({
    data: {
      clientId: options.clientId,
      amount: options.amount,
      method: 'mobile_money',
      authorId: await author(),
      reversesPaymentId: options.reversesPaymentId ?? null,
      ...(options.createdAt && { createdAt: options.createdAt }),
    },
    select: { id: true },
  });
  // Insertion à part : clientId appartient à deux relations composées (paiement et colis),
  // que Prisma ne sait pas renseigner dans une création imbriquée.
  await prisma.paymentAllocation.createMany({
    data: (options.allocations ?? []).map((allocation) => ({
      paymentId: payment.id,
      packageId: allocation.packageId,
      clientId: options.clientId,
      amount: allocation.amount,
    })),
  });
  return payment;
}
