// Accès base de données des colis (F6) : colis, étapes de suivi, paiement initial et
// notifications du personnel.
import { prisma } from '../../lib/prisma.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type {
  EmailDeliveryStatus,
  NotificationCategory,
  PackageStatus,
  PaymentMethod,
  PaymentStatus,
  TransportMode,
} from '../../generated/prisma/enums.js';
import type { EmailMessage } from '../../infrastructure/email/emailMessages.js';
import { queueEmail } from '../../infrastructure/email/emailOutbox.repository.js';
import { recordAudit, type AuditEntry } from '../audit/audit.repository.js';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
/** Au-delà, une collision répétée du numéro de suivi signale un vrai problème. */
const MAX_TRACKING_ATTEMPTS = 5;

const placeSelect = { select: { code: true, name: true } } as const;

const packageSelect = {
  id: true,
  trackingNumber: true,
  shipmentId: true,
  description: true,
  transportMode: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  cubicMeter: true,
  ratePerCbm: true,
  finalPrice: true,
  collectorMargin: true,
  status: true,
  paymentStatus: true,
  amountPaid: true,
  createdAt: true,
  updatedAt: true,
  agencyId: true,
  client: { select: { id: true, name: true } },
  agency: placeSelect,
  collector: { select: { id: true, name: true } },
  origin: placeSelect,
  destination: placeSelect,
} satisfies Prisma.PackageSelect;

const packageDetailSelect = {
  ...packageSelect,
  events: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      locationDetail: true,
      comment: true,
      createdAt: true,
      location: placeSelect,
      agent: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PackageSelect;

/** État d'un colis nécessaire aux règles de modification. */
const packageStateSelect = {
  id: true,
  trackingNumber: true,
  status: true,
  agencyId: true,
  originId: true,
  destinationId: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  description: true,
  ratePerCbm: true,
  finalPrice: true,
  collectorMarginPerCbm: true,
  amountPaid: true,
  client: { select: { name: true, email: true } },
} satisfies Prisma.PackageSelect;

export type PackageRecord = Prisma.PackageGetPayload<{ select: typeof packageSelect }>;
export type PackageDetailRecord = Prisma.PackageGetPayload<{
  select: typeof packageDetailSelect;
}>;
export type PackageStateRecord = Prisma.PackageGetPayload<{ select: typeof packageStateSelect }>;

export interface NewNotification {
  category: NotificationCategory;
  title: string;
  message: string;
  deliveryStatus?: EmailDeliveryStatus;
}

export interface NewPackage {
  clientId: string;
  agencyId: string;
  collectorId: string | null;
  originId: string;
  destinationId: string;
  description: string | null;
  transportMode: TransportMode;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  cubicMeter: number;
  ratePerCbm: number;
  collectorMarginPerCbm: number;
  finalPrice: number;
  collectorMargin: number;
  amountPaid: number;
  paymentStatus: PaymentStatus;
}

export interface Registration {
  package: NewPackage;
  agentId: string;
  initialPayment: { amount: number; method: PaymentMethod; reference: string | null } | null;
  /** Construites une fois le numéro de suivi connu. */
  notifications: (trackingNumber: string) => NewNotification[];
  /** E-mail au client avec son numéro de suivi ; null si le client n'a pas d'adresse. */
  clientEmail: ((trackingNumber: string) => EmailMessage) | null;
}

export interface PackageChanges {
  description?: string | null;
  originId?: string;
  destinationId?: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightKg?: number;
  cubicMeter?: number;
  ratePerCbm?: number;
  finalPrice?: number;
  collectorMargin?: number;
  paymentStatus?: PaymentStatus;
  status?: PackageStatus;
}

export interface NewEvent {
  status: PackageStatus;
  locationId: string | null;
  locationDetail: string | null;
  comment: string | null;
  agentId: string | null;
}

export interface PackageListFilters {
  agencyId?: string;
  clientId?: string;
  status?: PackageStatus;
  paymentStatus?: PaymentStatus;
  transportMode?: TransportMode;
  search?: string;
  orderBy: { field: 'createdAt' | 'finalPrice' | 'trackingNumber'; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
}

type Database = PrismaClient | Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_VIOLATION
  );
}

