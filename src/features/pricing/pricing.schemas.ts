// Entrée de PUT /pricing : la grille complète, un tarif par mode de transport.
import { z } from 'zod';

/** Plafond de saisie : bien au-delà de tout tarif réel, il bloque une faute de frappe énorme. */
const MAX_RATE_PER_CBM = 100_000_000;

const modeRateSchema = z
  .object({
    // Le franc CFA n'a pas de subdivision utilisée : montants entiers.
    client_rate_per_cbm: z
      .number()
      .int('Le prix au m³ est un montant entier en F CFA.')
      .positive('Le prix au m³ doit être supérieur à 0.')
      .max(MAX_RATE_PER_CBM),
    collector_margin_per_cbm: z
      .number()
      .int('La marge au m³ est un montant entier en F CFA.')
      .min(0, 'La marge ne peut pas être négative.')
      .max(MAX_RATE_PER_CBM),
  })
  .refine((rate) => rate.collector_margin_per_cbm < rate.client_rate_per_cbm, {
    message: 'La marge collecteur doit être inférieure au prix client.',
    path: ['collector_margin_per_cbm'],
  });

export const updatePricingBodySchema = z.object({
  rates: z.object({ sea: modeRateSchema, air: modeRateSchema }),
});

export type ModeRateInput = z.infer<typeof modeRateSchema>;
export type UpdatePricingBody = z.infer<typeof updatePricingBodySchema>;
