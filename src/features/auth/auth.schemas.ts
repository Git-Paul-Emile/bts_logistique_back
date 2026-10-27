// Entrées des routes d'authentification. Les types TypeScript sont dérivés de ces schémas.
import { z } from 'zod';

const MAX_EMAIL_LENGTH = 254;
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt ne prend en compte que les 72 premiers octets : au-delà, la fin serait ignorée. */
const MAX_PASSWORD_BYTES = 72;
/** Borne la saisie à la connexion, pour ne pas faire travailler bcrypt sur un texte énorme. */
const MAX_LOGIN_PASSWORD_LENGTH = 200;

/** Adresse sans espaces autour et en minuscules, comme elle est enregistrée en base. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH)
  .pipe(z.email('Adresse e-mail invalide.'));

export const newPasswordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
  )
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES,
    'Le mot de passe est trop long.'
  );

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Saisissez votre mot de passe.').max(MAX_LOGIN_PASSWORD_LENGTH),
});

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1).max(MAX_LOGIN_PASSWORD_LENGTH),
  password: newPasswordSchema,
});

export const confirmEmailBodySchema = z.object({
  token: z.string().min(1).max(MAX_LOGIN_PASSWORD_LENGTH),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type ConfirmEmailBody = z.infer<typeof confirmEmailBodySchema>;
