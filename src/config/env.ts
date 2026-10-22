// Seul endroit qui lit process.env. Le reste du code importe `env`, déjà validé et typé.
// Si une variable manque ou est invalide, le serveur refuse de démarrer avec un message clair.
import 'dotenv/config';
import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  FRONT_URL: z.url(),
  TRUST_PROXY: booleanFromString.default(false),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(MIN_SECRET_LENGTH),
  JWT_REFRESH_SECRET: z.string().min(MIN_SECRET_LENGTH),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')} : ${issue.message}`
    );
    throw new Error(`Configuration invalide, vérifiez le fichier .env :\n${problems.join('\n')}`);
  }
  if (result.data.JWT_ACCESS_SECRET === result.data.JWT_REFRESH_SECRET) {
    throw new Error(
      'Configuration invalide : JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être différents.'
    );
  }
  return result.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
