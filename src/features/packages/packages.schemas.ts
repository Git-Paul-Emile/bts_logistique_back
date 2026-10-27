// Entrées des routes /packages. Noms de champs en snake_case, comme les types du front.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import {
  PackageStatus,
  PaymentMethod,
  PaymentStatus,
  TransportMode,
} from '../../generated/prisma/enums.js';

/** Bornes de saisie : bien au-delà de tout colis réel, elles bloquent une faute de frappe. */
const MAX_DIMENSION_CM = 2_000;
const MAX_WEIGHT_KG = 50_000;
const MAX_RATE_PER_CBM = 100_000_000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_LENGTH = 120;
const MAX_COMMENT_LENGTH = 500;
const MAX_REFERENCE_LENGTH = 80;
const MAX_CODE_LENGTH = 12;

const placeCode = z.string().trim().min(1).max(MAX_CODE_LENGTH);
const dimension = z
  .number()
  .positive('La dimension doit être supérieure à 0.')
  .max(MAX_DIMENSION_CM);
const rate = z
  .number()
  .int('Le tarif au m³ est un montant entier en F CFA.')
  .positive()
  .max(MAX_RATE_PER_CBM);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const sameRoute = {
  message: 'La destination doit être différente de l’origine.',
  path: ['destination_code'],
};

export const PACKAGE_SORT_FIELDS = ['created_at', 'final_price', 'tracking_number'] as const;
export type PackageSortField = (typeof PACKAGE_SORT_FIELDS)[number];

export const listPackagesQuerySchema = listQuerySchema.extend({
  status: z.enum(PackageStatus).optional(),
  payment_status: z.enum(PaymentStatus).optional(),
  transport_mode: z.enum(TransportMode).optional(),
  agency_code: placeCode.optional(),
  client_id: z.uuid().optional(),
  sort: z
    .enum([
      'created_at',
      '-created_at',
      'final_price',
      '-final_price',
      'tracking_number',
      '-tracking_number',
    ])
    .default('-created_at'),
});

const measures = {
  length_cm: dimension,
  width_cm: dimension,
  height_cm: dimension,
  weight_kg: z.number().positive('Le poids doit être supérieur à 0.').max(MAX_WEIGHT_KG),
};

export const createPackageBodySchema = z
  .object({
    client_id: z.uuid('Choisissez le client.'),
    origin_code: placeCode,
    destination_code: placeCode,
    transport_mode: z.enum(TransportMode),
    description: optionalText(MAX_DESCRIPTION_LENGTH).optional(),
    ...measures,
    /** Tarif personnalisé : réservé à l'équipe, sinon celui de la grille s'applique. */
    rate_per_cbm: rate.optional(),
    /** Équipe seulement : agence d'enregistrement, par défaut celle de la personne connectée. */
    agency_code: placeCode.optional(),
    initial_payment: z
      .object({
        amount: z.number().int().positive('Le montant versé doit être supérieur à 0.'),
        method: z.enum(PaymentMethod),
        reference: optionalText(MAX_REFERENCE_LENGTH).optional(),
      })
      .optional(),
  })
  .refine((body) => body.origin_code !== body.destination_code, sameRoute);

export const updatePackageBodySchema = z
  .object({
    description: optionalText(MAX_DESCRIPTION_LENGTH),
    origin_code: placeCode,
    destination_code: placeCode,
    ...measures,
    rate_per_cbm: rate,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Indiquez au moins un champ à modifier.')
  .refine(
    (body) =>
      !body.origin_code || !body.destination_code || body.origin_code !== body.destination_code,
    sameRoute
  );

export const packageEventBodySchema = z.object({
  status: z.enum(PackageStatus),
  /** Lieu tel que l'agent le décrit (« Port d'Abidjan, quai 3 »). */
  location: z.string().trim().min(1, 'Indiquez où se trouve le colis.').max(MAX_LOCATION_LENGTH),
  /** Ville du réseau, quand l'étape a lieu dans l'une d'elles. */
  location_code: placeCode.optional(),
  comment: optionalText(MAX_COMMENT_LENGTH).optional(),
  notify_client: z.boolean().default(false),
});

export type ListPackagesQuery = z.infer<typeof listPackagesQuerySchema>;
export type CreatePackageBody = z.infer<typeof createPackageBodySchema>;
export type UpdatePackageBody = z.infer<typeof updatePackageBodySchema>;
export type PackageEventBody = z.infer<typeof packageEventBodySchema>;
