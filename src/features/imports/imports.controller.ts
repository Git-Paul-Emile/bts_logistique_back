// Traduction HTTP de l'historique des imports Excel.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successBody } from '../../core/http/apiResponse.js';
import { clock } from '../../lib/clock.js';
import type { AddFingerprintsBody, FingerprintsQuery } from './imports.schemas.js';
import { importsRepository } from './imports.repository.js';

/** GET /import-fingerprints?entity=payments : empreintes des lignes déjà importées. */
export async function listFingerprints(_req: Request, res: Response) {
  const { entity } = res.locals['query'] as FingerprintsQuery;
  const fingerprints = await importsRepository.fingerprints(entity);
  res.status(StatusCodes.OK).json(successBody(fingerprints));
}

/** POST /import-fingerprints : enregistre les empreintes des lignes qui viennent d'être importées. */
export async function addFingerprints(req: Request, res: Response) {
  const { entity, fingerprints } = req.body as AddFingerprintsBody;
  await importsRepository.addFingerprints(entity, fingerprints, clock.now());
  res.status(StatusCodes.NO_CONTENT).end();
}
