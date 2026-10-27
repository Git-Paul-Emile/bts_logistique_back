// Règles métier des colis (F6). Le serveur fait foi : numéro de suivi, volume, prix et marge
// sont calculés ici. Un collecteur ne voit et ne modifie que les colis de son agence.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta, parseSort } from '../../core/http/pagination.js';
import type { PackageStatus } from '../../generated/prisma/enums.js';
import { env } from '../../config/env.js';
import type { EmailMessage } from '../../infrastructure/email/emailMessages.js';
import { clock } from '../../lib/clock.js';
import type { Viewer } from '../auth/auth.service.js';
import { ClientNotFoundError } from '../clients/clients.errors.js';
import { pricingService } from '../pricing/pricing.service.js';
import { UnknownAgencyError } from '../users/users.errors.js';
import { computePackagePrice, computePaymentStatus } from './packagePricing.js';
import { canMoveTo, isClosed } from './packageStatus.js';
import {
  toPackageDetailDto,
  toPackageDto,
  type PackageDetailDto,
  type PackageDto,
} from './packages.dto.js';
import {
  ClientHasNoEmailError,
  InvalidStatusTransitionError,
  PackageClosedError,
  PackageNotFoundError,
  PaymentExceedsPriceError,
  PriceBelowPaidError,
  RateBelowMarginError,
  RateOverrideForbiddenError,
  SameRouteError,
  UnknownLocationError,
} from './packages.errors.js';
import {
  packagesRepository,
  type NewNotification,
  type PackagesQueries,
  type PackageStateRecord,
} from './packages.repository.js';
import type {
  CreatePackageBody,
  ListPackagesQuery,
  PackageEventBody,
  PackageSortField,
  UpdatePackageBody,
} from './packages.schemas.js';
import { trackingNumbers } from './trackingNumber.js';

const TRACKING_PATH = '/suivi';

const SORT_COLUMNS = {
  created_at: 'createdAt',
  final_price: 'finalPrice',
  tracking_number: 'trackingNumber',
} as const;

/** Libellés des notifications du personnel (mêmes termes que l'interface). */
const STATUS_LABELS: Record<PackageStatus, string> = {
  registered: 'Enregistré',
  in_transit: 'En transit',
  arrived: 'Arrivé à destination',
  delivered: 'Livré au client',
  returned: 'Retourné',
  on_hold: 'En attente douane',
  cancelled: 'Annulé',
};

const isCollector = (viewer: Viewer) => viewer.role === 'collector';

function canSee(viewer: Viewer, pkg: { agencyId: string }): boolean {
  return !isCollector(viewer) || pkg.agencyId === viewer.agencyId;
}

/** Lieu du réseau, actif, et autorisé pour ce rôle (départ ou arrivée). */
async function placeOf(queries: PackagesQueries, code: string, role: 'origin' | 'destination') {
  const location = await queries.findLocation(code);
  const allowed = role === 'origin' ? location?.isOrigin : location?.isDestination;
  if (!location?.active || !allowed) throw new UnknownLocationError(code);
  return location;
}

async function visibleState(
  queries: PackagesQueries,
  viewer: Viewer,
  id: string
): Promise<PackageStateRecord> {
  const state = await queries.findState(id);
  if (!state || !canSee(viewer, state)) throw new PackageNotFoundError();
  return state;
}

async function detailFor(viewer: Viewer, id: string): Promise<PackageDetailDto> {
  const pkg = await packagesRepository.findDetail(id);
  if (!pkg || !canSee(viewer, pkg)) throw new PackageNotFoundError();
  return toPackageDetailDto(pkg);
}

async function agencyIdOf(code: string): Promise<string> {
  const agency = await packagesRepository.findAgencyIdByCode(code);
  if (!agency) throw new UnknownAgencyError();
  return agency.id;
}

/** Agence d'enregistrement : la sienne pour un collecteur, au choix pour l'équipe. */
async function registeringAgency(viewer: Viewer, agencyCode?: string): Promise<string> {
  return isCollector(viewer) || !agencyCode ? viewer.agencyId : agencyIdOf(agencyCode);
}

