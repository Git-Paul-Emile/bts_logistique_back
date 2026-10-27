// Accès base de données des paiements (F8). Un paiement n'est jamais modifié ni supprimé :
// ce repository n'offre que des créations et des lectures.
import { prisma } from '../../lib/prisma.js';
import { recordAudit, type AuditEntry } from '../audit/audit.repository.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PaymentMethod, PaymentStatus } from '../../generated/prisma/enums.js';

const paymentSelect = {
  id: true,
  amount: true,
  method: true,
  reference: true,
  notes: true,
  reversesPaymentId: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
  author: { select: { id: true, name: true } },
  reversedBy: { select: { id: true } },
  allocations: {
    orderBy: { createdAt: 'asc' },
    select: { amount: true, package: { select: { id: true, trackingNumber: true } } },
  },
} satisfies Prisma.PaymentSelect;

export type PaymentRecord = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export interface NewPayment {
  clientId: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  authorId: string;
  reversesPaymentId: string | null;
  /** Date comptable, fournie par l'horloge du serveur. */
  createdAt: Date;
}

export interface PaymentListFilters {
  clientId?: string;
  method?: PaymentMethod;
  search?: string;
  createdFrom?: Date;
  createdBefore?: Date;
  orderBy: { field: 'createdAt' | 'amount'; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
}

type Database = PrismaClient | Prisma.TransactionClient;

function paymentsQueries(db: Database) {
  return {
    findDetail(id: string): Promise<PaymentRecord | null> {
      return db.payment.findUnique({ where: { id }, select: paymentSelect });
    },

    /** Colis visés par une répartition, avec ce qu'il faut pour vérifier les parts. */
    findPackages(ids: string[]) {
      return db.package.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          clientId: true,
          trackingNumber: true,
          status: true,
          finalPrice: true,
          amountPaid: true,
        },
      });
    },

    /** Paiement à annuler, avec sa répartition et l'éventuelle annulation existante. */
    findForReversal(id: string) {
      return db.payment.findUnique({
        where: { id },
        select: {
          id: true,
          clientId: true,
          amount: true,
          method: true,
          reference: true,
          reversesPaymentId: true,
          reversedBy: { select: { id: true } },
          allocations: { select: { packageId: true, amount: true } },
        },
      });
    },

    /**
     * Crée le paiement puis sa répartition. Les parts sont insérées à part : clientId appartient
     * à deux relations composées (paiement et colis), que Prisma ne sait pas renseigner dans
     * une création imbriquée. Les clés étrangères garantissent que chaque colis est bien à ce client.
     */
    async create(
      payment: NewPayment,
      allocations: { packageId: string; amount: number }[]
    ): Promise<string> {
      const created = await db.payment.create({ data: payment, select: { id: true } });
      await db.paymentAllocation.createMany({
        data: allocations.map((part) => ({
          paymentId: created.id,
          packageId: part.packageId,
          clientId: payment.clientId,
          amount: part.amount,
          createdAt: payment.createdAt,
        })),
      });
      return created.id;
    },

    async setPackagePayment(
      packageId: string,
      amountPaid: number,
      paymentStatus: PaymentStatus
    ): Promise<void> {
      await db.package.update({
        where: { id: packageId },
        data: { amountPaid, paymentStatus },
        select: { id: true },
      });
    },

    /** Trace d'audit, dans la transaction en cours. */
    audit(entry: AuditEntry): Promise<void> {
      return recordAudit(db, entry);
    },

    async addNotification(title: string, message: string): Promise<void> {
      await db.notification.create({
        data: { category: 'payment', title, message },
        select: { id: true },
      });
    },
  };
}

export type PaymentsQueries = ReturnType<typeof paymentsQueries>;

export const paymentsRepository = {
  ...paymentsQueries(prisma),

  async list(filters: PaymentListFilters): Promise<{ items: PaymentRecord[]; total: number }> {
    const where: Prisma.PaymentWhereInput = {
      clientId: filters.clientId,
      method: filters.method,
      createdAt: { gte: filters.createdFrom, lt: filters.createdBefore },
      ...(filters.search && {
        OR: [
          { reference: { contains: filters.search, mode: 'insensitive' } },
          { client: { name: { contains: filters.search, mode: 'insensitive' } } },
          {
            allocations: {
              some: {
                package: { trackingNumber: { contains: filters.search, mode: 'insensitive' } },
              },
            },
          },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: paymentSelect,
        orderBy: [{ [filters.orderBy.field]: filters.orderBy.direction }, { id: 'desc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.payment.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Toutes les écritures d'un encaissement ou d'une annulation dans une transaction
   * sérialisable : deux encaissements simultanés sur le même colis ne peuvent pas dépasser
   * son prix. En cas de conflit, PostgreSQL en annule un (409, à rejouer).
   */
  inTransaction<T>(work: (queries: PaymentsQueries) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => work(paymentsQueries(tx)), {
      isolationLevel: 'Serializable',
    });
  },
};
