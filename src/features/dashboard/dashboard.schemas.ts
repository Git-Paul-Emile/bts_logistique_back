import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM.')
    .optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