/** Agences visibles dans la liste : la sienne pour un collecteur, toutes ou une au choix sinon. */
async function listedAgency(viewer: Viewer, agencyCode?: string): Promise<string | undefined> {
  if (isCollector(viewer)) return viewer.agencyId;
  return agencyCode ? agencyIdOf(agencyCode) : undefined;
}

/**
 * Prix d'un nouveau colis selon la grille en vigueur, ou le tarif personnalisé de l'équipe.
 * La marge suit toujours la grille : elle est figée sur le colis.
 */
async function priceNewPackage(input: CreatePackageBody) {
  const gridRate = await pricingService.currentRate(input.transport_mode);
  const ratePerCbm = input.rate_per_cbm ?? gridRate.clientRatePerCbm;
  const dimensions = {
    lengthCm: input.length_cm,
    widthCm: input.width_cm,
    heightCm: input.height_cm,
  };
  const price = computePackagePrice(dimensions, ratePerCbm, gridRate.collectorMarginPerCbm);
  if (price.finalPrice < price.collectorMargin) throw new RateBelowMarginError();
  const amountPaid = input.initial_payment?.amount ?? 0;
  if (amountPaid > price.finalPrice) throw new PaymentExceedsPriceError();
  return {
    ...dimensions,
    ...price,
    ratePerCbm,
    collectorMarginPerCbm: gridRate.collectorMarginPerCbm,
    amountPaid,
    paymentStatus: computePaymentStatus(amountPaid, price.finalPrice),
  };
}

/** Lien vers la page publique de suivi du colis (front : /suivi/:numero). */
function trackingUrlOf(trackingNumber: string): string {
  return new URL(
    `${TRACKING_PATH}/${encodeURIComponent(trackingNumber)}`,
    env.FRONT_URL
  ).toString();
}

function statusEmail(
  client: { name: string; email: string },
  trackingNumber: string,
  statusLabel: string,
  location: string
): EmailMessage {
  return {
    kind: 'package_status',
    to: client.email,
    data: {
      recipientName: client.name,
      trackingNumber,
      trackingUrl: trackingUrlOf(trackingNumber),
      statusLabel,
      location,
    },
  };
}

/** E-mail au client avec son numéro de suivi, s'il a une adresse. */
function registrationEmail(
  client: { name: string; email: string | null },
  origin: string,
  destination: string
): ((trackingNumber: string) => EmailMessage) | null {
  const address = client.email;
  if (!address) return null;
  return (trackingNumber) => ({
    kind: 'package_registered',
    to: address,
    data: {
      recipientName: client.name,
      trackingNumber,
      trackingUrl: trackingUrlOf(trackingNumber),
      origin,
      destination,
    },
  });
}

/**
 * Notifications d'un changement de statut : pour le personnel, et, si demandé, l'e-mail au
 * client (noté « non envoyé » quand le client n'a pas d'adresse).
 */
async function notifyStatusChange(
  queries: PackagesQueries,
  packageId: string,
  state: PackageStateRecord,
  input: PackageEventBody
): Promise<void> {
  const message = `${state.trackingNumber} : ${STATUS_LABELS[input.status]}.`;
  await queries.addNotifications(packageId, [
    { category: 'package', title: 'Statut mis à jour', message },
  ]);
  if (!input.notify_client) return;
  const address = state.client.email;
  await queries.addEmailNotification(
    packageId,
    {
      category: 'email',
      title: 'E-mail de suivi au client',
      message,
      deliveryStatus: address ? 'queued' : 'skipped',
    },
    address
      ? statusEmail(
          { name: state.client.name, email: address },
          state.trackingNumber,
          STATUS_LABELS[input.status],
          input.location
        )
      : null
  );
}

function registrationNotifications(input: CreatePackageBody, finalPrice: number) {
  return (trackingNumber: string): NewNotification[] => [
    {
      category: 'package',
      title: 'Colis enregistré',
      message: `${trackingNumber} enregistré, ${finalPrice.toLocaleString('fr-FR')} F CFA.`,
    },
    ...(input.initial_payment
      ? [
          {
            category: 'payment' as const,
            title: 'Paiement reçu',
            message: `${input.initial_payment.amount.toLocaleString('fr-FR')} F CFA pour ${trackingNumber}.`,
          },
        ]
      : []),
  ];
}

