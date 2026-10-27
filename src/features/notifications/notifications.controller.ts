// Traduction HTTP des notifications du personnel.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import type { Viewer } from '../auth/auth.service.js';
import type { ListNotificationsQuery, SetReadBody } from './notifications.schemas.js';
import { notificationsService } from './notifications.service.js';

function viewerOf(req: Request): Viewer {
  if (!req.auth) throw new UnauthorizedError();
  return { userId: req.auth.userId, role: req.auth.role, agencyId: req.auth.agencyId };
}

/** GET /notifications?category=&read=false&search=&page=1&limit=20 */
export async function listNotifications(req: Request, res: Response) {
  const query = res.locals['query'] as ListNotificationsQuery;
  const { items, meta } = await notificationsService.list(viewerOf(req), query);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /notifications/unread-count : pour la pastille de la cloche, interrogée régulièrement. */
export async function getUnreadCount(req: Request, res: Response) {
  const count = await notificationsService.unreadCount(viewerOf(req));
  res.set('Cache-Control', 'private, no-store').status(StatusCodes.OK).json(successBody({ count }));
}

/** PATCH /notifications/read */
export async function setRead(req: Request, res: Response) {
  const { ids, read } = req.body as SetReadBody;
  await notificationsService.setRead(viewerOf(req), ids, read);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** POST /notifications/read-all */
export async function markAllRead(req: Request, res: Response) {
  await notificationsService.markAllRead(viewerOf(req));
  res.status(StatusCodes.NO_CONTENT).end();
}
