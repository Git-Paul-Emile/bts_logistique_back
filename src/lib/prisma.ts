// Client Prisma unique pour toute l'application.
// Prisma 7 impose un adaptateur de pilote : ici @prisma/adapter-pg pour PostgreSQL.
// Seuls les repositories (src/features/*/...repository.ts) importent ce client.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
