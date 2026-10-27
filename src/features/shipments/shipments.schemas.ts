// Entrées des routes /shipments. Noms de champs en snake_case, comme les types du front.
import { z } from 'zod';
import { listQuerySchema } from '../../core/validation/common.schemas.js';
import { ShipmentStatus, TransportMode } from '../../generated/prisma/enums.js';

const MAX_CONTAINER_NUMBER_LENGTH = 40;
const MAX_CARRIER_LENGTH = 80;
const MAX_NOTES_LENGTH = 500;
const MAX_CODE_LENGTH = 12;
/** Bien au-delà du plus grand conteneur (environ 76 m³) : bloque une faute de frappe. */
const MAX_CAPACITY_CBM = 1_000;
const MAX_PACKAGES_PER_REQUEST = 200;

const placeCode = z.string().trim().min(1).max(MAX_CODE_LENGTH);
const isoDate = z.iso.date('Date attendue au format AAAA-MM-JJ.');
const capacity = z.number().positive('La capacité doit être supérieure à 0.').max(MAX_CAPACITY_CBM);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

/** L'arrivée prévue ne précède pas le départ (aussi garanti par une contrainte en base). */
function datesInOrder(body: { departure_date?: string | null; estimated_arrival?: string | null }) {
  return (
    !body.departure_date || !body.estimated_arrival || body.estimated_arrival >= body.departure_date
  );
}
const datesMessage = {
  message: 'L’arrivée prévue doit être postérieure au départ.',
  path: ['estimated_arrival'],
};

export const listShipmentsQuerySchema = listQuerySchema.extend({
  status: z.enum(ShipmentStatus).optional(),
  transport_mode: z.enum(TransportMode).optional(),
  sort: z
    .enum(['created_at', '-created_at', 'departure_date', '-departure_date'])
    .default('-created_at'),
});

export const createShipmentBodySchema = z
  .object({
    container_number: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'Saisissez le numéro du conteneur ou du vol.')
      .max(MAX_CONTAINER_NUMBER_LENGTH),
    transport_mode: z.enum(TransportMode),
    carrier: z.string().trim().min(1, 'Saisissez le transporteur.').max(MAX_CARRIER_LENGTH),
    origin_code: placeCode,
    destination_code: placeCode,
    max_volume_cbm: capacity,
    departure_date: isoDate.nullable().optional(),
    estimated_arrival: isoDate.nullable().optional(),
    notes: optionalText(MAX_NOTES_LENGTH).optional(),
  })
  .refine((body) => body.origin_code !== body.destination_code, {
    message: 'La destination doit être différente de l’origine.',
    path: ['destination_code'],
  })
  .refine(datesInOrder, datesMessage);

export const updateShipmentBodySchema = z
  .object({
    carrier: z.string().trim().min(1).max(MAX_CARRIER_LENGTH),
    max_volume_cbm: capacity,
    departure_date: isoDate.nullable(),
    estimated_arrival: isoDate.nullable(),
    notes: optionalText(MAX_NOTES_LENGTH),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Indiquez au moins un champ à modifier.')
  .refine(datesInOrder, datesMessage);

export const shipmentStatusBodySchema = z.object({
  status: z.enum(ShipmentStatus),
  /** Pour « arrivé » : date réelle d'arrivée, par défaut aujourd'hui. */
  actual_arrival: isoDate.optional(),
});

export const assignPackagesBodySchema = z.object({
  package_ids: z
    .array(z.uuid())
    .min(1, 'Choisissez au moins un colis.')
    .max(MAX_PACKAGES_PER_REQUEST)
    .refine((ids) => new Set(ids).size === ids.length, 'Un même colis apparaît deux fois.'),
});

export const shipmentPackageParamsSchema = z.object({ id: z.uuid(), packageId: z.uuid() });

export type ShipmentSortField = 'created_at' | 'departure_date';
export type ListShipmentsQuery = z.infer<typeof listShipmentsQuerySchema>;
export type CreateShipmentBody = z.infer<typeof createShipmentBodySchema>;
export type UpdateShipmentBody = z.infer<typeof updateShipmentBodySchema>;
export type ShipmentStatusBody = z.infer<typeof shipmentStatusBodySchema>;
export type AssignPackagesBody = z.infer<typeof assignPackagesBodySchema>;
export type ShipmentPackageParams = z.infer<typeof shipmentPackageParamsSchema>;
