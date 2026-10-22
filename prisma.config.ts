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
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