/** Itinéraire après correction : lieux changés vérifiés, origine et destination distinctes. */
async function resolveRoute(
  queries: PackagesQueries,
  state: PackageStateRecord,
  input: UpdatePackageBody
): Promise<{ originId: string; destinationId: string }> {
  const originId = input.origin_code
    ? (await placeOf(queries, input.origin_code, 'origin')).id
    : state.originId;
  const destinationId = input.destination_code
    ? (await placeOf(queries, input.destination_code, 'destination')).id
    : state.destinationId;
  if (originId === destinationId) throw new SameRouteError();
  return { originId, destinationId };
}

/**
 * Nouvel état d'un colis corrigé : volume, prix, marge (au taux figé) et statut de paiement
 * recalculés. Le prix ne descend ni sous la marge, ni sous le montant déjà encaissé.
 */
async function correctedPackage(
  queries: PackagesQueries,
  state: PackageStateRecord,
  input: UpdatePackageBody
) {
  const { originId, destinationId } = await resolveRoute(queries, state, input);
  const dimensions = {
    lengthCm: input.length_cm ?? state.lengthCm.toNumber(),
    widthCm: input.width_cm ?? state.widthCm.toNumber(),
    heightCm: input.height_cm ?? state.heightCm.toNumber(),
  };
  const ratePerCbm = input.rate_per_cbm ?? state.ratePerCbm.toNumber();
  const price = computePackagePrice(dimensions, ratePerCbm, state.collectorMarginPerCbm.toNumber());
  if (price.finalPrice < price.collectorMargin) throw new RateBelowMarginError();
  const amountPaid = state.amountPaid.toNumber();
  if (price.finalPrice < amountPaid) throw new PriceBelowPaidError();
  return {
    description: input.description,
    originId,
    destinationId,
    ...dimensions,
    weightKg: input.weight_kg,
    ...price,
    ratePerCbm,
    paymentStatus: computePaymentStatus(amountPaid, price.finalPrice),
  };
}

/** Ce qui se corrige sur un colis, tel qu'il est noté dans le journal d'audit. */
function snapshotOf(state: PackageStateRecord) {
  return {
    description: state.description,
    origin_id: state.originId,
    destination_id: state.destinationId,
    length_cm: state.lengthCm.toNumber(),
    width_cm: state.widthCm.toNumber(),
    height_cm: state.heightCm.toNumber(),
    weight_kg: state.weightKg.toNumber(),
    rate_per_cbm: state.ratePerCbm.toNumber(),
    final_price: state.finalPrice.toNumber(),
  };
}

type PackageCorrection = Awaited<ReturnType<typeof correctedPackage>>;

/** État après correction : un champ absent de la demande garde sa valeur d'avant. */
function snapshotAfter(before: ReturnType<typeof snapshotOf>, changes: PackageCorrection) {
  return {
    description: changes.description === undefined ? before.description : changes.description,
    origin_id: changes.originId,
    destination_id: changes.destinationId,
    length_cm: changes.lengthCm,
    width_cm: changes.widthCm,
    height_cm: changes.heightCm,
    weight_kg: changes.weightKg ?? before.weight_kg,
    rate_per_cbm: changes.ratePerCbm,
    final_price: changes.finalPrice,
  };
}

