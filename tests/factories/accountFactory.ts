// Fabrique de comptes pour les tests : agence, utilisateur et mot de passe connu.
import { prisma } from '../../src/lib/prisma.js';
import { passwordHasher } from '../../src/lib/password.js';
import type { UserRole } from '../../src/generated/prisma/enums.js';

export const DEFAULT_PASSWORD = 'mot-de-passe-solide-2026';
export const DEFAULT_AGENCY = { code: 'CI-ABJ', name: "Abidjan (Côte d'Ivoire)", country: 'CI' };

interface AccountOptions {
  email?: string;
  name?: string;
  role?: UserRole;
  password?: string | null;
  active?: boolean;
  archived?: boolean;
  agencyCode?: string;
}

let sequence = 0;

/** Crée (ou retrouve) une ville et l'agence du même code. */
export async function createAgency(
  code = DEFAULT_AGENCY.code,
  name = DEFAULT_AGENCY.name,
  countryCode = DEFAULT_AGENCY.country
): Promise<string> {
  const location = await prisma.location.upsert({
    where: { code },
    create: { code, name, countryCode, isDestination: true },
    update: {},
    select: { id: true },
  });
  const agency = await prisma.agency.upsert({
    where: { code },
    create: { code, name, locationId: location.id },
    update: {},
    select: { id: true },
  });
  return agency.id;
}

export async function createAccount(options: AccountOptions = {}) {
  sequence += 1;
  const password = options.password === undefined ? DEFAULT_PASSWORD : options.password;
  const agencyId = options.agencyCode
    ? (await prisma.agency.findUniqueOrThrow({ where: { code: options.agencyCode } })).id
    : await createAgency();
  return prisma.user.create({
    data: {
      name: options.name ?? `Agent Test ${sequence}`,
      email: options.email ?? `agent${sequence}@bts.test`,
      role: options.role ?? 'manager',
      agencyId,
      passwordHash: password === null ? null : await passwordHasher.hash(password),
      active: options.active ?? true,
      archivedAt: options.archived ? new Date() : null,
    },
    select: { id: true, email: true, name: true },
  });
}
