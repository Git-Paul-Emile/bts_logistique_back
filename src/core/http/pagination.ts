// Calculs communs à toutes les routes de collection (rules/10-stack/api.md).
import type { PaginationMeta } from './apiResponse.js';

/** Nombre de lignes à sauter pour atteindre la page demandée (la première page vaut 1). */
export function offsetOf(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, hasNext: page * limit < total };
}

/**
 * Traduit « name » ou « -name » (décroissant) en { field, direction }.
 * Le champ a déjà été restreint à une liste blanche par le schéma Zod de la route.
 */
export function parseSort<Field extends string>(
  sort: `${Field}` | `-${Field}`
): { field: Field; direction: 'asc' | 'desc' } {
  return sort.startsWith('-')
    ? { field: sort.slice(1) as Field, direction: 'desc' }
    : { field: sort as Field, direction: 'asc' };
}
