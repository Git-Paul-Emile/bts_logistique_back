import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { validate } from '../../core/middlewares/validate.js';
import { idParamSchema } from '../../core/validation/common.schemas.js';
import { authenticate, requireCsrf, requireRole } from '../auth/auth.middleware.js';
import { getPayment, listPayments, recordPayment, reversePayment } from './payments.controller.js';
import {
  listPaymentsQuerySchema,
  recordPaymentBodySchema,
  reversePaymentBodySchema,
} from './payments.schemas.js';

/**
 * Routes /payments, réservées à l'équipe (administrateur, gestionnaire). Aucune route ne
 * modifie ni ne supprime un paiement : on encaisse, on consulte, on annule par contrepassation.
 */
export function createPaymentsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireCsrf, requireRole('admin', 'manager'));

  router.get('/', validate({ query: listPaymentsQuerySchema }), asyncHandler(listPayments));
  router.post('/', validate({ body: recordPaymentBodySchema }), asyncHandler(recordPayment));
  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(getPayment));
  router.post(
    '/:id/reversal',
    validate({ params: idParamSchema, body: reversePaymentBodySchema }),
    asyncHandler(reversePayment)
  );

  return router;
}
