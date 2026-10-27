// Base PostgreSQL de test, en mémoire (PGlite) : pas de serveur à installer, pas d'identifiants,
// et un vrai moteur PostgreSQL, contraintes CHECK et clés étrangères comprises.
// Le schéma est créé en rejouant les migrations du dépôt, exactement comme en production.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');

let pglite: PGlite | undefined;

export async function createTestPrisma(): Promise<PrismaClient> {
  pglite = new PGlite();
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await pglite.exec(readFileSync(join(MIGRATIONS_DIR, migration, 'migration.sql'), 'utf8'));
  }
  return new PrismaClient({ adapter: new PrismaPGlite(pglite) });
}

/** Vide toutes les tables : chaque test part d'une base vide, quel que soit l'ordre d'exécution. */
export async function resetTestDatabase(): Promise<void> {
  if (!pglite) throw new Error('La base de test n’est pas initialisée.');
  const { rows } = await pglite.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await pglite.exec(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
