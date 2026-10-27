// Entrées des routes /notifications.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { NotificationCategory } from '../../generated/prisma/enums.js';

const MAX_IDS_PER_REQUEST = 200;

export const listNotificationsQuerySchema = listQuerySchema.omit({ sort: true }).extend({
  category: z.enum(NotificationCategory).optional(),
  read: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const setReadBodySchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_IDS_PER_REQUEST),
  read: z.boolean(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type SetReadBody = z.infer<typeof setReadBodySchema>;
