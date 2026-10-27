// Création du tout premier administrateur, depuis la ligne de commande (scripts/create-admin.ts).
// Ensuite, les comptes se créent depuis l'interface, par un administrateur (F2).
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../core/errors/AppError.js';
import { passwordHasher } from '../../lib/password.js';
import { emailSchema, newPasswordSchema } from '../auth/auth.schemas.js';
import { usersRepository } from './users.repository.js';

const MAX_NAME_LENGTH = 120;

export const firstAdminInputSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  email: emailSchema,
  agencyCode: z.string().trim().min(1),
  password: newPasswordSchema,
});

export type FirstAdminInput = z.infer<typeof firstAdminInputSchema>;

export async function createFirstAdmin(input: FirstAdminInput): Promise<{ email: string }> {
  if ((await usersRepository.countActiveAdmins()) > 0) {
    throw new ConflictError(
      'Un administrateur actif existe déjà : créez les autres comptes depuis l’interface.',
      'ADMIN_ALREADY_EXISTS'
    );
  }
  const agency = await usersRepository.findAgencyIdByCode(input.agencyCode);
  if (!agency) {
    throw new NotFoundError(
      `Agence inconnue : ${input.agencyCode}. Lancez d’abord npm run db:seed.`,
      'AGENCY_NOT_FOUND'
    );
  }
  return usersRepository.create({
    name: input.name,
    email: input.email,
    role: 'admin',
    agencyId: agency.id,
    passwordHash: await passwordHasher.hash(input.password),
  });
}
