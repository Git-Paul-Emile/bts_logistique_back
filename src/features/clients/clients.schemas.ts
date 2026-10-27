// Entrées des routes /clients. Noms de champs en snake_case, comme les types du front.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { emailSchema } from '../auth/auth.schemas.js';

const MAX_NAME_LENGTH = 160;
const MAX_PHONE_LENGTH = 30;
const MAX_ADDRESS_LENGTH = 255;
const MAX_AGENCY_CODE_LENGTH = 12;
/** Un téléphone doit contenir au moins quelques chiffres pour pouvoir joindre le client. */
const MIN_PHONE_DIGITS = 8;

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const CLIENT_SORT_FIELDS = ['name', 'created_at', 'balance'] as const;
export type ClientSortField = (typeof CLIENT_SORT_FIELDS)[number];

export const listClientsQuerySchema = listQuerySchema.extend({
  has_debt: booleanQuery.optional(),
  sort: z
    .enum(['name', '-name', 'created_at', '-created_at', 'balance', '-balance'])
    .default('name'),
});

/** Champ texte facultatif : une chaîne vide est enregistrée comme absente. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();
}

const clientFields = {
  name: z.string().trim().min(1, 'Saisissez le nom du client.').max(MAX_NAME_LENGTH),
  phone: z
    .string()
    .trim()
    .max(MAX_PHONE_LENGTH)
    .refine(
      (phone) => phone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS,
      'Saisissez un numéro de téléphone complet, avec l’indicatif.'
    ),
  email: z.union([z.literal('').transform(() => null), emailSchema]).nullable(),
  address: optionalText(MAX_ADDRESS_LENGTH),
  agency_code: z.string().trim().min(1).max(MAX_AGENCY_CODE_LENGTH),
};

export const createClientBodySchema = z.object({
  name: clientFields.name,
  phone: clientFields.phone,
  email: clientFields.email.optional(),
  address: clientFields.address.optional(),
  // Facultatif : par défaut, l'agence de la personne qui enregistre le client.
  agency_code: clientFields.agency_code.optional(),
});

export const updateClientBodySchema = z
  .object(clientFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Indiquez au moins un champ à modifier.');

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type CreateClientBody = z.infer<typeof createClientBodySchema>;
export type UpdateClientBody = z.infer<typeof updateClientBodySchema>;
