import { z } from 'zod';

/** Listes importables depuis Excel. */
export const IMPORT_ENTITIES = ['clients', 'shipments', 'packages', 'payments', 'users'] as const;

const MAX_FINGERPRINT_LENGTH = 512;
const MAX_FINGERPRINTS_PER_REQUEST = 2000;

export const fingerprintsQuerySchema = z.object({ entity: z.enum(IMPORT_ENTITIES) });

export const addFingerprintsBodySchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  fingerprints: z
    .array(z.string().min(1).max(MAX_FINGERPRINT_LENGTH))
    .max(MAX_FINGERPRINTS_PER_REQUEST),
});

export type FingerprintsQuery = z.infer<typeof fingerprintsQuerySchema>;
export type AddFingerprintsBody = z.infer<typeof addFingerprintsBodySchema>;
