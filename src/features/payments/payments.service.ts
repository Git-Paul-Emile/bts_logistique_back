// Règles métier des paiements (F8). Un versement règle un ou plusieurs colis du même client.
// Un paiement n'est jamais modifié : une erreur se corrige par une écriture d'annulation.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta, parseSort } from '../../core/http/pagination.js';
import { clock } from '../../lib/clock.js';
import type { Viewer } from '../auth/auth.service.js';
import { computePaymentStatus } from '../packages/packagePricing.js';
import { toPaymentDto, type PaymentDto } from './payments.dto.js';
import {
  AlreadyReversedError,
  CancelledPackageError,
  CannotReverseReversalError,
  ExceedsRemainingError,
  PackageNotOfClientError,
  PaymentNotFoundError,
} from './payments.errors.js';
import { paymentsRepository, type PaymentsQueries } from './payments.repository.js';
import type {
  ListPaymentsQuery,
  PaymentSortField,
  RecordPaymentBody,
  ReversePaymentBody,
} from './payments.schemas.js';

const SORT_COLUMNS = { created_at: 'createdAt', amount: 'amount' } as const;
const MS_PER_DAY = 86_400_000;

const formatAmount = (amount: number) => `${amount.toLocaleString('fr-FR')} F CFA`;

async function detailOf(queries: PaymentsQueries, id: string): Promise<PaymentDto> {
  const payment = await queries.findDetail(id);
  if (!payment) throw new PaymentNotFoundError();
  return toPaymentDto(payment);
}

/**
 * Vérifie chaque part : colis du client, non annulé, et part au plus égale à son reste à
 * payer. Renvoie le nouvel état de paiement de chaque colis.
 */
async function checkAllocations(queries: PaymentsQueries, input: RecordPaymentBody) {
  const packages = await queries.findPackages(input.allocations.map((part) => part.package_id));
  return input.allocations.map((part) => {
    const pkg = packages.find((candidate) => candidate.id === part.package_id);
    if (!pkg || pkg.clientId !== input.client_id)
      throw new PackageNotOfClientError(part.package_id);
    if (pkg.status === 'cancelled') throw new CancelledPackageError(pkg.trackingNumber);
    const finalPrice = pkg.finalPrice.toNumber();
    const alreadyPaid = pkg.amountPaid.toNumber();
    const remaining = finalPrice - alreadyPaid;
    if (part.amount > remaining) throw new ExceedsRemainingError(pkg.trackingNumber, remaining);
    const amountPaid = alreadyPaid + part.amount;
    return {
      packageId: pkg.id,
      amount: part.amount,
      amountPaid,
      paymentStatus: computePaymentStatus(amountPaid, finalPrice),
    };
  });
}

/** Retire des colis les parts annulées, et recalcule leur statut de paiement. */
async function applyReversal(
  queries: PaymentsQueries,
  parts: { packageId: string; amount: number }[]
): Promise<void> {
  const packages = await queries.findPackages(parts.map((part) => part.packageId));
  for (const pkg of packages) {
    const refund = parts.find((part) => part.packageId === pkg.id)?.amount ?? 0;
    const amountPaid = pkg.amountPaid.toNumber() + refund;
    await queries.setPackagePayment(
      pkg.id,
      amountPaid,
      computePaymentStatus(amountPaid, pkg.finalPrice.toNumber())
    );
  }
}

export const paymentsService = {
  async list(query: ListPaymentsQuery): Promise<{ items: PaymentDto[]; meta: PaginationMeta }> {
    const sort = parseSort<PaymentSortField>(query.sort);
    const { items, total } = await paymentsRepository.list({
      clientId: query.client_id,
      method: query.method,
      search: query.search,
      createdFrom: query.from ? new Date(query.from) : undefined,
      // « to » est inclus : on prend tout ce qui précède le lendemain.
      createdBefore: query.to ? new Date(new Date(query.to).getTime() + MS_PER_DAY) : undefined,
      orderBy: { field: SORT_COLUMNS[sort.field], direction: sort.direction },
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return { items: items.map(toPaymentDto), meta: paginationMeta(query.page, query.limit, total) };
  },

  detail(id: string): Promise<PaymentDto> {
    return detailOf(paymentsRepository, id);
  },

  /** Encaisse un versement et le répartit sur les colis, en une seule transaction. */
  async record(viewer: Viewer, input: RecordPaymentBody): Promise<PaymentDto> {
    return paymentsRepository.inTransaction(async (queries) => {
      const parts = await checkAllocations(queries, input);
      const id = await queries.create(
        {
          clientId: input.client_id,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          authorId: viewer.userId,
          reversesPaymentId: null,
          createdAt: clock.now(),
        },
        parts
      );
      for (const part of parts) {
        await queries.setPackagePayment(part.packageId, part.amountPaid, part.paymentStatus);
      }
      await queries.addNotification(
        'Paiement reçu',
        `${formatAmount(input.amount)}, réparti sur ${parts.length} colis.`
      );
      await queries.audit({
        actorId: viewer.userId,
        action: 'payment.record',
        resourceType: 'payment',
        resourceId: id,
        after: {
          client_id: input.client_id,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          allocations: parts.map((part) => ({ package_id: part.packageId, amount: part.amount })),
        },
      });
      return detailOf(queries, id);
    });
  },

  /**
   * Annule un paiement par une écriture inverse : même répartition, montants négatifs. Le
   * paiement d'origine reste en base, et un paiement ne s'annule qu'une seule fois.
   */
  async reverse(viewer: Viewer, id: string, input: ReversePaymentBody): Promise<PaymentDto> {
    return paymentsRepository.inTransaction(async (queries) => {
      const original = await queries.findForReversal(id);
      if (!original) throw new PaymentNotFoundError();
      if (original.reversesPaymentId) throw new CannotReverseReversalError();
      if (original.reversedBy) throw new AlreadyReversedError();

      const parts = original.allocations.map((part) => ({
        packageId: part.packageId,
        amount: -part.amount.toNumber(),
      }));
      const reversalId = await queries.create(
        {
          clientId: original.clientId,
          amount: -original.amount.toNumber(),
          method: original.method,
          reference: original.reference,
          notes: input.reason,
          authorId: viewer.userId,
          reversesPaymentId: original.id,
          createdAt: clock.now(),
        },
        parts
      );
      await applyReversal(queries, parts);
      await queries.addNotification(
        'Paiement annulé',
        `${formatAmount(original.amount.toNumber())} annulés : ${input.reason}`
      );
      await queries.audit({
        actorId: viewer.userId,
        action: 'payment.reverse',
        resourceType: 'payment',
        resourceId: original.id,
        before: { amount: original.amount.toNumber(), reversed_by: null },
        after: { reversed_by: reversalId, reason: input.reason },
      });
      return detailOf(queries, reversalId);
    });
  },
};
