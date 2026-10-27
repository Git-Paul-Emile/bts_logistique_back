// Accès base de données des conteneurs et lots (F9). Le volume chargé n'est pas stocké :
// c'est la somme des volumes des colis affectés, calculée à la lecture.
import { prisma } from '../../lib/prisma.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ShipmentStatus, TransportMode } from '../../generated/prisma/enums.js';

const placeSelect = { select: { code: true, name: true } } as const;

const shipmentSelect = {
  id: true,
  containerNumber: true,
  transportMode: true,
  carrier: true,
  status: true,
  maxVolumeCbm: true,
  departureDate: true,
  estimatedArrival: true,
  actualArrival: true,
  notes: true,
  createdAt: true,
  origin: placeSelect,
  destination: placeSelect,
} satisfies Prisma.ShipmentSelect;

export type ShipmentRecord = Prisma.ShipmentGetPayload<{ select: typeof shipmentSelect }>;

export interface ShipmentLoad {
  volumeCbm: number;
  packageCount: number;
}

export interface NewShipment {
  containerNumber: string;
  transportMode: TransportMode;
  carrier: string;
  originId: string;
  destinationId: string;
  maxVolumeCbm: number;
  departureDate: Date | null;
  estimatedArrival: Date | null;
  notes: string | null;
}

export interface ShipmentChanges {
  carrier?: string;
  maxVolumeCbm?: number;
  departureDate?: Date | null;
  estimatedArrival?: Date | null;
  actualArrival?: Date | null;
  notes?: string | null;
  status?: ShipmentStatus;
}

export interface ShipmentListFilters {
  status?: ShipmentStatus;
  transportMode?: TransportMode;
  search?: string;
  orderBy: { field: 'createdAt' | 'departureDate'; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
}

type Database = PrismaClient | Prisma.TransactionClient;

const EMPTY_LOAD: ShipmentLoad = { volumeCbm: 0, packageCount: 0 };

function shipmentsQueries(db: Database) {
  return {
    findById(id: string): Promise<ShipmentRecord | null> {
      return db.shipment.findUnique({ where: { id }, select: shipmentSelect });
    },

    /** Volume et nombre de colis de plusieurs conteneurs, en une seule requête groupée. */
    async loads(shipmentIds: string[]): Promise<Map<string, ShipmentLoad>> {
      const groups = await db.package.groupBy({
        by: ['shipmentId'],
        where: { shipmentId: { in: shipmentIds } },
        _sum: { cubicMeter: true },
        _count: { _all: true },
      });
      return new Map(
        groups.map((group) => [
          group.shipmentId ?? '',
          {
            volumeCbm: group._sum.cubicMeter?.toNumber() ?? 0,
            packageCount: group._count._all,
          },
        ])
      );
    },

    async loadOf(shipmentId: string): Promise<ShipmentLoad> {
      const loads = await shipmentsQueries(db).loads([shipmentId]);
      return loads.get(shipmentId) ?? EMPTY_LOAD;
    },

    /** Colis chargés dans le conteneur. */
    packagesOf(shipmentId: string) {
      return db.package.findMany({
        where: { shipmentId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          cubicMeter: true,
          client: { select: { name: true } },
        },
      });
    },

    /** Colis candidats au chargement, avec ce qu'il faut pour vérifier qu'ils conviennent. */
    findPackages(ids: string[]) {
      return db.package.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          trackingNumber: true,
          shipmentId: true,
          transportMode: true,
          destinationId: true,
          status: true,
          cubicMeter: true,
        },
      });
    },

    findShipmentRoute(id: string) {
      return db.shipment.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          transportMode: true,
          destinationId: true,
          maxVolumeCbm: true,
        },
      });
    },

    findLocation(code: string) {
      return db.location.findUnique({
        where: { code },
        select: { id: true, isOrigin: true, isDestination: true, active: true },
      });
    },

    async isContainerNumberTaken(containerNumber: string): Promise<boolean> {
      return (await db.shipment.count({ where: { containerNumber } })) > 0;
    },

    async create(shipment: NewShipment): Promise<string> {
      const created = await db.shipment.create({ data: shipment, select: { id: true } });
      return created.id;
    },

    async update(id: string, changes: ShipmentChanges): Promise<void> {
      await db.shipment.update({ where: { id }, data: changes, select: { id: true } });
    },

    async assign(shipmentId: string, packageIds: string[]): Promise<void> {
      await db.package.updateMany({ where: { id: { in: packageIds } }, data: { shipmentId } });
    },

    /** Retire un colis du conteneur. Renvoie false s'il n'y était pas. */
    async unassign(shipmentId: string, packageId: string): Promise<boolean> {
      const { count } = await db.package.updateMany({
        where: { id: packageId, shipmentId },
        data: { shipmentId: null },
      });
      return count > 0;
    },
  };
}

export type ShipmentsQueries = ReturnType<typeof shipmentsQueries>;

export const shipmentsRepository = {
  ...shipmentsQueries(prisma),

  async list(filters: ShipmentListFilters): Promise<{ items: ShipmentRecord[]; total: number }> {
    const where: Prisma.ShipmentWhereInput = {
      status: filters.status,
      transportMode: filters.transportMode,
      ...(filters.search && {
        OR: [
          { containerNumber: { contains: filters.search, mode: 'insensitive' } },
          { carrier: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        select: shipmentSelect,
        orderBy: [{ [filters.orderBy.field]: filters.orderBy.direction }, { id: 'desc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.shipment.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Transaction sérialisable : deux chargements simultanés dans le même conteneur ne peuvent
   * pas dépasser sa capacité, ni mettre un même colis dans deux conteneurs.
   */
  inTransaction<T>(work: (queries: ShipmentsQueries) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => work(shipmentsQueries(tx)), {
      isolationLevel: 'Serializable',
    });
  },
};
