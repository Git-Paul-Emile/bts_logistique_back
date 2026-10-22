// Format unique des réponses de l'API. Le front peut toujours lire `success` pour savoir
// s'il a reçu des données ou une erreur, et le code HTTP porte aussi le résultat.

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function successBody<T>(data: T, meta?: PaginationMeta): SuccessBody<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}
