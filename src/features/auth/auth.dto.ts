// Ce que l'API renvoie de la personne connectée. Ni l'empreinte du mot de passe, ni les
// champs d'administration (actif, archivage) ne sortent du serveur.
// Les champs sont en snake_case, comme les types du front (front/src/types/index.ts).
import type { UserRole } from '../../generated/prisma/enums.js';
import type { AccountRecord } from './auth.repository.js';

export interface SessionUserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  agency: { code: string; name: string };
  initials: string;
}

const MAX_INITIALS = 2;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_INITIALS)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function toSessionUserDto(
  account: Pick<AccountRecord, 'id' | 'name' | 'email' | 'phone' | 'role' | 'agency'>
): SessionUserDto {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    role: account.role,
    agency: { code: account.agency.code, name: account.agency.name },
    initials: initialsOf(account.name),
  };
}
