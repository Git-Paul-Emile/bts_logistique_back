// Accès base de données des clients (F5).
// Le solde n'est stocké nulle part : il est calculé par PostgreSQL à chaque lecture, à partir
// des colis (facturé) et des paiements (encaissé). Une seule définition, `clientBalancesSql`,
// sert à la liste, au comptage et à la fiche : il n'existe donc qu'une façon de calculer un solde.
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface ClientBalanceRecord {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  agencyCode: string;
  agencyName: string;
  agencyId: string;
  createdAt: Date;
  totalBilled: number;
  totalPaid: number;
  packageCount: number;
}

interface ClientBalanceRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  agency_id: string;
  agency_code: string;
  agency_name: string;
  created_at: Date;
  total_billed: Prisma.Decimal;
  total_paid: Prisma.Decimal;
  package_count: bigint;
}

export type ClientSortColumn = 'name' | 'created_at' | 'balance';

export interface ClientListFilters {
  /** Limite aux clients d'une agence (collecteur). Absent : toutes les agences. */
  agencyId?: string;
  search?: string;
  hasDebt?: boolean;
  orderBy: { column: ClientSortColumn; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
}

export interface NewClient {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  agencyId: string;
}

export type ClientChanges = Partial<NewClient>;

export type ClientPackageRecord = Awaited<
  ReturnType<typeof clientsRepository.recentPackages>
>[number];
export type ClientPaymentRecord = Awaited<
  ReturnType<typeof clientsRepository.recentPayments>
>[number];

/**
 * Clients avec leurs totaux. Un colis annulé n'est pas facturé ; les paiements comptent tous,
 * annulations (montants négatifs) et avances non réparties comprises.
 */
export function clientBalancesSql(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT c.id, c.name, c.phone, c.email, c.address, c.created_at,
           a.id AS agency_id, a.code AS agency_code, a.name AS agency_name,
           COALESCE(billed.total, 0) AS total_billed,
           COALESCE(paid.total, 0) AS total_paid,
           COALESCE(billed.package_count, 0) AS package_count,
           COALESCE(billed.total, 0) - COALESCE(paid.total, 0) AS balance
    FROM clients c
    JOIN agencies a ON a.id = c.agency_id
    LEFT JOIN LATERAL (
      SELECT SUM(p.final_price) FILTER (WHERE p.status <> 'cancelled') AS total,
             COUNT(*) AS package_count
      FROM packages p
      WHERE p.client_id = c.id
    ) billed ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pay.amount) AS total FROM payments pay WHERE pay.client_id = c.id
    ) paid ON TRUE
    WHERE ${where}`;
}

/** Échappe % et _ : le texte cherché est pris tel quel, pas comme un motif. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function listConditions(filters: ClientListFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filters.agencyId) conditions.push(Prisma.sql`c.agency_id = ${filters.agencyId}::uuid`);
  if (filters.search) {
    const pattern = likePattern(filters.search);
    const digits = filters.search.replace(/\D/g, '');
    // Le téléphone est comparé chiffres seuls : « 07 00 » trouve « +225 07 00 00 00 ».
    const phoneMatch = digits
      ? Prisma.sql`OR regexp_replace(c.phone, '[^0-9]', '', 'g') LIKE ${likePattern(digits)}`
      : Prisma.empty;
    conditions.push(
      Prisma.sql`(c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} ${phoneMatch})`
    );
  }
  return Prisma.join(conditions, ' AND ');
}

/** Colonnes de tri : liste fermée, jamais construite à partir de la requête. */
const ORDER_BY: Record<ClientSortColumn, Record<'asc' | 'desc', Prisma.Sql>> = {
  name: { asc: Prisma.sql`name ASC`, desc: Prisma.sql`name DESC` },
  created_at: { asc: Prisma.sql`created_at ASC`, desc: Prisma.sql`created_at DESC` },
  balance: { asc: Prisma.sql`balance ASC`, desc: Prisma.sql`balance DESC` },
};

function toRecord(row: ClientBalanceRow): ClientBalanceRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    agencyId: row.agency_id,
    agencyCode: row.agency_code,
    agencyName: row.agency_name,
    createdAt: row.created_at,
    totalBilled: Number(row.total_billed),
    totalPaid: Number(row.total_paid),
    packageCount: Number(row.package_count),
  };
}

export const clientsRepository = {
  async list(filters: ClientListFilters): Promise<{ items: ClientBalanceRecord[]; total: number }> {
    const balances = clientBalancesSql(listConditions(filters));
    const debtFilter = filters.hasDebt ? Prisma.sql`WHERE balance > 0` : Prisma.empty;
    const order = ORDER_BY[filters.orderBy.column][filters.orderBy.direction];
    const [rows, counts] = await Promise.all([
      prisma.$queryRaw<ClientBalanceRow[]>`
        SELECT * FROM (${balances}) AS b ${debtFilter}
        ORDER BY ${order}, id ASC
        LIMIT ${filters.take} OFFSET ${filters.skip}`,
      prisma.$queryRaw<[{ total: bigint }]>`
        SELECT COUNT(*) AS total FROM (${balances}) AS b ${debtFilter}`,
    ]);
    return { items: rows.map(toRecord), total: Number(counts[0].total) };
  },

  async findWithBalance(id: string): Promise<ClientBalanceRecord | null> {
    const rows = await prisma.$queryRaw<ClientBalanceRow[]>`
      ${clientBalancesSql(Prisma.sql`c.id = ${id}::uuid`)}`;
    const row = rows[0];
    return row ? toRecord(row) : null;
  },

  /** Derniers colis du client, du plus récent au plus ancien. */
  recentPackages(clientId: string, take: number) {
    return prisma.package.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        paymentStatus: true,
        finalPrice: true,
        amountPaid: true,
        createdAt: true,
        origin: { select: { code: true, name: true } },
        destination: { select: { code: true, name: true } },
      },
    });
  },

  /** Derniers paiements du client, avec leur répartition sur les colis. */
  recentPayments(clientId: string, take: number) {
    return prisma.payment.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        reversesPaymentId: true,
        createdAt: true,
        allocations: {
          select: { amount: true, package: { select: { id: true, trackingNumber: true } } },
        },
      },
    });
  },

  findAgencyIdByCode(code: string): Promise<{ id: string } | null> {
    return prisma.agency.findUnique({ where: { code }, select: { id: true } });
  },

  async create(client: NewClient): Promise<string> {
    const created = await prisma.client.create({ data: client, select: { id: true } });
    return created.id;
  },

  async update(id: string, changes: ClientChanges): Promise<void> {
    await prisma.client.update({ where: { id }, data: changes, select: { id: true } });
  },
};
