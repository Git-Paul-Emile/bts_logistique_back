// Modèles des e-mails, en français : objet et texte de chaque type d'e-mail. La mise en page
// (logo, bouton, pied de page) est celle d'EmailLayout, rendue en HTML et en texte brut par
// React Email. React échappe toute donnée insérée dans le HTML.
import { render } from '@react-email/render';
import { env } from '../../config/env.js';
import { EmailLayout, type EmailContent } from './EmailLayout.js';
import type { EmailKind, EmailMessage } from './emailMessages.js';

const MINUTES_PER_HOUR = 60;
/** Logo hébergé par le front (front/public), en URL absolue. */
const LOGO_PATH = '/logotype1.png';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type DataOf<Kind extends EmailKind> = Extract<EmailMessage, { kind: Kind }>['data'];

/** Un modèle par type d'e-mail. */
const TEMPLATES: { [Kind in EmailKind]: (data: DataOf<Kind>) => EmailContent } = {
  password_reset: (data) => ({
    subject: 'Réinitialisation de votre mot de passe BTS Logistique',
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      'Vous avez demandé à choisir un nouveau mot de passe.',
    ],
    button: { label: 'Choisir un nouveau mot de passe', url: data.resetUrl },
    footnote: `Ce lien est valable ${data.expiresInMinutes} minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`,
  }),
  invitation: (data) => ({
    subject: 'Votre accès à la plateforme BTS Logistique',
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      `${data.invitedBy} vous a créé un compte sur la plateforme BTS Logistique.`,
    ],
    button: { label: 'Activer mon compte', url: data.acceptUrl },
    footnote: `Ce lien est valable ${data.expiresInDays} jours.`,
  }),
  email_change: (data) => ({
    subject: 'Confirmez votre nouvelle adresse e-mail',
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      'Confirmez cette adresse pour l’utiliser sur votre compte BTS Logistique.',
    ],
    button: { label: 'Confirmer cette adresse', url: data.confirmUrl },
    footnote: `Ce lien est valable ${Math.round(data.expiresInMinutes / MINUTES_PER_HOUR)} heures. Sans confirmation, votre adresse actuelle reste inchangée.`,
  }),
  package_registered: (data) => ({
    subject: `Votre colis ${data.trackingNumber} est enregistré`,
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      `Votre colis ${data.origin} vers ${data.destination} est enregistré sous le numéro ${data.trackingNumber}.`,
    ],
    button: { label: 'Suivre mon colis', url: data.trackingUrl },
  }),
  tracking_link: (data) => ({
    subject: `Suivi de votre colis ${data.trackingNumber}`,
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      `Voici le lien pour suivre votre colis ${data.trackingNumber} étape par étape.`,
    ],
    button: { label: 'Suivre mon colis', url: data.trackingUrl },
  }),
  package_status: (data) => ({
    subject: `Colis ${data.trackingNumber} : ${data.statusLabel}`,
    paragraphs: [
      `Bonjour ${data.recipientName},`,
      `Votre colis ${data.trackingNumber} est maintenant : ${data.statusLabel} (${data.location}).`,
    ],
    button: { label: 'Suivre mon colis', url: data.trackingUrl },
  }),
};

function contentOf(message: EmailMessage): EmailContent {
  // TypeScript ne relie pas `kind` et `data` d'une union : le modèle choisi par `kind` reçoit
  // pourtant bien les données de ce même type, garanties par EmailMessage.
  const template = TEMPLATES[message.kind] as (data: EmailMessage['data']) => EmailContent;
  return template(message.data);
}

export async function renderEmail(message: EmailMessage): Promise<RenderedEmail> {
  const content = contentOf(message);
  const email = (
    <EmailLayout content={content} logoUrl={new URL(LOGO_PATH, env.FRONT_URL).toString()} />
  );
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);
  return { subject: content.subject, html, text };
}
