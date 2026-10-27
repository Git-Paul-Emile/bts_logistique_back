// Notifications du personnel (F10) : la cloche et la page Notifications. Elles sont créées par
// les autres fonctionnalités (colis, paiements) ; ici, on les lit et on les marque lues.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta } from '../../core/http/pagination.js';
import type { EmailDeliveryStatus, NotificationCategory } from '../../generated/prisma/enums.js';
import { clock } from '../../lib/clock.js';
import type { Viewer } from '../auth/auth.service.js';
import {
  notificationsRepository,
  type NotificationAudience,
  type NotificationRecord,
} from './notifications.repository.js';
import type { ListNotificationsQuery } from './notifications.schemas.js';

export interface NotificationDto {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  package: { id: string; tracking_number: string } | null;
  /** Seulement pour un e-mail envoyé à un client. */
  delivery: EmailDeliveryStatus | null;
  read: boolean;
  created_at: string;
}

function audienceOf(viewer: Viewer): NotificationAudience {
  return viewer.role === 'collector'
    ? { userId: viewer.userId, agencyId: viewer.agencyId }
    : { userId: viewer.userId };
}

function toNotificationDto(notification: NotificationRecord): NotificationDto {
  return {
    id: notification.id,
    category: notification.category,
    title: notification.title,
    message: notification.message,
    package: notification.package
      ? { id: notification.package.id, tracking_number: notification.package.trackingNumber }
      : null,
    delivery: notification.deliveryStatus,
    read: notification.reads.length > 0,
    created_at: notification.createdAt.toISOString(),
  };
}

export const notificationsService = {
  async list(
    viewer: Viewer,
    query: ListNotificationsQuery
  ): Promise<{ items: NotificationDto[]; meta: PaginationMeta }> {
    const { items, total } = await notificationsRepository.list(audienceOf(viewer), {
      category: query.category,
      read: query.read,
      search: query.search,
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return {
      items: items.map(toNotificationDto),
      meta: paginationMeta(query.page, query.limit, total),
    };
  },

  unreadCount(viewer: Viewer): Promise<number> {
    return notificationsRepository.countUnread(audienceOf(viewer));
  },

  setRead(viewer: Viewer, ids: string[], read: boolean): Promise<void> {
    return notificationsRepository.setRead(audienceOf(viewer), ids, read);
  },

  markAllRead(viewer: Viewer): Promise<void> {
    return notificationsRepository.markAllRead(audienceOf(viewer), clock.now());
  },
};
