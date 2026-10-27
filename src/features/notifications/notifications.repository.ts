// Accès base de données des notifications du personnel (F10). L'état lu ou non lu est propre à
// chaque personne : une ligne dans notification_reads quand elle a lu, aucune sinon.
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { NotificationCategory } from '../../generated/prisma/enums.js';

/** Qui regarde : sa personne (état lu) et, pour un collecteur, son agence (périmètre). */
export interface NotificationAudience {
  userId: string;
  /** Renseigné pour un collecteur : seulement les notifications des colis de son agence. */
  agencyId?: string;
}

export interface NotificationListFilters {
  category?: NotificationCategory;
  read?: boolean;
  search?: string;
  skip: number;
  take: number;
}

function notificationSelect(userId: string) {
  return {
    id: true,
    category: true,
    title: true,
    message: true,
    deliveryStatus: true,
    createdAt: true,
    package: { select: { id: true, trackingNumber: true } },
    reads: { where: { userId }, select: { readAt: true } },
  } satisfies Prisma.NotificationSelect;
}

export type NotificationRecord = Prisma.NotificationGetPayload<{
  select: ReturnType<typeof notificationSelect>;
}>;

function visibleTo(audience: NotificationAudience): Prisma.NotificationWhereInput {
  return audience.agencyId ? { package: { agencyId: audience.agencyId } } : {};
}

function readFilter(userId: string, read?: boolean): Prisma.NotificationWhereInput {
  if (read === undefined) return {};
  return read ? { reads: { some: { userId } } } : { reads: { none: { userId } } };
}

export const notificationsRepository = {
  async list(
    audience: NotificationAudience,
    filters: NotificationListFilters
  ): Promise<{ items: NotificationRecord[]; total: number }> {
    const where: Prisma.NotificationWhereInput = {
      ...visibleTo(audience),
      ...readFilter(audience.userId, filters.read),
      category: filters.category,
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { message: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        select: notificationSelect(audience.userId),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.notification.count({ where }),
    ]);
    return { items, total };
  },

  countUnread(audience: NotificationAudience): Promise<number> {
    return prisma.notification.count({
      where: { ...visibleTo(audience), ...readFilter(audience.userId, false) },
    });
  },

  /** Marque lues ou non lues celles de la liste que cette personne a le droit de voir. */
  async setRead(audience: NotificationAudience, ids: string[], read: boolean): Promise<void> {
    const visible = await prisma.notification.findMany({
      where: { id: { in: ids }, ...visibleTo(audience) },
      select: { id: true },
    });
    const visibleIds = visible.map((notification) => notification.id);
    if (read) {
      await prisma.notificationRead.createMany({
        data: visibleIds.map((notificationId) => ({ notificationId, userId: audience.userId })),
        skipDuplicates: true,
      });
      return;
    }
    await prisma.notificationRead.deleteMany({
      where: { userId: audience.userId, notificationId: { in: visibleIds } },
    });
  },

  /** Marque tout comme lu, en une requête, quel que soit le nombre de notifications. */
  async markAllRead(audience: NotificationAudience, now: Date): Promise<void> {
    const agencyCondition = audience.agencyId
      ? Prisma.sql`AND n.package_id IN (SELECT id FROM packages WHERE agency_id = ${audience.agencyId}::uuid)`
      : Prisma.empty;
    await prisma.$executeRaw`
      INSERT INTO notification_reads (notification_id, user_id, read_at)
      SELECT n.id, ${audience.userId}::uuid, ${now}
      FROM notifications n
      WHERE TRUE ${agencyCondition}
      ON CONFLICT (notification_id, user_id) DO NOTHING`;
  },
};
