// Traduction HTTP de la gestion des comptes. Toutes ces routes sont réservées aux administrateurs.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import { API_PREFIX } from '../../core/http/paths.js';
import type { IdParam } from '../../core/validation/common.schemas.js';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UserStatusBody,
} from './users.schemas.js';
import { usersService } from './users.service.js';

function actorIdOf(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}

/** GET /users?archived=false&role=&search=&sort=name&page=1&limit=20 */
export async function listUsers(_req: Request, res: Response) {
  const { items, meta } = await usersService.list(res.locals['query'] as ListUsersQuery);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /users/:id */
export async function getUser(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await usersService.get(id)));
}

/** POST /users : crée le compte et envoie l'invitation. */
export async function createUser(req: Request, res: Response) {
  const user = await usersService.invite(req.body as CreateUserBody, actorIdOf(req));
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/users/${user.id}`)
    .json(successBody(user));
}

/** PATCH /users/:id */
export async function updateUser(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const user = await usersService.update(id, req.body as UpdateUserBody, actorIdOf(req));
  res.status(StatusCodes.OK).json(successBody(user));
}

/** PATCH /users/:id/status */
export async function setUserStatus(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const { active } = req.body as UserStatusBody;
  const user = await usersService.setActive(id, active, actorIdOf(req));
  res.status(StatusCodes.OK).json(successBody(user));
}

/** POST /users/:id/restore */
export async function restoreUser(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await usersService.restore(id, actorIdOf(req))));
}
