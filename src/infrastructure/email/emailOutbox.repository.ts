// Boîte d'envoi des e-mails (F10), dans PostgreSQL : un e-mail est inscrit dans la même
// transaction que l'action qui le déclenche, donc il n'est jamais perdu ni envoyé pour une
// action annulée. Le répartiteur (emailDispatcher.ts) les envoie ensuite.
import { clock } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { EmailKind, EmailMessage } from './emailMessages.js';

const MAX_ERROR_LENGTH = 500;

type Database = PrismaClient | Prisma.TransactionClient;

export interface ClaimedEmail {
  id: string;
  kind: EmailKind;
  recipient: string;
  payload: unknown;
  attempts: number;
}

/** Inscrit un e-mail. À appeler avec le client de la transaction en cours. */
export async function queueEmail(
  db: Database,
  message: EmailMessage,
  notificationId?: string
): Promise<void> {
  await db.emailOutbox.create({
    data: {
      kind: message.kind,
      recipient: message.to,
      payload: message.data,
      notificationId,
      // L'horloge du serveur, comme le répartiteur qui compare cette date à la sienne.
      nextAttemptAt: clock.now(),
      createdAt: clock.now(),
    },
    select: { id: true },
  });
}

/** Suit l'état d'envoi sur la notification du personnel liée, s'il y en a une. */
async function syncNotification(
  tx: Prisma.TransactionClient,
  outboxId: string,
  deliveryStatus: 'sent' | 'failed'
): Promise<void> {
  const email = await tx.emailOutbox.findUnique({
    where: { id: outboxId },
    select: { notificationId: true },
  });
  if (!email?.notificationId) return;
  await tx.notification.update({
    where: { id: email.notificationId },
    data: { deliveryStatus },
    select: { id: true },
  });
}

export const emailOutboxRepository = {
  /**
   * Réserve les e-mails à envoyer : ceux dont l'heure est venue, et ceux restés « en cours »
   * depuis trop longtemps (processus arrêté pendant l'envoi). SKIP LOCKED : deux répartiteurs
   * ne prennent jamais le même e-mail.
   */
  async claimDue(now: Date, staleBefore: Date, batchSize: number): Promise<ClaimedEmail[]> {
    return prisma.$queryRaw<ClaimedEmail[]>`
      UPDATE email_outbox
      SET status = 'sending', locked_at = ${now}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE (status = 'pending' AND next_attempt_at <= ${now})
           OR (status = 'sending' AND locked_at < ${staleBefore})
        ORDER BY next_attempt_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind::text AS kind, recipient, payload, attempts`;
  },

  /** Envoyé : les données (et donc les liens à jeton) sont effacées. */
  async markSent(id: string, now: Date, providerMessageId: string | null): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.emailOutbox.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: now,
          lockedAt: null,
          lastError: null,
          payload: Prisma.DbNull,
          providerMessageId,
        },
        select: { id: true },
      });
      await syncNotification(tx, id, 'sent');
    });
  },

  async scheduleRetry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: {
        status: 'pending',
        nextAttemptAt,
        lockedAt: null,
        lastError: error.slice(0, MAX_ERROR_LENGTH),
      },
      select: { id: true },
    });
  },

  /** Abandon après le dernier essai : les données sont effacées, l'erreur est gardée. */
  async markFailed(id: string, error: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.emailOutbox.update({
        where: { id },
        data: {
          status: 'failed',
          lockedAt: null,
          payload: Prisma.DbNull,
          lastError: error.slice(0, MAX_ERROR_LENGTH),
        },
        select: { id: true },
      });
      await syncNotification(tx, id, 'failed');
    });
  },
};
