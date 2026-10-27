// Consultation du journal d'audit (F13), réservée aux administrateurs.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta } from '../../core/http/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { auditRepository, type AuditRecord } from './audit.repository.js';
import type { ListAuditLogsQuery } from './audit.schemas.js';

const MS_PER_DAY = 86_400_000;

export interface AuditLogDto {
  id: string;
  /** Null si la personne n'existe plus dans la base (cas théorique : les comptes sont archivés). */
  actor: { id: string; name: string } | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  /** Relie la trace aux logs du serveur (en-tête X-Request-Id). */
  request_id: string | null;
  created_at: string;
}

function toAuditLogDto(entry: AuditRecord): AuditLogDto {
  return {
    id: entry.id,
    actor: entry.actor,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    before: entry.before,
    after: entry.after,
    request_id: entry.requestId,
    created_at: entry.createdAt.toISOString(),
  };
}

export const auditService = {
  async list(query: ListAuditLogsQuery): Promise<{ items: AuditLogDto[]; meta: PaginationMeta }> {
    const { items, total } = await auditRepository.list({
      action: query.action,
      resourceType: query.resource_type,
      resourceId: query.resource_id,
      actorId: query.actor_id,
      createdFrom: query.from ? new Date(query.from) : undefined,
      // « to » est inclus : on prend tout ce qui précède le lendemain.
      createdBefore: query.to ? new Date(new Date(query.to).getTime() + MS_PER_DAY) : undefined,
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return {
      items: items.map(toAuditLogDto),
      meta: paginationMeta(query.page, query.limit, total),
    };
  },
};
