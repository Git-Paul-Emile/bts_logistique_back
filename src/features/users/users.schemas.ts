// Entrées des routes /users. Noms de champs en snake_case, comme les types du front.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { emailSchema } from '../auth/auth.schemas.js';

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 30;
const MAX_AGENCY_CODE_LENGTH = 12;

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Tri autorisé : nom, e-mail ou date de création, « - » devant pour l'ordre décroissant. */
export const USER_SORT_FIELDS = ['name', 'email', 'created_at'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export const listUsersQuerySchema = listQuerySchema.extend({
  archived: booleanQuery.default(false),
  role: z.enum(UserRole).optional(),
  sort: z.enum(['name', '-name', 'email', '-email', 'created_at', '-created_at']).default('name'),
});

/** Téléphone facultatif : une chaîne vide est enregistrée comme absente. */
const phoneSchema = z
  .string()
  .trim()
  .max(MAX_PHONE_LENGTH)
  .transform((value) => (value === '' ? null : value))
  .nullable();

const userFields = {
  name: z.string().trim().min(1, 'Saisissez le nom.').max(MAX_NAME_LENGTH),
  email: emailSchema,
  phone: phoneSchema,
  role: z.enum(UserRole),
  agency_code: z.string().trim().min(1, 'Choisissez une agence.').max(MAX_AGENCY_CODE_LENGTH),
};

export const createUserBodySchema = z.object({
  ...userFields,
  phone: phoneSchema.optional(),
});

export const updateUserBodySchema = z
  .object(userFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Indiquez au moins un champ à modifier.');

export const userStatusBodySchema = z.object({ active: z.boolean() });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type UserStatusBody = z.infer<typeof userStatusBodySchema>;
