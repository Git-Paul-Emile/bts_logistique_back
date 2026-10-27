// Test de l'adapter Resend avec un faux client : on vérifie ce qui est envoyé au fournisseur,
// sans appel réseau.
import { describe, expect, it, vi } from 'vitest';
import { ResendEmailSender } from '../../src/infrastructure/email/resendEmailSender.js';

const FROM = 'BTS Logistique <no-reply@bts-logistique.com>';
const EMAIL = {
  to: 'client@shop.ci',
  subject: 'Votre colis est enregistré',
  text: 'Bonjour',
  html: '<p>Bonjour</p>',
  idempotencyKey: '0190d4f0-aaaa-7bbb-8ccc-000000000001',
};

describe('envoi par Resend', () => {
  it('envoie objet, texte et HTML depuis l’expéditeur, avec la clé d’idempotence', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: { id: 'resend-42' }, error: null, headers: null });
    const sender = new ResendEmailSender({ send }, FROM);

    const result = await sender.send(EMAIL);

    expect(result.providerMessageId).toBe('resend-42');
    expect(send).toHaveBeenCalledWith(
      { from: FROM, to: EMAIL.to, subject: EMAIL.subject, html: EMAIL.html, text: EMAIL.text },
      expect.objectContaining({ idempotencyKey: EMAIL.idempotencyKey })
    );
    expect(sender.configured).toBe(true);
  });

  it('lève l’erreur renvoyée par Resend, pour que le répartiteur reprogramme l’envoi', async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 },
      headers: null,
    });
    const sender = new ResendEmailSender({ send }, FROM);

    await expect(sender.send(EMAIL)).rejects.toThrow('rate_limit_exceeded');
  });
});
