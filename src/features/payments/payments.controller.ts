// Traduction HTTP des paiements.
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnauthorizedError } from '../../core/errors/AppError.js';
import { successBody } from '../../core/http/apiResponse.js';
import { API_PREFIX } from '../../core/http/paths.js';
import type { IdParam } from '../../core/validation/common.schemas.js';
import type { Viewer } from '../auth/auth.service.js';
import type {
  ListPaymentsQuery,
  RecordPaymentBody,
  ReversePaymentBody,
} from './payments.schemas.js';
import { paymentsService } from './payments.service.js';

function viewerOf(req: Request): Viewer {
  if (!req.auth) throw new UnauthorizedError();
  return { userId: req.auth.userId, role: req.auth.role, agencyId: req.auth.agencyId };
}

/** GET /payments?search=&method=&client_id=&from=AAAA-MM-JJ&to=AAAA-MM-JJ&sort=-created_at */
export async function listPayments(_req: Request, res: Response) {
  const { items, meta } = await paymentsService.list(res.locals['query'] as ListPaymentsQuery);
  res.status(StatusCodes.OK).json(successBody(items, meta));
}

/** GET /payments/:id */
export async function getPayment(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  res.status(StatusCodes.OK).json(successBody(await paymentsService.detail(id)));
}

/** POST /payments : encaissement réparti sur un ou plusieurs colis. */
export async function recordPayment(req: Request, res: Response) {
  const payment = await paymentsService.record(viewerOf(req), req.body as RecordPaymentBody);
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/payments/${payment.id}`)
    .json(successBody(payment));
}

/** POST /payments/:id/reversal : écriture d'annulation. */
export async function reversePayment(req: Request, res: Response) {
  const { id } = req.params as IdParam;
  const reversal = await paymentsService.reverse(viewerOf(req), id, req.body as ReversePaymentBody);
  res
    .status(StatusCodes.CREATED)
    .location(`${API_PREFIX}/payments/${reversal.id}`)
    .json(successBody(reversal));
}
