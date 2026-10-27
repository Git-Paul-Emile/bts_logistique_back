// Filtres de la consultation du journal d'audit.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { AUDIT_ACTIONS } from './audit.repository.js';

const MAX_RESOURCE_ID_LENGTH = 64;

export const listAuditLogsQuerySchema = listQuerySchema.omit({ sort: true, search: true }).extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  resource_type: z.enum(['pricing', 'user', 'payment', 'package']).optional(),
  resource_id: z.string().trim().min(1).max(MAX_RESOURCE_ID_LENGTH).optional(),
  actor_id: z.uuid().optional(),
  /** Période, dates incluses, au format AAAA-MM-JJ (UTC). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
