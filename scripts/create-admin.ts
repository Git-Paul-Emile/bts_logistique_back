// Crée le premier administrateur. Usage (une seule fois, après npm run db:migrate et db:seed) :
//   npm run admin:create
// Les informations sont demandées dans le terminal ; le mot de passe n'est jamais affiché ni
// passé en argument, pour qu'il n'apparaisse pas dans l'historique du shell.
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { AppError } from '../src/core/errors/AppError.js';
import {
  createFirstAdmin,
  firstAdminInputSchema,
} from '../src/features/users/firstAdmin.service.js';
import { prisma } from '../src/lib/prisma.js';

/** Sortie qui n'écrit rien : la saisie du mot de passe n'est pas renvoyée à l'écran. */
const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

async function ask(question: string): Promise<string> {
  const reader = createInterface({ input: stdin, output: stdout });
  const answer = await reader.question(question);
  reader.close();
  return answer;
}

async function askSecret(question: string): Promise<string> {
  stdout.write(question);
  const reader = createInterface({ input: stdin, output: silentOutput, terminal: true });
  const answer = await reader.question('');
  reader.close();
  stdout.write('\n');
  return answer;
}

async function main() {
  const name = await ask('Nom complet : ');
  const email = await ask('Adresse e-mail : ');
  const agencyCode = await ask('Code de l’agence (ex. CI-ABJ) : ');
  const password = await askSecret('Mot de passe (12 caractères minimum) : ');
  if (password !== (await askSecret('Confirmez le mot de passe : '))) {
    throw new Error('Les deux mots de passe ne correspondent pas.');
  }

  const input = firstAdminInputSchema.safeParse({ name, email, agencyCode, password });
  if (!input.success) {
    throw new Error(input.error.issues.map((issue) => `- ${issue.message}`).join('\n'));
  }
  const admin = await createFirstAdmin(input.data);
  stdout.write(`Administrateur créé : ${admin.email}\n`);
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof AppError || error instanceof Error ? error.message : String(error);
    process.stderr.write(`Échec : ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
