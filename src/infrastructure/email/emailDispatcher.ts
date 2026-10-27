// Répartiteur de la boîte d'envoi : envoie les e-mails en attente, reprend les échecs à
// intervalle croissant, abandonne après le dernier essai et le signale dans les logs.
// Il tient lieu de file d'attente, dans la base, sans serveur supplémentaire ; seul ce
// fichier changerait avec une file dédiée (BullMQ, pg-boss) si le volume l'exigeait.
import { clock } from '../../lib/clock.js';
import { logger } from '../../lib/logger.js';
import { parseEmailMessage } from './emailMessages.js';
import { emailOutboxRepository, type ClaimedEmail } from './emailOutbox.repository.js';
import { emailSender } from './emailSender.js';
import { renderEmail } from './emailTemplates.js';

export const MAX_ATTEMPTS = 5;
/** Délai avant le 2e essai ; il double ensuite : 1, 2, 4, 8 minutes. */
const FIRST_RETRY_DELAY_MS = 60_000;
/** Un envoi « en cours » depuis plus longtemps a été interrompu : il est repris. */
const STALE_SENDING_MS = 10 * 60_000;
const BATCH_SIZE = 20;
const DEFAULT_INTERVAL_MS = 15_000;

function retryDelay(attempts: number): number {
  return FIRST_RETRY_DELAY_MS * 2 ** (attempts - 1);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deliver(email: ClaimedEmail): Promise<void> {
  const message = parseEmailMessage(email.kind, email.recipient, email.payload);
  // Données illisibles : réessayer ne servirait à rien.
  if (!message) {
    await emailOutboxRepository.markFailed(email.id, 'Données de l’e-mail invalides.');
    logger.error({ emailId: email.id, kind: email.kind }, 'E-mail abandonné : données invalides');
    return;
  }
  try {
    const { providerMessageId } = await emailSender.send({
      ...(await renderEmail(message)),
      to: message.to,
      idempotencyKey: email.id,
    });
    await emailOutboxRepository.markSent(email.id, clock.now(), providerMessageId);
  } catch (error) {
    if (email.attempts >= MAX_ATTEMPTS) {
      await emailOutboxRepository.markFailed(email.id, errorText(error));
      // Alerte : un e-mail client n'a pas pu partir malgré toutes les reprises.
      logger.error({ emailId: email.id, kind: email.kind, err: error }, 'E-mail abandonné');
      return;
    }
    const nextAttemptAt = new Date(clock.now().getTime() + retryDelay(email.attempts));
    await emailOutboxRepository.scheduleRetry(email.id, nextAttemptAt, errorText(error));
    logger.warn({ emailId: email.id, attempt: email.attempts }, 'Envoi d’e-mail reporté');
  }
}

let timer: NodeJS.Timeout | undefined;

export const emailDispatcher = {
  /** Envoie un lot d'e-mails dus. Renvoie le nombre d'e-mails traités. */
  async runOnce(): Promise<number> {
    const now = clock.now();
    const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);
    const due = await emailOutboxRepository.claimDue(now, staleBefore, BATCH_SIZE);
    for (const email of due) await deliver(email);
    return due.length;
  },

  /** Lance l'envoi périodique (server.ts). Sans fournisseur configuré, rien ne démarre. */
  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (!emailSender.configured) {
      logger.warn('Aucun fournisseur d’e-mails : les e-mails restent dans la boîte d’envoi.');
      return;
    }
    timer = setInterval(() => {
      emailDispatcher.runOnce().catch((error: unknown) => {
        logger.error({ err: error }, 'Échec du répartiteur d’e-mails');
      });
    }, intervalMs);
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  },
};
