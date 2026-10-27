// Accès base de données des comptes du personnel (F2).
import { prisma } from '../../lib/prisma.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { UserRole } from '../../generated/prisma/enums.js';
import type { EmailMessage } from '../../infrastructure/email/emailMessages.js';
import { queueEmail } from '../../infrastructure/email/emailOutbox.repository.js';
import { recordAudit, type AuditEntry } from '../audit/audit.repository.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  // Lu seulement pour savoir si l'invitation est en attente ; jamais renvoyé tel quel.
  passwordHash: true,
  archivedAt: true,
  createdAt: true,
  agency: { select: { code: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export interface NewUser {
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  agencyId: string;
  /** Absent pour une personne invitée, qui choisira son mot de passe. */
  passwordHash?: string;
  invitation?: { tokenHash: string; expiresAt: Date };
}

export interface UserChanges {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: UserRole;
  agencyId?: string;
  active?: boolean;
  archivedAt?: Date | null;
}

export interface UserListFilters {
  archived: boolean;
  role?: UserRole;
  search?: string;
  orderBy: { field: 'name' | 'email' | 'createdAt'; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
}

type Database = PrismaClient | Prisma.TransactionClient;

/** Requêtes sur une connexion donnée : le client normal, ou celui d'une transaction. */
function usersQueries(db: Database) {
  return {
    findById(id: string): Promise<UserRecord | null> {
      return db.user.findUnique({ where: { id }, select: userSelect });
    },

    async isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
      const user = await db.user.findUnique({ where: { email }, select: { id: true } });
      return user !== null && user.id !== exceptUserId;
    },

    findAgencyIdByCode(code: string): Promise<{ id: string } | null> {
      return db.agency.findUnique({ where: { code }, select: { id: true } });
    },

    countActiveAdmins(exceptUserId?: string): Promise<number> {
      return db.user.count({
        where: {
          role: 'admin',
          active: true,
          archivedAt: null,
          ...(exceptUserId && { id: { not: exceptUserId } }),
        },
      });
    },

    async list(filters: UserListFilters): Promise<{ items: UserRecord[]; total: number }> {
      const where: Prisma.UserWhereInput = {
        archivedAt: filters.archived ? { not: null } : null,
        ...(filters.role && { role: filters.role }),
        ...(filters.search && {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ],
        }),
      };
      const [items, total] = await Promise.all([
        db.user.findMany({
          where,
          select: userSelect,
          orderBy: [{ [filters.orderBy.field]: filters.orderBy.direction }, { id: 'asc' }],
          skip: filters.skip,
          take: filters.take,
        }),
        db.user.count({ where }),
      ]);
      return { items, total };
    },

    /** Crée le compte et, pour une invitation, son lien à usage unique, en une seule écriture. */
    create(user: NewUser): Promise<UserRecord> {
      const { invitation, ...fields } = user;
      return db.user.create({
        data: {
          ...fields,
          ...(invitation && {
            tokens: { create: { purpose: 'invitation', ...invitation } },
          }),
        },
        select: userSelect,
      });
    },

    update(id: string, changes: UserChanges): Promise<UserRecord> {
      return db.user.update({ where: { id }, data: changes, select: userSelect });
    },

    /** Trace d'audit, dans la transaction en cours s'il y en a une. */
    audit(entry: AuditEntry): Promise<void> {
      return recordAudit(db, entry);
    },

    /** Inscrit un e-mail dans la boîte d'envoi, dans la transaction en cours s'il y en a une. */
    queueEmail(message: EmailMessage): Promise<void> {
      return queueEmail(db, message);
    },

    /** Ferme toutes les sessions ouvertes du compte. */
    async revokeSessions(userId: string, now: Date): Promise<void> {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  };
}

export type UsersQueries = ReturnType<typeof usersQueries>;

export const usersRepository = {
  ...usersQueries(prisma),

  /**
   * Exécute plusieurs lectures et écritures dans une transaction sérialisable : deux
   * administrateurs qui se rétrogradent en même temps ne peuvent pas laisser la plateforme
   * sans administrateur. En cas de conflit, PostgreSQL annule l'une des deux (409, à rejouer).
   */
  inTransaction<T>(work: (queries: UsersQueries) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => work(usersQueries(tx)), { isolationLevel: 'Serializable' });
  },
};
