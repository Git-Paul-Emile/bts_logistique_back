// Cookies de session. HttpOnly : le JavaScript de la page ne peut pas les lire, donc une faille
// XSS ne suffit pas à voler la session (rules/20-qualite/security.md).
import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '../../config/env.js';
import { API_PREFIX } from '../../core/http/paths.js';

export const ACCESS_COOKIE = 'bts_access';
export const REFRESH_COOKIE = 'bts_refresh';

const MS_PER_SECOND = 1000;

const baseOptions: CookieOptions = {
  httpOnly: true,
  // En développement, le front et l'API tournent en HTTP sur localhost.
  secure: isProduction,
  sameSite: 'lax',
};

// Le jeton d'accès part vers toute l'API ; le jeton de rafraîchissement seulement vers
// les routes d'authentification, qui sont les seules à en avoir besoin.
const accessOptions: CookieOptions = { ...baseOptions, path: API_PREFIX };
const refreshOptions: CookieOptions = { ...baseOptions, path: `${API_PREFIX}/auth` };

export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...accessOptions,
    maxAge: env.JWT_ACCESS_EXPIRES_IN * MS_PER_SECOND,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...refreshOptions,
    maxAge: env.JWT_REFRESH_EXPIRES_IN * MS_PER_SECOND,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, accessOptions);
  res.clearCookie(REFRESH_COOKIE, refreshOptions);
}

/** Lit un cookie de session ; cookie-parser donne un objet sans type précis. */
export function readCookie(cookies: unknown, name: string): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
