// Journal d'audit (F13) : qui a fait quoi, quand, sur quelle ressource, avant et après.
// Les traces ne sont jamais modifiées ni supprimées : ce fichier n'offre qu'écriture et lecture.
import { currentRequestId } from '../../core/http/requestContext.js';
import { clock } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** Actions tracées. La liste est fermée : une nouvelle action sensible s'ajoute ici. */
export const AUDIT_ACTIONS = [
  'pricing.update',
  'user.invite',
  'user.update',
  'user.activate',
  'user.deactivate',
  'user.restore',
  'user.archive_self',
  'payment.record',
  'payment.reverse',
  'package.update',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  resourceType: 'pricing' | 'user' | 'payment' | 'package';
  resourceId: string;
  /** Instantanés sans aucun secret (ni mot de passe, ni jeton). */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

type Database = PrismaClient | Prisma.TransactionClient;

/** Écrit une trace. À appeler avec le client de la transaction de l'action tracée. */
export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: { ...entry, requestId: currentRequestId(), createdAt: clock.now() },
    select: { id: true },
  });
}

export interface AuditListFilters {
  action?: AuditAction;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  createdFrom?: Date;
  createdBefore?: Date;
  skip: number;
  take: number;
}

const auditSelect = {
  id: true,
  action: true,
  resourceType: true,
  resourceId: true,
  before: true,
  after: true,
  requestId: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

export type AuditRecord = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

export const auditRepository = {
  async list(filters: AuditListFilters): Promise<{ items: AuditRecord[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      action: filters.action,
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      actorId: filters.actorId,
      createdAt: { gte: filters.createdFrom, lt: filters.createdBefore },
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        select: auditSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  },
};
