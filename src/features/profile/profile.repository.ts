// Accès base de données du profil de la personne connectée (F3).
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  // Lu pour vérifier le mot de passe actuel ; jamais renvoyé.
  passwordHash: true,
  agency: { select: { code: true, name: true } },
} satisfies Prisma.UserSelect;

export type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

export const profileRepository = {
  findById(id: string): Promise<ProfileRecord | null> {
    return prisma.user.findUnique({ where: { id }, select: profileSelect });
  },

  async isEmailTaken(email: string, exceptUserId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return user !== null && user.id !== exceptUserId;
  },

  updateIdentity(id: string, changes: { name?: string; phone?: string | null }) {
    return prisma.user.update({ where: { id }, data: changes, select: profileSelect });
  },

  /** Enregistre le nouveau mot de passe et ferme toutes les autres connexions, ensemble. */
  async changePassword(
    userId: string,
    passwordHash: string,
    keepSessionId: string,
    now: Date
  ): Promise<void> {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, familyId: { not: keepSessionId } },
        data: { revokedAt: now },
      }),
    ]);
  },
};
