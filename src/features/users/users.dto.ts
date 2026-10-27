// Compte tel qu'il est renvoyé à l'écran Utilisateurs (front : type AppUser).
// Jamais d'empreinte de mot de passe ni de jeton.
import type { UserRole } from '../../generated/prisma/enums.js';
import type { UserRecord } from './users.repository.js';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  agency: { code: string; name: string };
  active: boolean;
  /** Vrai tant que la personne invitée n'a pas choisi son mot de passe. */
  invitation_pending: boolean;
  created_at: string;
  archived_at: string | null;
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    agency: { code: user.agency.code, name: user.agency.name },
    active: user.active,
    invitation_pending: user.passwordHash === null,
    created_at: user.createdAt.toISOString(),
    archived_at: user.archivedAt?.toISOString() ?? null,
  };
}
