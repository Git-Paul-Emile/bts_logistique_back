// Règles métier de l'authentification (F1). Aucune dépendance à Express : les cookies sont
// posés par le controller à partir de ce que renvoie ce service.
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { EmailAlreadyUsedError } from '../users/users.errors.js';
import type { UserRole, UserTokenPurpose } from '../../generated/prisma/enums.js';
import { clock } from '../../lib/clock.js';
import { logger } from '../../lib/logger.js';
import { passwordHasher } from '../../lib/password.js';
import { toSessionUserDto, type SessionUserDto } from './auth.dto.js';
import {
  AccountDisabledError,
  InvalidCredentialsError,
  InvalidEmailTokenError,
  InvalidInvitationTokenError,
  InvalidResetTokenError,
  SessionExpiredError,
} from './auth.errors.js';
import { authRepository, type AccountRecord } from './auth.repository.js';
import {
  expiresIn,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  type AccessClaims,
} from './auth.tokens.js';

const RESET_TOKEN_TTL_MINUTES = 60;
const SECONDS_PER_MINUTE = 60;
/** Chemin de la page du front qui lit le jeton dans ?token=. */
const RESET_PASSWORD_PATH = '/reinitialiser-mot-de-passe';
const EMAIL_CHANGE_TTL_MINUTES = 24 * 60;
/** Page du front qui confirme la nouvelle adresse (lit ?token=). */
const CONFIRM_EMAIL_PATH = '/confirmer-email';

/** Session d'une requête authentifiée, rangée dans `req.auth`. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  agencyId: string;
  /** Connexion en cours : permet de fermer les autres sans fermer celle-ci. */
  sessionId: string;
  /** Jeton anti-CSRF signé dans le jeton d'accès. */
  csrf: string;
}

/** Ce que les services métier savent de la personne qui fait la demande. */
export type Viewer = Pick<AuthContext, 'userId' | 'role' | 'agencyId'>;

export interface Session {
  user: SessionUserDto;
  accessToken: string;
  refreshToken: string;
  /** Jeton anti-CSRF, aussi signé dans le jeton d'accès. Le front le renvoie en en-tête. */
  csrfToken: string;
}

function isUsable(account: Pick<AccountRecord, 'active' | 'archivedAt'>): boolean {
  return account.active && account.archivedAt === null;
}

function buildAccess(account: AccountRecord, sessionId: string) {
  const csrfToken = generateOpaqueToken();
  const accessToken = signAccessToken({
    sub: account.id,
    sid: sessionId,
    csrf: csrfToken,
  });
  return { accessToken, csrfToken };
}

/** Ouvre une nouvelle connexion : un nouveau jeton de rafraîchissement, dans une nouvelle famille. */
async function openSession(account: AccountRecord, userAgent: string | null): Promise<Session> {
  const refreshToken = generateOpaqueToken();
  const familyId = randomUUID();
  await authRepository.createRefreshToken({
    userId: account.id,
    familyId,
    tokenHash: hashOpaqueToken(refreshToken),
    userAgent,
    expiresAt: expiresIn(env.JWT_REFRESH_EXPIRES_IN),
  });
  return { user: toSessionUserDto(account), refreshToken, ...buildAccess(account, familyId) };
}

/** Remplace le jeton de rafraîchissement courant par un nouveau, dans la même famille. */
async function rotateSession(
  account: AccountRecord,
  current: { id: string; familyId: string },
  userAgent: string | null,
  now: Date
): Promise<Session> {
  const nextToken = generateOpaqueToken();
  const rotated = await authRepository.rotateRefreshToken(
    current.id,
    {
      userId: account.id,
      familyId: current.familyId,
      tokenHash: hashOpaqueToken(nextToken),
      userAgent,
      expiresAt: expiresIn(env.JWT_REFRESH_EXPIRES_IN),
    },
    now
  );
  // Une autre requête a utilisé ce jeton juste avant : même traitement qu'une réutilisation.
  if (!rotated) {
    await authRepository.revokeFamily(current.familyId, now);
    throw new SessionExpiredError();
  }
  return {
    user: toSessionUserDto(account),
    refreshToken: nextToken,
    ...buildAccess(account, current.familyId),
  };
}

/**
 * Consomme un lien reçu par e-mail et enregistre le mot de passe choisi. Renvoie false si le
 * lien est inconnu, déjà utilisé, expiré, ou si le compte n'est plus utilisable.
 */
async function setPasswordFromLink(
  token: string,
  purpose: UserTokenPurpose,
  newPassword: string
): Promise<boolean> {
  const now = clock.now();
  const link = await authRepository.findUserToken(hashOpaqueToken(token), purpose);
  if (!link || link.usedAt || link.expiresAt <= now || !isUsable(link.user)) return false;
  const passwordHash = await passwordHasher.hash(newPassword);
  return authRepository.consumeTokenAndSetPassword(link.id, link.userId, passwordHash, now);
}

