// Schémas Zod réutilisés par toutes les fonctionnalités.
import { z } from 'zod';

/** Paramètre d'URL `:id` : identifiant au format UUID. */
export const idParamSchema = z.object({
  id: z.uuid('Identifiant invalide.'),
});

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Paramètres communs à toute route de collection : ?page=1&limit=20&sort=-createdAt&search=texte
 * Chaque route restreint ensuite `sort` à sa propre liste blanche de champs.
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().optional(),
  search: z.string().trim().min(1).optional(),
});

export type IdParam = z.infer<typeof idParamSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