function packagesQueries(db: Database) {
  return {
    findDetail(id: string): Promise<PackageDetailRecord | null> {
      return db.package.findUnique({ where: { id }, select: packageDetailSelect });
    },

    findState(id: string): Promise<PackageStateRecord | null> {
      return db.package.findUnique({ where: { id }, select: packageStateSelect });
    },

    findLocation(code: string) {
      return db.location.findUnique({
        where: { code },
        select: {
          id: true,
          name: true,
          countryCode: true,
          isOrigin: true,
          isDestination: true,
          active: true,
        },
      });
    },

    async update(id: string, changes: PackageChanges): Promise<void> {
      await db.package.update({ where: { id }, data: changes, select: { id: true } });
    },

    async addEvent(packageId: string, event: NewEvent): Promise<void> {
      await db.packageEvent.create({ data: { packageId, ...event }, select: { id: true } });
    },

    /**
     * Notification « e-mail au client » et, si le client a une adresse, l'e-mail lui-même :
     * l'état d'envoi de la notification suivra celui de l'e-mail.
     */
    async addEmailNotification(
      packageId: string,
      notification: NewNotification,
      email: EmailMessage | null
    ): Promise<void> {
      const created = await db.notification.create({
        data: { ...notification, packageId },
        select: { id: true },
      });
      if (email) await queueEmail(db, email, created.id);
    },

    /** Trace d'audit, dans la transaction en cours. */
    audit(entry: AuditEntry): Promise<void> {
      return recordAudit(db, entry);
    },

    async addNotifications(packageId: string, notifications: NewNotification[]): Promise<void> {
      await db.notification.createMany({
        data: notifications.map((notification) => ({ ...notification, packageId })),
      });
    },
  };
}

export type PackagesQueries = ReturnType<typeof packagesQueries>;

/** Écritures de l'enregistrement d'un colis, dans la transaction reçue. */
async function insertRegistration(
  tx: Prisma.TransactionClient,
  registration: Registration,
  trackingNumber: string
): Promise<string> {
  const { package: pkg, agentId, initialPayment } = registration;
  const created = await tx.package.create({
    data: { ...pkg, trackingNumber },
    select: { id: true },
  });
  const queries = packagesQueries(tx);
  await queries.addEvent(created.id, {
    status: 'registered',
    locationId: pkg.originId,
    locationDetail: null,
    comment: null,
    agentId,
  });
  if (initialPayment) {
    const payment = await tx.payment.create({
      data: { clientId: pkg.clientId, authorId: agentId, ...initialPayment },
      select: { id: true },
    });
    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        packageId: created.id,
        clientId: pkg.clientId,
        amount: initialPayment.amount,
      },
      select: { id: true },
    });
  }
  await queries.addNotifications(created.id, registration.notifications(trackingNumber));
  if (registration.clientEmail) await queueEmail(tx, registration.clientEmail(trackingNumber));
  return created.id;
}

export const packagesRepository = {
  ...packagesQueries(prisma),

  findClient(id: string) {
    return prisma.client.findUnique({
      where: { id },
      select: { id: true, agencyId: true, name: true, email: true },
    });
  },

  findAgencyIdByCode(code: string): Promise<{ id: string } | null> {
    return prisma.agency.findUnique({ where: { code }, select: { id: true } });
  },

  /**
   * Enregistre le colis, sa première étape, le paiement initial éventuel et les notifications,
   * en une seule transaction : tout est écrit, ou rien. Si le numéro de suivi tiré existe déjà
   * (contrainte UNIQUE), la transaction est annulée et recommencée avec un autre numéro.
   */
  async register(registration: Registration, nextTrackingNumber: () => string): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await prisma.$transaction((tx) =>
          insertRegistration(tx, registration, nextTrackingNumber())
        );
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_TRACKING_ATTEMPTS) throw error;
      }
    }
  },

  async list(filters: PackageListFilters): Promise<{ items: PackageRecord[]; total: number }> {
    const where: Prisma.PackageWhereInput = {
      agencyId: filters.agencyId,
      clientId: filters.clientId,
      status: filters.status,
      paymentStatus: filters.paymentStatus,
      transportMode: filters.transportMode,
      ...(filters.search && {
        OR: [
          { trackingNumber: { contains: filters.search, mode: 'insensitive' } },
          { client: { name: { contains: filters.search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.package.findMany({
        where,
        select: packageSelect,
        orderBy: [{ [filters.orderBy.field]: filters.orderBy.direction }, { id: 'desc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.package.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Lectures et écritures dans une transaction sérialisable : un changement de prix et un
   * paiement simultanés ne peuvent pas laisser un colis payé plus que son prix.
   */
  inTransaction<T>(work: (queries: PackagesQueries) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => work(packagesQueries(tx)), {
      isolationLevel: 'Serializable',
    });
  },
};
