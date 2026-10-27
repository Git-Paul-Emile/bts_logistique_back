// Lecture des e-mails inscrits dans la boîte d'envoi, dans l'ordre d'inscription.
import {
  parseEmailMessage,
  type EmailMessage,
} from '../../src/infrastructure/email/emailMessages.js';
import { prisma } from '../../src/lib/prisma.js';

export async function queuedEmails(): Promise<EmailMessage[]> {
  const rows = await prisma.emailOutbox.findMany({
    where: { status: 'pending' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, recipient: true, payload: true },
  });
  return rows.map((row) => {
    const message = parseEmailMessage(row.kind, row.recipient, row.payload);
    if (!message) throw new Error(`E-mail ${row.kind} illisible dans la boîte d’envoi.`);
    return message;
  });
}