export const authService = {
  async login(email: string, password: string, userAgent: string | null): Promise<Session> {
    const account = await authRepository.findAccountByEmail(email);
    // La comparaison a lieu même sans compte, pour que la durée de réponse ne révèle rien.
    const passwordMatches = await passwordHasher.verify(password, account?.passwordHash);
    if (!account || !passwordMatches) throw new InvalidCredentialsError();
    if (!isUsable(account)) throw new AccountDisabledError();
    return openSession(account, userAgent);
  },

  /**
   * Échange un jeton de rafraîchissement contre un nouveau (rotation). Présenter un jeton déjà
   * remplacé signifie qu'il a été copié : toute la connexion est alors révoquée.
   */
  async refresh(refreshToken: string | undefined, userAgent: string | null): Promise<Session> {
    if (!refreshToken) throw new SessionExpiredError();
    const now = clock.now();
    const current = await authRepository.findRefreshToken(hashOpaqueToken(refreshToken));
    if (!current || current.revokedAt) throw new SessionExpiredError();
    if (current.replacedAt) {
      await authRepository.revokeFamily(current.familyId, now);
      logger.warn({ userId: current.userId }, 'Réutilisation d’un jeton de rafraîchissement');
      throw new SessionExpiredError();
    }
    const account = await authRepository.findAccountById(current.userId);
    if (current.expiresAt <= now || !account || !isUsable(account)) {
      await authRepository.revokeFamily(current.familyId, now);
      throw new SessionExpiredError();
    }
    return rotateSession(account, current, userAgent, now);
  },

  /** Ferme la connexion liée à ce jeton. Sans jeton connu, il n'y a rien à fermer. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const current = await authRepository.findRefreshToken(hashOpaqueToken(refreshToken));
    if (current) await authRepository.revokeFamily(current.familyId, clock.now());
  },

  /** Personne connectée, relue en base : un compte désactivé entre-temps n'est plus accepté. */
  async currentUser(userId: string): Promise<SessionUserDto> {
    const account = await authRepository.findAccountById(userId);
    if (!account || !isUsable(account)) throw new SessionExpiredError();
    return toSessionUserDto(account);
  },

  /**
   * Prépare un lien de réinitialisation si le compte existe et est actif. Ne signale jamais si
   * l'adresse est connue : la réponse est la même dans tous les cas.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const account = await authRepository.findAccountByEmail(email);
    if (!account || !isUsable(account)) return;

    const token = generateOpaqueToken();
    const resetUrl = new URL(RESET_PASSWORD_PATH, env.FRONT_URL);
    resetUrl.searchParams.set('token', token);
    await authRepository.createUserToken(
      {
        userId: account.id,
        purpose: 'password_reset',
        tokenHash: hashOpaqueToken(token),
        expiresAt: expiresIn(RESET_TOKEN_TTL_MINUTES * SECONDS_PER_MINUTE),
      },
      clock.now(),
      {
        kind: 'password_reset',
        to: account.email,
        data: {
          recipientName: account.name,
          resetUrl: resetUrl.toString(),
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
        },
      }
    );
  },

  /** Enregistre le nouveau mot de passe et ferme toutes les sessions ouvertes du compte. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const done = await setPasswordFromLink(token, 'password_reset', newPassword);
    if (!done) throw new InvalidResetTokenError();
  },

  /** Première connexion d'une personne invitée : elle choisit son mot de passe. */
  async acceptInvitation(token: string, newPassword: string): Promise<void> {
    const done = await setPasswordFromLink(token, 'invitation', newPassword);
    if (!done) throw new InvalidInvitationTokenError();
  },

  /**
   * Session d'une requête : le jeton d'accès donne l'identité, la base donne le rôle, l'état du
   * compte et celui de la connexion. Une désactivation, un changement de rôle, une déconnexion
   * ou un changement de mot de passe s'appliquent donc dès la requête suivante.
   */
  async resolveSession(claims: AccessClaims): Promise<AuthContext> {
    const [account, sessionOpen] = await Promise.all([
      authRepository.findAccountById(claims.sub),
      authRepository.isSessionOpen(claims.sid, clock.now()),
    ]);
    if (!account || !isUsable(account) || !sessionOpen) throw new UnauthorizedError();
    return {
      userId: account.id,
      role: account.role,
      agencyId: account.agencyId,
      sessionId: claims.sid,
      csrf: claims.csrf,
    };
  },

  /**
   * Envoie un lien de confirmation à la nouvelle adresse. L'adresse du compte ne change qu'à
   * l'ouverture du lien : une faute de frappe ne peut donc pas bloquer l'accès au compte.
   */
  async sendEmailChangeLink(
    account: { id: string; name: string },
    newEmail: string
  ): Promise<void> {
    const token = generateOpaqueToken();
    const confirmUrl = new URL(CONFIRM_EMAIL_PATH, env.FRONT_URL);
    confirmUrl.searchParams.set('token', token);
    await authRepository.createUserToken(
      {
        userId: account.id,
        purpose: 'email_change',
        tokenHash: hashOpaqueToken(token),
        expiresAt: expiresIn(EMAIL_CHANGE_TTL_MINUTES * SECONDS_PER_MINUTE),
        newEmail,
      },
      clock.now(),
      {
        kind: 'email_change',
        to: newEmail,
        data: {
          recipientName: account.name,
          confirmUrl: confirmUrl.toString(),
          expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES,
        },
      }
    );
  },

  /** Ouverture du lien reçu à la nouvelle adresse : l'adresse du compte est remplacée. */
  async confirmEmailChange(token: string): Promise<void> {
    const now = clock.now();
    const link = await authRepository.findUserToken(hashOpaqueToken(token), 'email_change');
    if (!link?.newEmail || link.usedAt || link.expiresAt <= now || !isUsable(link.user)) {
      throw new InvalidEmailTokenError();
    }
    const holder = await authRepository.findAccountByEmail(link.newEmail);
    if (holder && holder.id !== link.userId) throw new EmailAlreadyUsedError();
    const done = await authRepository.consumeTokenAndChangeEmail(
      link.id,
      link.userId,
      link.newEmail,
      now
    );
    if (!done) throw new InvalidEmailTokenError();
  },
};
