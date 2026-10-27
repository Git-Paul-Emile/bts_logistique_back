// Hachage des mots de passe avec bcrypt (rules/20-qualite/security.md : Argon2id, à défaut bcrypt).
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

/**
 * Empreinte d'un mot de passe que personne ne connaît. Quand le compte n'existe pas, on la
 * compare quand même : la réponse prend alors le même temps, ce qui empêche de deviner les
 * adresses enregistrées en mesurant la durée de la connexion.
 */
const UNKNOWN_ACCOUNT_HASH = bcrypt.hashSync('compte-inexistant', env.BCRYPT_ROUNDS);

export const passwordHasher = {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, env.BCRYPT_ROUNDS);
  },

  /** Compare un mot de passe à son empreinte. Sans empreinte, la comparaison échoue en temps constant. */
  verify(password: string, hash: string | null | undefined): Promise<boolean> {
    return bcrypt.compare(password, hash ?? UNKNOWN_ACCOUNT_HASH).then((same) => same && !!hash);
  },
};
