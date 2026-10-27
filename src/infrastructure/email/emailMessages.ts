// E-mails transactionnels, décrits dans le vocabulaire du métier. Le schéma de chaque type
// sert à relire en toute sécurité les données conservées dans la boîte d'envoi (JSON).
import { z } from 'zod';

const url = z.url();
const text = z.string().min(1);

export const emailDataSchemas = {
  password_reset: z.object({
    recipientName: text,
    resetUrl: url,
    expiresInMinutes: z.number().int().positive(),
  }),
  invitation: z.object({
    recipientName: text,
    invitedBy: text,
    acceptUrl: url,
    expiresInDays: z.number().int().positive(),
  }),
  email_change: z.object({
    recipientName: text,
    confirmUrl: url,
    expiresInMinutes: z.number().int().positive(),
  }),
  package_registered: z.object({
    recipientName: text,
    trackingNumber: text,
    trackingUrl: url,
    origin: text,
    destination: text,
  }),
  tracking_link: z.object({
    recipientName: text,
    trackingNumber: text,
    trackingUrl: url,
  }),
  package_status: z.object({
    recipientName: text,
    trackingNumber: text,
    trackingUrl: url,
    statusLabel: text,
    location: text,
  }),
} as const;

export type EmailKind = keyof typeof emailDataSchemas;

/** Un e-mail à envoyer : son type, son destinataire et les données de son modèle. */
export type EmailMessage = {
  [Kind in EmailKind]: { kind: Kind; to: string; data: z.infer<(typeof emailDataSchemas)[Kind]> };
}[EmailKind];

/** Relit un e-mail conservé en JSON ; null si ses données ne correspondent plus à son type. */
export function parseEmailMessage(kind: EmailKind, to: string, data: unknown): EmailMessage | null {
  const parsed = emailDataSchemas[kind].safeParse(data);
  return parsed.success ? ({ kind, to, data: parsed.data } as EmailMessage) : null;
}
