// Règles métier de la gestion des comptes (F2) : invitation, modification, activation,
// restauration, et au moins un administrateur actif en permanence.
import { env } from '../../config/env.js';
import type { PaginationMeta } from '../../core/http/apiResponse.js';
import { offsetOf, paginationMeta, parseSort } from '../../core/http/pagination.js';
import type { EmailMessage } from '../../infrastructure/email/emailMessages.js';
import { clock } from '../../lib/clock.js';
import { expiresIn, generateOpaqueToken, hashOpaqueToken } from '../auth/auth.tokens.js';
import { toUserDto, type UserDto } from './users.dto.js';
import {
  EmailAlreadyUsedError,
  LastAdminError,
  SelfDeactivationError,
  UnknownAgencyError,
  UserNotFoundError,
} from './users.errors.js';
import { usersRepository, type UserRecord, type UsersQueries } from './users.repository.js';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UserSortField,
} from './users.schemas.js';

const INVITATION_TTL_DAYS = 7;
const SECONDS_PER_DAY = 86_400;
/** Page du front où la personne invitée choisit son mot de passe (lit ?token=). */
const ACCEPT_INVITATION_PATH = '/activer-mon-compte';
const SORT_COLUMNS = { name: 'name', email: 'email', created_at: 'createdAt' } as const;

async function findOrThrow(queries: UsersQueries, id: string): Promise<UserRecord> {
  const user = await queries.findById(id);
  if (!user) throw new UserNotFoundError();
  return user;
}

async function agencyIdOf(queries: UsersQueries, code: string): Promise<string> {
  const agency = await queries.findAgencyIdByCode(code);
  if (!agency) throw new UnknownAgencyError();
  return agency.id;
}

function isActiveAdmin(user: UserRecord): boolean {
  return user.role === 'admin' && user.active && user.archivedAt === null;
}

/** E-mail d'invitation, avec le lien pour choisir son mot de passe. */
function invitationEmail(user: CreateUserBody, invitedBy: string, token: string): EmailMessage {
  const acceptUrl = new URL(ACCEPT_INVITATION_PATH, env.FRONT_URL);
  acceptUrl.searchParams.set('token', token);
  return {
    kind: 'invitation',
    to: user.email,
    data: {
      recipientName: user.name,
      invitedBy,
      acceptUrl: acceptUrl.toString(),
      expiresInDays: INVITATION_TTL_DAYS,
    },
  };
}

export const usersService = {
  async list(query: ListUsersQuery): Promise<{ items: UserDto[]; meta: PaginationMeta }> {
    const sort = parseSort<UserSortField>(query.sort);
    const { items, total } = await usersRepository.list({
      archived: query.archived,
      role: query.role,
      search: query.search,
      orderBy: { field: SORT_COLUMNS[sort.field], direction: sort.direction },
      skip: offsetOf(query.page, query.limit),
      take: query.limit,
    });
    return { items: items.map(toUserDto), meta: paginationMeta(query.page, query.limit, total) };
  },

  async get(id: string): Promise<UserDto> {
    return toUserDto(await findOrThrow(usersRepository, id));
  },

  /** Crée le compte sans mot de passe et envoie un lien pour le choisir. */
  async invite(input: CreateUserBody, actorId: string): Promise<UserDto> {
    if (await usersRepository.isEmailTaken(input.email)) throw new EmailAlreadyUsedError();
    const actor = await findOrThrow(usersRepository, actorId);
    const token = generateOpaqueToken();
    // Le compte, son lien d'invitation et l'e-mail sont écrits ensemble, ou pas du tout.
    const user = await usersRepository.inTransaction(async (queries) => {
      const created = await queries.create({
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        role: input.role,
        agencyId: await agencyIdOf(queries, input.agency_code),
        invitation: {
          tokenHash: hashOpaqueToken(token),
          expiresAt: expiresIn(INVITATION_TTL_DAYS * SECONDS_PER_DAY),
        },
      });
      await queries.queueEmail(invitationEmail(input, actor.name, token));
      await queries.audit({
        actorId,
        action: 'user.invite',
        resourceType: 'user',
        resourceId: created.id,
        after: { ...toUserDto(created) },
      });
      return created;
    });
    return toUserDto(user);
  },

  /** Retirer le rôle administrateur au dernier administrateur actif est refusé. */
  async update(id: string, input: UpdateUserBody, actorId: string): Promise<UserDto> {
    const updated = await usersRepository.inTransaction(async (queries) => {
      const target = await findOrThrow(queries, id);
      if (input.email && (await queries.isEmailTaken(input.email, id))) {
        throw new EmailAlreadyUsedError();
      }
      const losesAdminRole = input.role !== undefined && input.role !== 'admin';
      if (losesAdminRole && isActiveAdmin(target) && (await queries.countActiveAdmins(id)) === 0) {
        throw new LastAdminError();
      }
      const user = await queries.update(id, {
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        agencyId: input.agency_code ? await agencyIdOf(queries, input.agency_code) : undefined,
      });
      await queries.audit({
        actorId,
        action: 'user.update',
        resourceType: 'user',
        resourceId: id,
        before: { ...toUserDto(target) },
        after: { ...toUserDto(user) },
      });
      return user;
    });
    return toUserDto(updated);
  },

  /**
   * Active ou désactive un compte. Une désactivation ferme aussitôt ses sessions.
   * Un administrateur ne peut pas se désactiver lui-même : comme il reste actif, la plateforme
   * garde donc toujours au moins un administrateur actif.
   */
  async setActive(id: string, active: boolean, actorId: string): Promise<UserDto> {
    if (!active && id === actorId) throw new SelfDeactivationError();
    const updated = await usersRepository.inTransaction(async (queries) => {
      const target = await findOrThrow(queries, id);
      const user = await queries.update(id, { active });
      if (!active) await queries.revokeSessions(id, clock.now());
      await queries.audit({
        actorId,
        action: active ? 'user.activate' : 'user.deactivate',
        resourceType: 'user',
        resourceId: id,
        before: { active: target.active },
        after: { active },
      });
      return user;
    });
    return toUserDto(updated);
  },

  /** Rend l'accès à un compte archivé. Il retrouve son état actif ou désactivé d'avant. */
  async restore(id: string, actorId: string): Promise<UserDto> {
    const updated = await usersRepository.inTransaction(async (queries) => {
      const target = await findOrThrow(queries, id);
      const user = await queries.update(id, { archivedAt: null });
      await queries.audit({
        actorId,
        action: 'user.restore',
        resourceType: 'user',
        resourceId: id,
        before: { archived_at: target.archivedAt?.toISOString() ?? null },
        after: { archived_at: null },
      });
      return user;
    });
    return toUserDto(updated);
  },
};
