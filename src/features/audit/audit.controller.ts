// Traduction HTTP de la consultation du journal d'audit.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successBody } from '../../core/http/apiResponse.js';
import type { ListAuditLogsQuery } from './audit.schemas.js';
import { auditService } from './audit.service.js';

/** GET /audit-logs?action=&resource_type=&resource_id=&actor_id=&from=&to=&page=&limit= */
export async function listAuditLogs(_req: Request, res: Response) {
  const { items, meta } = await auditService.list(res.locals['query'] as ListAuditLogsQuery);
  res
    .set('Cache-Control', 'private, no-store')
    .status(StatusCodes.OK)
    .json(successBody(items, meta));
}
