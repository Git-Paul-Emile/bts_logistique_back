// Données de démonstration pour la base de développement : comptes de chaque rôle, grille
// tarifaire, clients, colis à différentes étapes, paiements et conteneurs.
// Usage, sur une base vide (après `npm run db:seed`) : npm run db:seed:demo
// Tout passe par les services du back : prix, marges, numéros de suivi, notifications et
// e-mails sont produits exactement comme dans l'application. Refusé en production.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { env } from '../src/config/env.js';
import type { PackageStatus, UserRole } from '../src/generated/prisma/enums.js';
import type { Viewer } from '../src/features/auth/auth.service.js';
import { clientsService } from '../src/features/clients/clients.service.js';
import { packagesService } from '../src/features/packages/packages.service.js';
import { paymentsService } from '../src/features/payments/payments.service.js';
import { pricingService } from '../src/features/pricing/pricing.service.js';
import { shipmentsService } from '../src/features/shipments/shipments.service.js';
import { usersRepository } from '../src/features/users/users.repository.js';
import { passwordHasher } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';

/** Fichier des accès, ignoré par Git : les mots de passe ne s'affichent jamais dans le terminal. */
const ACCOUNTS_FILE = new URL('../.dev-accounts.txt', import.meta.url);
const PASSWORD_BYTES = 12;
/**
 * Adresse de test de Resend : l'envoi est simulé comme « délivré », sans atteindre personne ni
 * nuire à la réputation du domaine d'envoi.
 */
const TEST_INBOX = 'delivered@resend.dev';

const ACCOUNTS: { name: string; email: string; role: UserRole; agency: string }[] = [
  { name: 'Admin Démo', email: 'admin@bts-dev.test', role: 'admin', agency: 'CI-ABJ' },
  {
    name: 'Gestionnaire Démo',
    email: 'gestionnaire@bts-dev.test',
    role: 'manager',
    agency: 'CI-ABJ',
  },
  {
    name: 'Collecteur Guangzhou',
    email: 'collecteur.guangzhou@bts-dev.test',
    role: 'collector',
    agency: 'CN-CAN',
  },
  {
    name: 'Collecteur Dubaï',
    email: 'collecteur.dubai@bts-dev.test',
    role: 'collector',
    agency: 'AE-DXB',
  },
];

async function createAccounts(): Promise<Map<UserRole | string, Viewer>> {
  const viewers = new Map<string, Viewer>();
  const lines = ['Comptes de démonstration (base de développement uniquement)', ''];
  for (const account of ACCOUNTS) {
    const agency = await usersRepository.findAgencyIdByCode(account.agency);
    if (!agency)
      throw new Error(`Agence ${account.agency} absente : lancez d’abord npm run db:seed.`);
    const password = randomBytes(PASSWORD_BYTES).toString('base64url');
    const user = await usersRepository.create({
      name: account.name,
      email: account.email,
      role: account.role,
      agencyId: agency.id,
      passwordHash: await passwordHasher.hash(password),
    });
    viewers.set(account.email, { userId: user.id, role: account.role, agencyId: agency.id });
    lines.push(`${account.role.padEnd(10)} ${account.email}  ${password}`);
  }
  writeFileSync(ACCOUNTS_FILE, `${lines.join('\n')}\n`);
  return viewers;
}

/**
 * Clients enregistrés par les collecteurs, donc rattachés à leur agence : un collecteur ne voit
 * que les clients et les colis de son agence.
 */
async function createClients(guangzhou: Viewer, dubai: Viewer) {
  const create = (viewer: Viewer, name: string, phone: string, email: string | null) =>
    clientsService.create(viewer, { name, phone, email, address: null });
  return {
    electro: await create(guangzhou, 'Électro Abidjan SARL', '+225 07 48 92 10 33', TEST_INBOX),
    cosmetiques: await create(
      guangzhou,
      'Awa Sanogo Cosmétiques',
      '+225 05 88 14 20 01',
      TEST_INBOX
    ),
    quincaillerie: await create(guangzhou, 'Quincaillerie du Fleuve', '+223 66 12 45 78', null),
    textile: await create(dubai, 'Boutique Touba Textile', '+221 77 654 32 10', TEST_INBOX),
    pieces: await create(dubai, 'Pièces Auto Dakar', '+221 76 300 11 22', null),
  };
}

type PackageInput = Parameters<typeof packagesService.register>[1];

function parcel(
  clientId: string,
  route: [string, string],
  mode: 'sea' | 'air',
  size: [number, number, number, number],
  description: string
): PackageInput {
  const [length_cm, width_cm, height_cm, weight_kg] = size;
  return {
    client_id: clientId,
    origin_code: route[0],
    destination_code: route[1],
    transport_mode: mode,
    description,
    length_cm,
    width_cm,
    height_cm,
    weight_kg,
  };
}

async function advance(viewer: Viewer, id: string, steps: [PackageStatus, string][]) {
  for (const [status, location] of steps) {
    await packagesService.addEvent(viewer, id, {
      status,
      location,
      comment: null,
      notify_client: true,
    });
  }
}

