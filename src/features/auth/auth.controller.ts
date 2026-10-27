// Traduction HTTP de l'authentification : lit la requête, appelle le service, pose les cookies.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import {
  clearSessionCookies,
  readCookie,
  REFRESH_COOKIE,
  setSessionCookies,
} from './auth.cookies.js';
import type { SessionUserDto } from './auth.dto.js';
import { SessionExpiredError } from './auth.errors.js';
import type {
  ConfirmEmailBody,
  ForgotPasswordBody,
  LoginBody,
  ResetPasswordBody,
} from './auth.schemas.js';
import { authService, type Session } from './auth.service.js';

const MAX_USER_AGENT_LENGTH = 255;

function userAgentOf(req: Request): string | null {
  return req.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null;
}

function sessionBody(user: SessionUserDto, csrfToken: string) {
  return successBody({ user, csrf_token: csrfToken });
}

function sendSession(res: Response, session: Session): void {
  setSessionCookies(res, session);
  res.status(StatusCodes.OK).json(sessionBody(session.user, session.csrfToken));
}

/** POST /auth/login */
export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginBody;
  sendSession(res, await authService.login(email, password, userAgentOf(req)));
}

/** POST /auth/refresh : nouvelle paire de jetons. En cas d'échec, les cookies sont effacés. */
export async function refresh(req: Request, res: Response) {
  try {
    const refreshToken = readCookie(req.cookies, REFRESH_COOKIE);
    sendSession(res, await authService.refresh(refreshToken, userAgentOf(req)));
  } catch (error) {
    if (error instanceof SessionExpiredError) clearSessionCookies(res);
    throw error;
  }
}

/** POST /auth/logout */
export async function logout(req: Request, res: Response) {
  await authService.logout(readCookie(req.cookies, REFRESH_COOKIE));
  clearSessionCookies(res);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** GET /auth/me : la personne connectée et le jeton CSRF de sa session (après un rechargement). */
export async function me(req: Request, res: Response) {
  if (!req.auth) throw new UnauthorizedError();
  const user = await authService.currentUser(req.auth.userId);
  res.status(StatusCodes.OK).json(sessionBody(user, req.auth.csrf));
}

/** POST /auth/password/forgot : toujours 204, que l'adresse existe ou non. */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as ForgotPasswordBody;
  await authService.requestPasswordReset(email);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** POST /auth/password/reset : toutes les sessions du compte sont fermées. */
export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as ResetPasswordBody;
  await authService.resetPassword(token, password);
  clearSessionCookies(res);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** POST /auth/invitation/accept : la personne invitée choisit son mot de passe. */
export async function acceptInvitation(req: Request, res: Response) {
  const { token, password } = req.body as ResetPasswordBody;
  await authService.acceptInvitation(token, password);
  res.status(StatusCodes.NO_CONTENT).end();
}

/** POST /auth/email/confirm : lien reçu à la nouvelle adresse. Fonctionne sans être connecté. */
export async function confirmEmail(req: Request, res: Response) {
  const { token } = req.body as ConfirmEmailBody;
  await authService.confirmEmailChange(token);
  res.status(StatusCodes.NO_CONTENT).end();
}
