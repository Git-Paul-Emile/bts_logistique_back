// Paiement tel qu'il est renvoyé au front (type Payment de front/src/types/index.ts),
// avec sa répartition sur les colis.
import type { PaymentMethod } from '../../generated/prisma/enums.js';
import type { PaymentRecord } from './payments.repository.js';

export interface PaymentDto {
  id: string;
  client: { id: string; name: string };
  /** Négatif sur une écriture d'annulation. */
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  author: { id: string; name: string };
  allocations: { package_id: string; tracking_number: string; amount: number }[];
  /** Sur une annulation : le paiement annulé. */
  reverses_payment_id: string | null;
  /** Sur un paiement annulé : l'écriture qui l'annule. */
  reversed_by_payment_id: string | null;
  created_at: string;
}

export function toPaymentDto(payment: PaymentRecord): PaymentDto {
  return {
    id: payment.id,
    client: payment.client,
    amount: payment.amount.toNumber(),
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    author: payment.author,
    allocations: payment.allocations.map((part) => ({
      package_id: part.package.id,
      tracking_number: part.package.trackingNumber,
      amount: part.amount.toNumber(),
    })),
    reverses_payment_id: payment.reversesPaymentId,
    reversed_by_payment_id: payment.reversedBy?.id ?? null,
    created_at: payment.createdAt.toISOString(),
  };
}
