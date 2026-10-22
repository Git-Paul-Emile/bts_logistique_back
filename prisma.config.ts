// Configuration de la CLI Prisma (migrate, generate, seed, studio).
// Depuis Prisma 7, l'URL de la base n'est plus dans schema.prisma et le .env n'est plus lu
// automatiquement : d'où l'import de dotenv ci-dessous.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // La CLI (migrations) passe par la connexion directe : le pooler de Neon (PgBouncer) gère mal
  // les verrous de Prisma Migrate. Sans DIRECT_URL, on retombe sur DATABASE_URL.
  datasource: {
    url: process.env['DIRECT_URL'] || process.env['DATABASE_URL'],
  },
});
