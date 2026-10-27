// Envoi des e-mails au fournisseur (rules/10-stack/external-services.md). Le métier ne connaît
// que cette interface ; l'adapter Resend (resendEmailSender.ts) l'implémente. Aucun nom de
// fournisseur hors de ce dossier.
import { Resend } from 'resend';
import { env } from '../../config/env.js';
import type { RenderedEmail } from './emailTemplates.js';
import { ResendEmailSender } from './resendEmailSender.js';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /**
   * Clé d'idempotence transmise au fournisseur : si un envoi est rejoué après une coupure,
   * le fournisseur reconnaît le message et ne l'envoie pas une seconde fois.
   */
  idempotencyKey: string;
}

export interface EmailSender {
  /** Faux tant qu'aucun fournisseur n'est branché : les e-mails attendent dans la boîte d'envoi. */
  readonly configured: boolean;
  /** Renvoie l'identifiant du message chez le fournisseur, s'il en donne un. */
  send(email: OutgoingEmail): Promise<{ providerMessageId: string | null }>;
}

/** Utilisé tant que Resend n'est pas configuré : aucun envoi possible. */
class UnconfiguredEmailSender implements EmailSender {
  readonly configured = false;

  async send(): Promise<{ providerMessageId: string | null }> {
    throw new Error('Aucun fournisseur d’e-mails n’est configuré.');
  }
}

/** Resend si RESEND_API_KEY est renseignée, sinon aucun envoi : les e-mails attendent leur tour. */
function createEmailSender(): EmailSender {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return new UnconfiguredEmailSender();
  return new ResendEmailSender(new Resend(env.RESEND_API_KEY).emails, env.MAIL_FROM);
}

export const emailSender: EmailSender = createEmailSender();
