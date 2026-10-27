// Client tel qu'il est renvoyé au front (type Client de front/src/types/index.ts).
// Deux vues : l'équipe (administrateur, gestionnaire) voit les montants ; un collecteur ne voit
// que ce qu'il faut pour enregistrer un colis, sans aucune donnée financière.
import type { PackageStatus, PaymentMethod, PaymentStatus } from '../../generated/prisma/enums.js';
import type {
  ClientBalanceRecord,
  ClientPackageRecord,
  ClientPaymentRecord,
} from './clients.repository.js';

export interface ClientContactDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  agency: { code: string; name: string };
  created_at: string;
}

export interface ClientDto extends ClientContactDto {
  total_billed: number;
  amount_paid: number;
  /** Reste à payer. Négatif quand le client a versé une avance. */
  balance: number;
  /** Vrai quand le reste à payer est positif : le front affiche le client en rouge. */
  has_debt: boolean;
  package_count: number;
}

export function toClientContactDto(client: ClientBalanceRecord): ClientContactDto {
  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    email: client.email,
    address: client.address,
    agency: { code: client.agencyCode, name: client.agencyName },
    created_at: client.createdAt.toISOString(),
  };
}

export function toClientDto(client: ClientBalanceRecord): ClientDto {
  const balance = client.totalBilled - client.totalPaid;
  return {
    ...toClientContactDto(client),
    total_billed: client.totalBilled,
    amount_paid: client.totalPaid,
    balance,
    has_debt: balance > 0,
    package_count: client.packageCount,
  };
}

export interface ClientPackageDto {
  id: string;
  tracking_number: string;
  status: PackageStatus;
  payment_status: PaymentStatus;
  final_price: number;
  amount_paid: number;
  origin: { code: string; name: string };
  destination: { code: string; name: string };
  created_at: string;
}

export interface ClientPaymentDto {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  /** Renseigné sur une écriture d'annulation : le paiement qu'elle annule. */
  reverses_payment_id: string | null;
  allocations: { package_id: string; tracking_number: string; amount: number }[];
  created_at: string;
}

export interface ClientDetailDto {
  client: ClientDto;
  recent_packages: ClientPackageDto[];
  recent_payments: ClientPaymentDto[];
}

export function toClientPackageDto(pkg: ClientPackageRecord): ClientPackageDto {
  return {
    id: pkg.id,
    tracking_number: pkg.trackingNumber,
    status: pkg.status,
    payment_status: pkg.paymentStatus,
    final_price: pkg.finalPrice.toNumber(),
    amount_paid: pkg.amountPaid.toNumber(),
    origin: pkg.origin,
    destination: pkg.destination,
    created_at: pkg.createdAt.toISOString(),
  };
}

export function toClientPaymentDto(payment: ClientPaymentRecord): ClientPaymentDto {
  return {
    id: payment.id,
    amount: payment.amount.toNumber(),
    method: payment.method,
    reference: payment.reference,
    reverses_payment_id: payment.reversesPaymentId,
    allocations: payment.allocations.map((allocation) => ({
      package_id: allocation.package.id,
      tracking_number: allocation.package.trackingNumber,
      amount: allocation.amount.toNumber(),
    })),
    created_at: payment.createdAt.toISOString(),
  };
}
