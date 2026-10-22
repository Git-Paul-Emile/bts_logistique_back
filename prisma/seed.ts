// Lancé par `npm run db:seed`. Exécute les seeders dans l'ordre de la liste.
// Chaque seeder vit dans prisma/seeds/<nom>.seed.ts. Uniquement des données de référence.
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { locationsSeeder } from './seeds/locations.seed.js';
import type { Seeder } from './seeds/seeder.js';

const seeders: Seeder[] = [locationsSeeder];

async function main() {
  for (const seeder of seeders) {
    await seeder.run();
    process.stdout.write(`Seeder terminé : ${seeder.name}\n`);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Échec du seeding : ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
