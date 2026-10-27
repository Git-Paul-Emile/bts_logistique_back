// Tests d'intégration de la boîte d'envoi et du répartiteur d'e-mails (F10).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailDispatcher, MAX_ATTEMPTS } from '../src/infrastructure/email/emailDispatcher.js';
import type { EmailMessage } from '../src/infrastructure/email/emailMessages.js';
import { queueEmail } from '../src/infrastructure/email/emailOutbox.repository.js';
import { emailSender, type OutgoingEmail } from '../src/infrastructure/email/emailSender.js';
import { clock } from '../src/lib/clock.js';
import { prisma } from '../src/lib/prisma.js';
import { resetTestDatabase } from './helpers/testDatabase.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { createTestPrisma } = await import('./helpers/testDatabase.js');
  return { prisma: await createTestPrisma() };
});

const START = new Date('2026-10-22T08:00:00.000Z');
const MINUTE_MS = 60_000;

const RESET: EmailMessage = {
  kind: 'password_reset',
  to: 'marie@bts.test',
  data: {
    recipientName: 'Marie <script>',
    resetUrl: 'http://localhost:5173/reinitialiser-mot-de-passe?token=abc&x=1',
    expiresInMinutes: 60,
  },
};

let now = START;
let sent: OutgoingEmail[] = [];
let failure: Error | null = null;

beforeEach(async () => {
  await resetTestDatabase();
  now = START;
  sent = [];
  failure = null;
  vi.spyOn(clock, 'now').mockImplementation(() => now);
  vi.spyOn(emailSender, 'send').mockImplementation(async (email) => {
    if (failure) throw failure;
    sent.push(email);
    return { providerMessageId: `msg-${sent.length}` };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function advance(ms: number) {
  now = new Date(now.getTime() + ms);
}

async function outboxRow() {
  return prisma.emailOutbox.findFirstOrThrow({
    select: {
      id: true,
      status: true,
      attempts: true,
      payload: true,
      nextAttemptAt: true,
      lastError: true,
      providerMessageId: true,
    },
  });
}

/** Notification « e-mail au client » liée à l'e-mail, comme pour un changement de statut. */
async function queueLinkedEmail() {
  const notification = await prisma.notification.create({
    data: { category: 'email', title: 'E-mail de suivi', message: 'X', deliveryStatus: 'queued' },
    select: { id: true },
  });
  await queueEmail(prisma, RESET, notification.id);
  return notification.id;
}

describe('répartiteur d’e-mails', () => {
  it('envoie une seule fois, puis efface les données de l’e-mail', async () => {
    await queueEmail(prisma, RESET);

    const first = await emailDispatcher.runOnce();
    const second = await emailDispatcher.runOnce();
    const row = await outboxRow();

    expect([first, second]).toEqual([1, 0]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'marie@bts.test',
      subject: 'Réinitialisation de votre mot de passe BTS Logistique',
      idempotencyKey: row.id,
    });
    expect(row).toMatchObject({ status: 'sent', payload: null, providerMessageId: 'msg-1' });
  });

  it('échappe les données dans le HTML et garde le lien dans le texte brut', async () => {
    await queueEmail(prisma, RESET);

    await emailDispatcher.runOnce();

    expect(sent[0]?.html).toContain('Marie &lt;script&gt;');
    expect(sent[0]?.html).not.toContain('<script>');
    expect(sent[0]?.html).toContain('token=abc&amp;x=1');
    expect(sent[0]?.text).toContain('token=abc&x=1');
  });

  it('reporte un envoi échoué à intervalle croissant', async () => {
    await queueEmail(prisma, RESET);
    failure = new Error('Fournisseur indisponible');

    await emailDispatcher.runOnce();
    const afterFirstFailure = await outboxRow();
    const tooEarly = await emailDispatcher.runOnce();
    advance(MINUTE_MS);
    await emailDispatcher.runOnce();
    const afterSecondFailure = await outboxRow();

    expect(afterFirstFailure).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Fournisseur indisponible',
    });
    expect(afterFirstFailure.nextAttemptAt).toEqual(new Date(START.getTime() + MINUTE_MS));
    expect(afterFirstFailure.payload).not.toBeNull();
    expect(tooEarly).toBe(0);
    expect(afterSecondFailure.nextAttemptAt).toEqual(new Date(now.getTime() + 2 * MINUTE_MS));
  });

  it('abandonne après le dernier essai et le reporte sur la notification', async () => {
    const notificationId = await queueLinkedEmail();
    failure = new Error('Adresse refusée');

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await emailDispatcher.runOnce();
      advance(60 * MINUTE_MS);
    }
    const row = await outboxRow();
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, payload: null });
    expect(notification.deliveryStatus).toBe('failed');
    expect(await emailDispatcher.runOnce()).toBe(0);
  });

  it('passe la notification liée à « envoyé »', async () => {
    const notificationId = await queueLinkedEmail();

    await emailDispatcher.runOnce();
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    expect(notification.deliveryStatus).toBe('sent');
  });

  it('reprend un envoi interrompu (processus arrêté pendant l’envoi)', async () => {
    await queueEmail(prisma, RESET);
    const row = await outboxRow();
    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: 'sending',
        lockedAt: new Date(START.getTime() - 11 * MINUTE_MS),
        attempts: 1,
      },
    });

    await emailDispatcher.runOnce();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.idempotencyKey).toBe(row.id);
    expect((await outboxRow()).status).toBe('sent');
  });

  it('abandonne aussitôt un e-mail aux données illisibles', async () => {
    await queueEmail(prisma, RESET);
    const row = await outboxRow();
    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: { payload: { inattendu: true } },
    });

    await emailDispatcher.runOnce();

    expect(sent).toHaveLength(0);
    expect((await outboxRow()).status).toBe('failed');
  });
});