export const packagesService = {
  async list(
    viewer: Viewer,
    query: ListPackagesQuery
  ): Promise<{ items: PackageDto[]; meta: PaginationMeta }> {
    const sort = parseSort<PackageSortField>(query.sort);
    const { items, total } = await packagesRepository.list({
      agencyId: await listedAgency(viewer, query.agency_code),
      clientId: query.client_id,
      status: query.status,
      paymentStatus: query.payment_status,
      transportMode: query.transport_mode,
      search: query.search,
      orderBy: { field: SORT_COLUMNS[sort.field], direction: sort.direction },
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return { items: items.map(toPackageDto), meta: paginationMeta(query.page, query.limit, total) };
  },

  detail: detailFor,

  /** Enregistrement d'un colis reçu en entrepôt, avec son paiement initial éventuel. */
  async register(viewer: Viewer, input: CreatePackageBody): Promise<PackageDetailDto> {
    if (input.rate_per_cbm !== undefined && isCollector(viewer)) {
      throw new RateOverrideForbiddenError();
    }
    const client = await packagesRepository.findClient(input.client_id);
    if (!client || !canSee(viewer, client)) throw new ClientNotFoundError();
    const origin = await placeOf(packagesRepository, input.origin_code, 'origin');
    const destination = await placeOf(packagesRepository, input.destination_code, 'destination');
    const priced = await priceNewPackage(input);
    const year = clock.now().getUTCFullYear();
    const id = await packagesRepository.register(
      {
        package: {
          clientId: client.id,
          agencyId: await registeringAgency(viewer, input.agency_code),
          collectorId: isCollector(viewer) ? viewer.userId : null,
          originId: origin.id,
          destinationId: destination.id,
          description: input.description ?? null,
          transportMode: input.transport_mode,
          weightKg: input.weight_kg,
          ...priced,
        },
        agentId: viewer.userId,
        initialPayment: input.initial_payment
          ? { ...input.initial_payment, reference: input.initial_payment.reference ?? null }
          : null,
        notifications: registrationNotifications(input, priced.finalPrice),
        clientEmail: registrationEmail(client, origin.name, destination.name),
      },
      () => trackingNumbers.next(destination.countryCode, year)
    );
    return detailFor(viewer, id);
  },

  /** Correction d'un colis : volume, prix, marge et statut de paiement sont recalculés. */
  async update(viewer: Viewer, id: string, input: UpdatePackageBody): Promise<PackageDetailDto> {
    if (input.rate_per_cbm !== undefined && isCollector(viewer)) {
      throw new RateOverrideForbiddenError();
    }
    await packagesRepository.inTransaction(async (queries) => {
      const state = await visibleState(queries, viewer, id);
      if (isClosed(state.status)) throw new PackageClosedError();
      const changes = await correctedPackage(queries, state, input);
      await queries.update(id, changes);
      const before = snapshotOf(state);
      await queries.audit({
        actorId: viewer.userId,
        action: 'package.update',
        resourceType: 'package',
        resourceId: id,
        before,
        after: snapshotAfter(before, changes),
      });
    });
    return detailFor(viewer, id);
  },

  /**
   * Nouvelle étape de suivi. Les changements de statut suivent le cycle de vie du colis.
   * « Prévenir le client » inscrit un e-mail dans la boîte d'envoi (F10) ; sans adresse
   * e-mail, il est noté « non envoyé ».
   */
  async addEvent(viewer: Viewer, id: string, input: PackageEventBody): Promise<PackageDetailDto> {
    await packagesRepository.inTransaction(async (queries) => {
      const state = await visibleState(queries, viewer, id);
      if (!canMoveTo(state.status, input.status)) {
        throw new InvalidStatusTransitionError(state.status, input.status);
      }
      const location = input.location_code ? await queries.findLocation(input.location_code) : null;
      if (input.location_code && !location?.active) {
        throw new UnknownLocationError(input.location_code);
      }
      await queries.addEvent(id, {
        status: input.status,
        locationId: location?.id ?? null,
        locationDetail: input.location,
        comment: input.comment ?? null,
        agentId: viewer.userId,
      });
      await queries.update(id, { status: input.status });
      await notifyStatusChange(queries, id, state, input);
    });
    return detailFor(viewer, id);
  },

  /** Renvoie au client, par e-mail, le lien de suivi de son colis. */
  async sendTrackingLink(viewer: Viewer, id: string): Promise<void> {
    await packagesRepository.inTransaction(async (queries) => {
      const state = await visibleState(queries, viewer, id);
      const address = state.client.email;
      if (!address) throw new ClientHasNoEmailError();
      await queries.addEmailNotification(
        id,
        {
          category: 'email',
          title: 'Lien de suivi envoyé au client',
          message: `${state.trackingNumber} : lien de suivi.`,
          deliveryStatus: 'queued',
        },
        {
          kind: 'tracking_link',
          to: address,
          data: {
            recipientName: state.client.name,
            trackingNumber: state.trackingNumber,
            trackingUrl: trackingUrlOf(state.trackingNumber),
          },
        }
      );
    });
  },
};
