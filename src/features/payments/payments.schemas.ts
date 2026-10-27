// Entrées des routes /payments. Noms de champs en snake_case, comme les types du front.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { PaymentMethod } from '../../generated/prisma/enums.js';

const MAX_AMOUNT = 1_000_000_000;
const MAX_REFERENCE_LENGTH = 80;
const MAX_NOTES_LENGTH = 500;
const MAX_ALLOCATIONS = 100;

/** Montant entier en F CFA, strictement positif. */
const amount = z
  .number()
  .int('Le montant est un nombre entier de F CFA.')
  .positive('Le montant doit être supérieur à 0.')
  .max(MAX_AMOUNT);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const recordPaymentBodySchema = z
  .object({
    client_id: z.uuid('Choisissez le client.'),
    amount,
    method: z.enum(PaymentMethod),
    reference: optionalText(MAX_REFERENCE_LENGTH),
    notes: optionalText(MAX_NOTES_LENGTH),
    /** Répartition du versement : la part de chaque colis réglé. */
    allocations: z
      .array(z.object({ package_id: z.uuid(), amount }))
      .min(1, 'Indiquez au moins un colis réglé par ce versement.')
      .max(MAX_ALLOCATIONS),
  })
  .refine(
    (body) =>
      new Set(body.allocations.map((part) => part.package_id)).size === body.allocations.length,
    { message: 'Un même colis apparaît deux fois dans la répartition.', path: ['allocations'] }
  )
  .refine((body) => body.allocations.reduce((sum, part) => sum + part.amount, 0) === body.amount, {
    message: 'La somme des parts doit être égale au montant versé.',
    path: ['allocations'],
  });

export const reversePaymentBodySchema = z.object({
  reason: z.string().trim().min(1, 'Indiquez la raison de l’annulation.').max(MAX_NOTES_LENGTH),
});

export const PAYMENT_SORT_FIELDS = ['created_at', 'amount'] as const;
export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export const listPaymentsQuerySchema = listQuerySchema.extend({
  method: z.enum(PaymentMethod).optional(),
  client_id: z.uuid().optional(),
  /** Période, dates incluses, au format AAAA-MM-JJ (UTC). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z.enum(['created_at', '-created_at', 'amount', '-amount']).default('-created_at'),
});

export type RecordPaymentBody = z.infer<typeof recordPaymentBodySchema>;
export type ReversePaymentBody = z.infer<typeof reversePaymentBodySchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
