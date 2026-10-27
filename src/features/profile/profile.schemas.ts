// Entrées des routes /me (profil de la personne connectée).
import { z } from 'zod';
import { emailSchema, newPasswordSchema } from '../auth/auth.schemas.js';

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 30;
/** Borne la saisie d'un mot de passe à vérifier, pour ne pas faire travailler bcrypt sur un texte énorme. */
const MAX_PASSWORD_INPUT_LENGTH = 200;

const currentPasswordSchema = z
  .string()
  .min(1, 'Saisissez votre mot de passe actuel.')
  .max(MAX_PASSWORD_INPUT_LENGTH);

export const updateProfileBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Saisissez votre nom.').max(MAX_NAME_LENGTH),
    email: emailSchema,
    phone: z
      .string()
      .trim()
      .max(MAX_PHONE_LENGTH)
      .transform((value) => (value === '' ? null : value))
      .nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Indiquez au moins un champ à modifier.');

export const changePasswordBodySchema = z.object({
  current_password: currentPasswordSchema,
  new_password: newPasswordSchema,
});

export const deleteAccountBodySchema = z.object({
  password: currentPasswordSchema,
});

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;
