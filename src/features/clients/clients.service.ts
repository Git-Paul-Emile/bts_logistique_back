// Règles métier des clients (F5). Un collecteur ne voit et ne crée que les clients de son
// agence ; l'équipe (administrateur, gestionnaire) voit toutes les agences et les montants.
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta, parseSort } from '../../core/http/pagination.js';
import type { UserRole } from '../../generated/prisma/enums.js';
import { UnknownAgencyError } from '../users/users.errors.js';
import {
  toClientContactDto,
  toClientDto,
  toClientPackageDto,
  toClientPaymentDto,
  type ClientContactDto,
  type ClientDetailDto,
  type ClientDto,
} from './clients.dto.js';
import { ClientNotFoundError } from './clients.errors.js';
import { clientsRepository, type ClientBalanceRecord } from './clients.repository.js';
import type {
  ClientSortField,
  CreateClientBody,
  ListClientsQuery,
  UpdateClientBody,
} from './clients.schemas.js';

/** Nombre de colis et de paiements récents montrés sur la fiche ; le reste via leurs listes. */
const RECENT_ITEMS = 20;

/** Ce que le service doit savoir de la personne qui fait la demande. */
export interface Viewer {
  role: UserRole;
  agencyId: string;
}

function isCollector(viewer: Viewer): boolean {
  return viewer.role === 'collector';
}

function present(viewer: Viewer, client: ClientBalanceRecord): ClientDto | ClientContactDto {
  return isCollector(viewer) ? toClientContactDto(client) : toClientDto(client);
}

/** Client visible par cette personne, sinon 404 (même réponse qu'un client inexistant). */
async function visibleClient(viewer: Viewer, id: string): Promise<ClientBalanceRecord> {
  const client = await clientsRepository.findWithBalance(id);
  if (!client || (isCollector(viewer) && client.agencyId !== viewer.agencyId)) {
    throw new ClientNotFoundError();
  }
  return client;
}

async function agencyIdOf(code: string): Promise<string> {
  const agency = await clientsRepository.findAgencyIdByCode(code);
  if (!agency) throw new UnknownAgencyError();
  return agency.id;
}

export const clientsService = {
  async list(
    viewer: Viewer,
    query: ListClientsQuery
  ): Promise<{ items: (ClientDto | ClientContactDto)[]; meta: PaginationMeta }> {
    const sort = parseSort<ClientSortField>(query.sort);
    // Un collecteur ne peut ni trier ni filtrer sur des montants qu'il ne voit pas.
    const financial = !isCollector(viewer);
    const { items, total } = await clientsRepository.list({
      agencyId: isCollector(viewer) ? viewer.agencyId : undefined,
      search: query.search,
      hasDebt: financial ? query.has_debt : undefined,
      orderBy:
        financial || sort.field !== 'balance'
          ? { column: sort.field, direction: sort.direction }
          : { column: 'name', direction: 'asc' },
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return {
      items: items.map((client) => present(viewer, client)),
      meta: paginationMeta(query.page, query.limit, total),
    };
  },

  /** Fiche complète : solde, derniers colis et derniers paiements avec leur répartition. */
  async detail(viewer: Viewer, id: string): Promise<ClientDetailDto> {
    const client = await visibleClient(viewer, id);
    const [packages, payments] = await Promise.all([
      clientsRepository.recentPackages(id, RECENT_ITEMS),
      clientsRepository.recentPayments(id, RECENT_ITEMS),
    ]);
    return {
      client: toClientDto(client),
      recent_packages: packages.map(toClientPackageDto),
      recent_payments: payments.map(toClientPaymentDto),
    };
  },

  /** Un collecteur enregistre toujours le client dans sa propre agence. */
  async create(viewer: Viewer, input: CreateClientBody): Promise<ClientDto | ClientContactDto> {
    const agencyId =
      isCollector(viewer) || !input.agency_code
        ? viewer.agencyId
        : await agencyIdOf(input.agency_code);
    const id = await clientsRepository.create({
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      address: input.address ?? null,
      agencyId,
    });
    return present(viewer, await visibleClient(viewer, id));
  },

  async update(viewer: Viewer, id: string, input: UpdateClientBody): Promise<ClientDto> {
    await visibleClient(viewer, id);
    await clientsRepository.update(id, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      agencyId: input.agency_code ? await agencyIdOf(input.agency_code) : undefined,
    });
    return toClientDto(await visibleClient(viewer, id));
  },
};