async function main() {
  if (env.NODE_ENV === 'production')
    throw new Error('Données de démonstration refusées en production.');
  if ((await prisma.user.count()) > 0) {
    throw new Error('La base contient déjà des comptes : videz-la d’abord (prisma migrate reset).');
  }

  const viewers = await createAccounts();
  const admin = viewers.get('admin@bts-dev.test') as Viewer;
  const manager = viewers.get('gestionnaire@bts-dev.test') as Viewer;
  const guangzhou = viewers.get('collecteur.guangzhou@bts-dev.test') as Viewer;
  const dubai = viewers.get('collecteur.dubai@bts-dev.test') as Viewer;

  await pricingService.update(
    {
      rates: {
        sea: { client_rate_per_cbm: 380_000, collector_margin_per_cbm: 30_000 },
        air: { client_rate_per_cbm: 750_000, collector_margin_per_cbm: 50_000 },
      },
    },
    admin.userId
  );

  const clients = await createClients(guangzhou, dubai);

  // Colis enregistrés par les collecteurs (leur marge apparaît sur leur tableau de bord).
  const delivered = await packagesService.register(
    guangzhou,
    parcel(
      clients.electro.id,
      ['CN-CAN', 'CI-ABJ'],
      'sea',
      [120, 80, 100, 145],
      'Composants électroniques'
    )
  );
  const arrived = await packagesService.register(
    guangzhou,
    parcel(
      clients.electro.id,
      ['CN-CAN', 'CI-ABJ'],
      'sea',
      [200, 60, 80, 110],
      'Écrans LED industriels'
    )
  );
  const inTransit = await packagesService.register(
    dubai,
    parcel(clients.textile.id, ['AE-DXB', 'SN-DKR'], 'air', [90, 70, 60, 68], 'Tissus wax')
  );
  const onHold = await packagesService.register(
    dubai,
    parcel(clients.pieces.id, ['AE-DXB', 'SN-DKR'], 'air', [60, 40, 40, 35], 'Pièces détachées')
  );
  const toLoadA = await packagesService.register(
    guangzhou,
    parcel(clients.cosmetiques.id, ['CN-CAN', 'CI-ABJ'], 'sea', [100, 80, 70, 90], 'Cosmétiques')
  );
  const toLoadB = await packagesService.register(
    guangzhou,
    parcel(clients.quincaillerie.id, ['CN-CAN', 'CI-ABJ'], 'sea', [150, 100, 90, 210], 'Outillage')
  );
  const registered = await packagesService.register(
    manager,
    parcel(
      clients.quincaillerie.id,
      ['TR-IST', 'ML-BKO'],
      'sea',
      [80, 60, 50, 25],
      'Pièces mécaniques'
    )
  );

  await advance(admin, delivered.id, [
    ['in_transit', 'Port de Nansha, Guangzhou'],
    ['arrived', 'Entrepôt BTS Abidjan'],
    ['delivered', 'Abidjan, remis au client'],
  ]);
  await advance(manager, arrived.id, [
    ['in_transit', 'Port de Nansha, Guangzhou'],
    ['arrived', 'Entrepôt BTS Abidjan'],
  ]);
  await advance(manager, inTransit.id, [['in_transit', 'Aéroport de Dubaï (DXB)']]);
  await advance(manager, onHold.id, [['on_hold', 'Douane de Dakar']]);

  // Paiements : soldé, partiel, et un versement réparti sur deux colis du même client.
  const pay = (
    clientId: string,
    parts: { package_id: string; amount: number }[],
    method: 'cash' | 'mobile_money' | 'transfer'
  ) =>
    paymentsService.record(manager, {
      client_id: clientId,
      amount: parts.reduce((sum, part) => sum + part.amount, 0),
      method,
      reference: null,
      notes: null,
      allocations: parts,
    });
  await pay(
    clients.electro.id,
    [
      { package_id: delivered.id, amount: delivered.final_price },
      { package_id: arrived.id, amount: Math.round(arrived.final_price / 2) },
    ],
    'transfer'
  );
  await pay(
    clients.textile.id,
    [{ package_id: inTransit.id, amount: inTransit.final_price }],
    'mobile_money'
  );
  await pay(clients.cosmetiques.id, [{ package_id: toLoadA.id, amount: 50_000 }], 'cash');
  // Quincaillerie du Fleuve et Pièces Auto Dakar restent sans paiement : clients en rouge.

  const loading = await shipmentsService.create({
    container_number: 'MSKU-998811-4',
    transport_mode: 'sea',
    carrier: 'Maersk',
    origin_code: 'CN-CAN',
    destination_code: 'CI-ABJ',
    max_volume_cbm: 68,
    departure_date: null,
    estimated_arrival: null,
    notes: 'Groupage de démonstration',
  });
  await shipmentsService.assignPackages(loading.id, { package_ids: [toLoadA.id, toLoadB.id] });
  await shipmentsService.changeStatus(loading.id, { status: 'loading' });
  await shipmentsService.create({
    container_number: 'EK-9781',
    transport_mode: 'air',
    carrier: 'Emirates SkyCargo',
    origin_code: 'AE-DXB',
    destination_code: 'SN-DKR',
    max_volume_cbm: 15,
    departure_date: null,
    estimated_arrival: null,
    notes: null,
  });

  process.stdout.write(
    `Démonstration prête : ${ACCOUNTS.length} comptes, 5 clients, 7 colis (dont ${registered.tracking_number}), 3 paiements, 2 conteneurs.\n` +
      'Accès des comptes : back/.dev-accounts.txt\n'
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
