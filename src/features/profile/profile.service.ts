// Règles métier du profil (F3) : coordonnées, mot de passe, suppression de son propre compte.
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { clock } from '../../lib/clock.js';
import { passwordHasher } from '../../lib/password.js';
import { toSessionUserDto, type SessionUserDto } from '../auth/auth.dto.js';
import { authService } from '../auth/auth.service.js';
import { EmailAlreadyUsedError, LastAdminError } from '../users/users.errors.js';
import { usersRepository } from '../users/users.repository.js';
import { SamePasswordError, WrongCurrentPasswordError } from './profile.errors.js';
import { profileRepository, type ProfileRecord } from './profile.repository.js';
import type { UpdateProfileBody } from './profile.schemas.js';

export interface ProfileUpdateResult {
  user: SessionUserDto;
  /** Nouvelle adresse en attente de confirmation par le lien envoyé, sinon null. */
  pendingEmail: string | null;
}

async function profileOf(userId: string): Promise<ProfileRecord> {
  const profile = await profileRepository.findById(userId);
  if (!profile) throw new UnauthorizedError();
  return profile;
}

/** Vérifie le mot de passe actuel avant une action sensible, même avec une session ouverte. */
async function checkCurrentPassword(profile: ProfileRecord, password: string): Promise<void> {
  if (!(await passwordHasher.verify(password, profile.passwordHash))) {
    throw new WrongCurrentPasswordError();
  }
}

export const profileService = {
  /**
   * Nom et téléphone changent tout de suite. Une nouvelle adresse e-mail est seulement mise en
   * attente : elle remplace l'ancienne quand la personne ouvre le lien reçu à cette adresse.
   */
  async update(userId: string, input: UpdateProfileBody): Promise<ProfileUpdateResult> {
    let profile = await profileOf(userId);
    const newEmail =
      input.email !== undefined && input.email !== profile.email ? input.email : null;
    if (newEmail && (await profileRepository.isEmailTaken(newEmail, userId))) {
      throw new EmailAlreadyUsedError();
    }
    if (input.name !== undefined || input.phone !== undefined) {
      profile = await profileRepository.updateIdentity(userId, {
        name: input.name,
        phone: input.phone,
      });
    }
    if (newEmail) await authService.sendEmailChangeLink(profile, newEmail);
    return { user: toSessionUserDto(profile), pendingEmail: newEmail };
  },

  /** Change le mot de passe et ferme toutes les autres connexions ; celle-ci reste ouverte. */
  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const profile = await profileOf(userId);
    await checkCurrentPassword(profile, currentPassword);
    if (currentPassword === newPassword) throw new SamePasswordError();
    const passwordHash = await passwordHasher.hash(newPassword);
    await profileRepository.changePassword(userId, passwordHash, sessionId, clock.now());
  },

  /**
   * Suppression demandée par la personne elle-même : le compte est archivé, jamais effacé, pour
   * garder les colis et paiements qui y sont liés. Le dernier administrateur actif ne peut pas
   * partir (vérifié dans une transaction sérialisable).
   */
  async archiveOwnAccount(userId: string, password: string): Promise<void> {
    await checkCurrentPassword(await profileOf(userId), password);
    await usersRepository.inTransaction(async (queries) => {
      const user = await queries.findById(userId);
      if (!user) throw new UnauthorizedError();
      if (user.role === 'admin' && (await queries.countActiveAdmins(userId)) === 0) {
        throw new LastAdminError();
      }
      const now = clock.now();
      await queries.update(userId, { archivedAt: now });
      await queries.revokeSessions(userId, now);
      await queries.audit({
        actorId: userId,
        action: 'user.archive_self',
        resourceType: 'user',
        resourceId: userId,
        before: { archived_at: null },
        after: { archived_at: now.toISOString() },
      });
    });
  },
};
