// Traduction HTTP du profil de la personne connectée.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import { clearSessionCookies } from '../auth/auth.cookies.js';
import type { AuthContext } from '../auth/auth.service.js';
import type {
  ChangePasswordBody,
  DeleteAccountBody,
  UpdateProfileBody,
} from './profile.schemas.js';
import { profileService } from './profile.service.js';

function sessionOf(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

/** PATCH /me : nom, téléphone, et demande de changement d'adresse e-mail. */
export async function updateProfile(req: Request, res: Response) {
  const { userId } = sessionOf(req);
  const result = await profileService.update(userId, req.body as UpdateProfileBody);
  res
    .status(StatusCodes.OK)
    .json(successBody({ user: result.user, pending_email: result.pendingEmail }));
}

/** POST /me/password */
export async function changePassword(req: Request, res: Response) {
  const { userId, sessionId } = sessionOf(req);
  const body = req.body as ChangePasswordBody;
  await profileService.changePassword(userId, sessionId, body.current_password, body.new_password);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** DELETE /me : archive le compte et ferme la session. */
export async function deleteAccount(req: Request, res: Response) {
  const { userId } = sessionOf(req);
  await profileService.archiveOwnAccount(userId, (req.body as DeleteAccountBody).password);
  clearSessionCookies(res);
  res.status(StatusCodes.NO_CONTENT).end();
}
