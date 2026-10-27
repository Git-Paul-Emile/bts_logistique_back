// Jetons de session : jeton d'accès (JWT court) et jetons opaques (rafraîchissement, liens e-mail).
import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { clock } from '../../lib/clock.js';

const OPAQUE_TOKEN_BYTES = 32;
const JWT_ALGORITHM = 'HS256';
const MS_PER_SECOND = 1000;

const accessClaimsSchema = z.object({
  sub: z.uuid(),
  /** Identifiant de la connexion (famille des jetons de rafraîchissement). */
  sid: z.uuid(),
  csrf: z.string().min(1),
});

/**
 * Contenu du jeton d'accès : seulement l'identité. Le rôle et l'état du compte sont relus en
 * base à chaque requête (`authService.resolveSession`). `csrf` est le jeton anti-CSRF de la session : le front le renvoie
 * dans l'en-tête X-CSRF-Token, et il doit être identique à celui signé dans le jeton.
 */
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

function nowInSeconds(): number {
  return Math.floor(clock.now().getTime() / MS_PER_SECOND);
}

/** Jeton aléatoire envoyé au navigateur (cookie ou lien), jamais stocké tel quel en base. */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/**
 * Empreinte d'un jeton opaque, seule valeur stockée en base. HMAC avec un secret serveur :
 * une copie de la base ne suffit pas à retrouver ni à fabriquer un jeton valide.
 */
export function hashOpaqueToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export function signAccessToken(claims: AccessClaims): string {
  const { sub, ...payload } = claims;
  return jwt.sign({ ...payload, iat: nowInSeconds() }, env.JWT_ACCESS_SECRET, {
    subject: sub,
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

/** Renvoie le contenu d'un jeton d'accès valide, ou null s'il est absent, falsifié ou expiré. */
export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [JWT_ALGORITHM],
      clockTimestamp: nowInSeconds(),
    });
    const claims = accessClaimsSchema.safeParse(decoded);
    return claims.success ? claims.data : null;
  } catch {
    // Signature invalide ou jeton expiré : pas une erreur serveur, juste une session absente.
    return null;
  }
}

/** Date d'expiration à `seconds` secondes de maintenant. */
export function expiresIn(seconds: number): Date {
  return new Date(clock.now().getTime() + seconds * MS_PER_SECOND);
}
