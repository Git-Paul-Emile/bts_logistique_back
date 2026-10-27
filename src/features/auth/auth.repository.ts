// Accès base de données de l'authentification : comptes, jetons de rafraîchissement, liens e-mail.
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { UserTokenPurpose } from '../../generated/prisma/enums.js';
import type { EmailMessage } from '../../infrastructure/email/emailMessages.js';
import { queueEmail } from '../../infrastructure/email/emailOutbox.repository.js';

const accountSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  passwordHash: true,
  active: true,
  archivedAt: true,
  agencyId: true,
  agency: { select: { code: true, name: true } },
} satisfies Prisma.UserSelect;

export type AccountRecord = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

export interface NewUserToken {
  userId: string;
  purpose: UserTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  /** Seulement pour un changement d'adresse : l'adresse à confirmer. */
  newEmail?: string;
}

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  expiresAt: Date;
}

export const authRepository = {
  findAccountByEmail(email: string): Promise<AccountRecord | null> {
    return prisma.user.findUnique({ where: { email }, select: accountSelect });
  },

  findAccountById(id: string): Promise<AccountRecord | null> {
    return prisma.user.findUnique({ where: { id }, select: accountSelect });
  },

  async createRefreshToken(token: NewRefreshToken): Promise<void> {
    await prisma.refreshToken.create({ data: token, select: { id: true } });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        replacedAt: true,
      },
    });
  },

  /**
   * Remplace un jeton par le suivant, dans une transaction. La mise à jour conditionnelle
   * garantit qu'un jeton n'est remplacé qu'une fois, même si deux requêtes arrivent ensemble :
   * renvoie false si le jeton avait déjà été utilisé ou révoqué.
   */
  rotateRefreshToken(currentId: string, next: NewRefreshToken, now: Date): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: currentId, replacedAt: null, revokedAt: null },
        data: { replacedAt: now },
      });
      if (count === 0) return false;
      await tx.refreshToken.create({ data: next, select: { id: true } });
      return true;
    });
  },

  /** Une connexion est ouverte tant qu'un de ses jetons n'est ni révoqué ni expiré. */
  async isSessionOpen(familyId: string, now: Date): Promise<boolean> {
    const token = await prisma.refreshToken.findFirst({
      where: { familyId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    return token !== null;
  },

  /** Révoque tous les jetons d'une même connexion. */
  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  },

  /**
   * Crée un lien envoyé par e-mail, l'inscrit dans la boîte d'envoi, et invalide les liens
   * précédents du même usage encore valables : seul le dernier lien reçu fonctionne.
   */
  async createUserToken(link: NewUserToken, now: Date, email: EmailMessage): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.userToken.updateMany({
        where: { userId: link.userId, purpose: link.purpose, usedAt: null },
        data: { usedAt: now },
      });
      await tx.userToken.create({ data: link, select: { id: true } });
      // Le lien et son e-mail sont écrits ensemble : pas de lien sans e-mail, ni l'inverse.
      await queueEmail(tx, email);
    });
  },

  /** Lien envoyé par e-mail (réinitialisation, invitation, nouvelle adresse), retrouvé par son empreinte et son usage. */
  findUserToken(tokenHash: string, purpose: UserTokenPurpose) {
    return prisma.userToken.findFirst({
      where: { tokenHash, purpose },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        newEmail: true,
        user: { select: { active: true, archivedAt: true } },
      },
    });
  },

  /**
   * Consomme le lien, enregistre le nouveau mot de passe et ferme toutes les sessions du compte,
   * en une seule transaction. Renvoie false si le lien a déjà été utilisé entre-temps.
   */
  consumeTokenAndSetPassword(
    tokenId: string,
    userId: string,
    passwordHash: string,
    now: Date
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.userToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
  },

  /**
   * Consomme le lien de confirmation et remplace l'adresse, en une transaction. Renvoie false si
   * le lien a déjà été utilisé entre-temps. Si l'adresse a été prise depuis la demande, la
   * contrainte d'unicité refuse l'écriture et rien n'est modifié.
   */
  consumeTokenAndChangeEmail(
    tokenId: string,
    userId: string,
    newEmail: string,
    now: Date
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.userToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({
        where: { id: userId },
        data: { email: newEmail },
        select: { id: true },
      });
      return true;
    });
  },
};
