// Adapter Resend : seul fichier qui connaît l'API du fournisseur d'e-mails
// (rules/10-stack/external-services.md). Le métier ne voit que l'interface EmailSender.
import type { Resend } from 'resend';
import type { EmailSender, OutgoingEmail } from './emailSender.js';

/** Au-delà, l'appel est abandonné : un fournisseur muet ne bloque pas le répartiteur. */
export const RESEND_TIMEOUT_MS = 20_000;

export class ResendEmailSender implements EmailSender {
  readonly configured = true;

  constructor(
    private readonly emails: Pick<Resend['emails'], 'send'>,
    private readonly from: string
  ) {}

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string | null }> {
    const { data, error } = await this.emails.send(
      { from: this.from, to: email.to, subject: email.subject, html: email.html, text: email.text },
      {
        // Resend reconnaît une clé déjà reçue et n'envoie pas l'e-mail une seconde fois :
        // un envoi rejoué après une coupure ne crée pas de doublon.
        idempotencyKey: email.idempotencyKey,
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      }
    );
    // Resend renvoie l'erreur au lieu de la lever : elle est levée ici, pour que le répartiteur
    // reprogramme l'envoi.
    if (error) throw new Error(`Resend a refusé l’envoi (${error.name}) : ${error.message}`);
    return { providerMessageId: data.id };
  }
}
