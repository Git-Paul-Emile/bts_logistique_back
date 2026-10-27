// Mise en page commune à tous les e-mails (React Email). Le logo BTS est toujours présent, en
// tête ; aucune icône, pour un rendu identique dans toutes les messageries.
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';

const BRAND_BLUE = '#003366';
const TEXT_COLOR = '#1e293b';
const MUTED_COLOR = '#64748b';
const LOGO_SIZE_PX = 96;

export interface EmailContent {
  subject: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footnote?: string;
}

interface EmailLayoutProps {
  content: EmailContent;
  /** URL absolue du logo : les messageries n'affichent pas les images relatives. */
  logoUrl: string;
}

const styles = {
  body: { backgroundColor: '#f8fafc', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0 },
  container: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    margin: '24px auto',
    maxWidth: '560px',
    padding: '32px',
  },
  paragraph: { color: TEXT_COLOR, fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' },
  button: {
    backgroundColor: BRAND_BLUE,
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: 'bold',
    padding: '12px 20px',
    textDecoration: 'none',
  },
  footnote: { color: MUTED_COLOR, fontSize: '13px', lineHeight: '20px', margin: '16px 0 0' },
  footer: { color: MUTED_COLOR, fontSize: '12px', lineHeight: '18px', margin: 0 },
} as const;

export function EmailLayout({ content, logoUrl }: EmailLayoutProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{content.subject}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Img
            src={logoUrl}
            alt="BTS Logistique"
            width={LOGO_SIZE_PX}
            height={LOGO_SIZE_PX}
            style={{ margin: '0 0 24px' }}
          />
          {content.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          <Section style={{ margin: '8px 0' }}>
            <Button href={content.button.url} style={styles.button}>
              {content.button.label}
            </Button>
          </Section>
          {content.footnote && <Text style={styles.footnote}>{content.footnote}</Text>}
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0 16px' }} />
          <Text style={styles.footer}>
            BTS Logistique, transport de colis vers l’Afrique de l’Ouest. Cet e-mail vous est envoyé
            automatiquement, merci de ne pas y répondre.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
