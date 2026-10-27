// Règles de forme de tous les e-mails : logo toujours présent, aucune icône, aucun tiret long,
// et données insérées échappées.
import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../src/infrastructure/email/emailMessages.js';
import { renderEmail } from '../../src/infrastructure/email/emailTemplates.js';

const TRACKING_URL = 'https://bts.test/suivi/BTS-CI-2026-000001';

const MESSAGES: EmailMessage[] = [
  {
    kind: 'password_reset',
    to: 'a@b.ci',
    data: { recipientName: 'Awa', resetUrl: 'https://bts.test/r?token=t', expiresInMinutes: 30 },
  },
  {
    kind: 'invitation',
    to: 'a@b.ci',
    data: {
      recipientName: 'Awa',
      invitedBy: 'Admin',
      acceptUrl: 'https://bts.test/a?token=t',
      expiresInDays: 7,
    },
  },
  {
    kind: 'email_change',
    to: 'a@b.ci',
    data: { recipientName: 'Awa', confirmUrl: 'https://bts.test/c?token=t', expiresInMinutes: 120 },
  },
  {
    kind: 'package_registered',
    to: 'a@b.ci',
    data: {
      recipientName: 'Awa',
      trackingNumber: 'BTS-CI-2026-000001',
      trackingUrl: TRACKING_URL,
      origin: 'Dubaï (EAU)',
      destination: "Abidjan (Côte d'Ivoire)",
    },
  },
  {
    kind: 'tracking_link',
    to: 'a@b.ci',
    data: { recipientName: 'Awa', trackingNumber: 'BTS-CI-2026-000001', trackingUrl: TRACKING_URL },
  },
  {
    kind: 'package_status',
    to: 'a@b.ci',
    data: {
      recipientName: 'Awa',
      trackingNumber: 'BTS-CI-2026-000001',
      trackingUrl: TRACKING_URL,
      statusLabel: 'En transit',
      location: 'Port de Dubaï',
    },
  },
];

/** Tirets longs interdits par la charte de rédaction : cadratin et demi-cadratin. */
const LONG_DASHES = /[–—]/;
/** Émojis et pictogrammes. */
const PICTOGRAPHS = /\p{Extended_Pictographic}/u;

describe('modèles d’e-mails', () => {
  it.each(MESSAGES.map((message) => [message.kind, message] as const))(
    '%s : logo, lien, sans icône ni tiret long',
    async (_kind, message) => {
      const email = await renderEmail(message);

      const images = email.html.match(/<img[^>]*>/g) ?? [];
      expect(images).toHaveLength(1);
      expect(images[0]).toMatch(/src="https?:\/\/[^"]+\/logotype1\.png"/);
      expect(images[0]).toContain('alt="BTS Logistique"');
      expect(email.html).not.toContain('<svg');
      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toMatch(LONG_DASHES);
        expect(part).not.toMatch(PICTOGRAPHS);
      }
      expect(email.text).toContain('Bonjour Awa,');
      expect(email.text).toMatch(/https:\/\/bts\.test\//);
    }
  );

  it('échappe les données insérées dans le HTML', async () => {
    const email = await renderEmail({
      kind: 'tracking_link',
      to: 'a@b.ci',
      data: {
        recipientName: '<script>alert(1)</script>',
        trackingNumber: 'BTS-1',
        trackingUrl: TRACKING_URL,
      },
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
