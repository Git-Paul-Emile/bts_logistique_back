-- Migration initiale : modèle complet des fonctionnalités F1 à F13.
-- Retour arrière : cette migration crée la base à partir de rien. Pour l'annuler sur un poste
-- de développement, utiliser `npx prisma migrate reset`. En production, elle n'est jamais
-- annulée : une correction passe par une nouvelle migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'manager', 'collector');

-- CreateEnum
CREATE TYPE "user_token_purpose" AS ENUM ('invitation', 'password_reset', 'email_change');

-- CreateEnum
CREATE TYPE "transport_mode" AS ENUM ('sea', 'air');

-- CreateEnum
CREATE TYPE "package_status" AS ENUM ('registered', 'in_transit', 'arrived', 'delivered', 'returned', 'on_hold', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('unpaid', 'partial', 'paid');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'transfer', 'mobile_money', 'other');

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('planned', 'loading', 'in_transit', 'customs', 'arrived', 'unloaded');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('package', 'payment', 'email');

-- CreateEnum
CREATE TYPE "email_delivery_status" AS ENUM ('queued', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "is_origin" BOOLEAN NOT NULL DEFAULT false,
    "is_destination" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "location_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(30),
    "role" "user_role" NOT NULL,
    "agency_id" UUID NOT NULL,
    "password_hash" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "user_token_purpose" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "new_email" VARCHAR(254),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rates" (
    "id" UUID NOT NULL,
    "transport_mode" "transport_mode" NOT NULL,
    "client_rate_per_cbm" DECIMAL(12,2) NOT NULL,
    "collector_margin_per_cbm" DECIMAL(12,2) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(254),
    "address" VARCHAR(255),
    "agency_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "tracking_number" VARCHAR(32) NOT NULL,
    "client_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "collector_id" UUID,
    "shipment_id" UUID,
    "description" VARCHAR(500),
    "transport_mode" "transport_mode" NOT NULL DEFAULT 'sea',
    "origin_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "length_cm" DECIMAL(8,2) NOT NULL,
    "width_cm" DECIMAL(8,2) NOT NULL,
    "height_cm" DECIMAL(8,2) NOT NULL,
    "weight_kg" DECIMAL(10,2) NOT NULL,
    "cubic_meter" DECIMAL(10,4) NOT NULL,
    "rate_per_cbm" DECIMAL(12,2) NOT NULL,
    "final_price" DECIMAL(12,2) NOT NULL,
    "collector_margin" DECIMAL(12,2) NOT NULL,
    "status" "package_status" NOT NULL DEFAULT 'registered',
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" "payment_status" NOT NULL DEFAULT 'unpaid',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_events" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "status" "package_status" NOT NULL,
    "location_id" UUID,
    "location_detail" VARCHAR(120),
    "comment" VARCHAR(500),
    "agent_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" VARCHAR(80),
    "notes" VARCHAR(500),
    "author_id" UUID NOT NULL,
    "reverses_payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "container_number" VARCHAR(40) NOT NULL,
    "transport_mode" "transport_mode" NOT NULL,
    "carrier" VARCHAR(80) NOT NULL,
    "origin_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "status" "shipment_status" NOT NULL DEFAULT 'planned',
    "max_volume_cbm" DECIMAL(10,2) NOT NULL,
    "departure_date" DATE,
    "estimated_arrival" DATE,
    "actual_arrival" DATE,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "category" "notification_category" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "package_id" UUID,
    "delivery_status" "email_delivery_status",
    "provider_message_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "recipient_name" VARCHAR(160) NOT NULL,
    "destination" VARCHAR(120) NOT NULL,
    "length_cm" DECIMAL(8,2) NOT NULL,
    "width_cm" DECIMAL(8,2) NOT NULL,
    "height_cm" DECIMAL(8,2) NOT NULL,
    "weight_kg" DECIMAL(10,2) NOT NULL,
    "cubic_meter" DECIMAL(10,4) NOT NULL,
    "rate_per_cbm" DECIMAL(12,2) NOT NULL,
    "final_price" DECIMAL(12,2) NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_fingerprints" (
    "id" UUID NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "fingerprint" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(60) NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "resource_id" VARCHAR(64) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_code_key" ON "agencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_name_key" ON "agencies"("name");

-- CreateIndex
CREATE INDEX "agencies_location_id_idx" ON "agencies"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE INDEX "users_agency_id_idx" ON "users"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_purpose_idx" ON "user_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "pricing_rates_transport_mode_effective_from_idx" ON "pricing_rates"("transport_mode", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "clients"("phone");

-- CreateIndex
CREATE INDEX "clients_email_idx" ON "clients"("email");

-- CreateIndex
CREATE INDEX "clients_name_idx" ON "clients"("name");

-- CreateIndex
CREATE INDEX "clients_agency_id_idx" ON "clients"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tracking_number_key" ON "packages"("tracking_number");

-- CreateIndex
CREATE INDEX "packages_client_id_idx" ON "packages"("client_id");

-- CreateIndex
CREATE INDEX "packages_shipment_id_idx" ON "packages"("shipment_id");

-- CreateIndex
CREATE INDEX "packages_collector_id_idx" ON "packages"("collector_id");

-- CreateIndex
CREATE INDEX "packages_origin_id_idx" ON "packages"("origin_id");

-- CreateIndex
CREATE INDEX "packages_destination_id_idx" ON "packages"("destination_id");

-- CreateIndex
CREATE INDEX "packages_agency_id_created_at_idx" ON "packages"("agency_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "packages_status_created_at_idx" ON "packages"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "packages_payment_status_idx" ON "packages"("payment_status");

-- CreateIndex
CREATE INDEX "packages_created_at_idx" ON "packages"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "packages_id_client_id_key" ON "packages"("id", "client_id");

-- CreateIndex
CREATE INDEX "package_events_package_id_created_at_idx" ON "package_events"("package_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "package_events_location_id_idx" ON "package_events"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reverses_payment_id_key" ON "payments"("reverses_payment_id");

-- CreateIndex
CREATE INDEX "payments_client_id_created_at_idx" ON "payments"("client_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_method_created_at_idx" ON "payments"("method", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_client_id_key" ON "payments"("id", "client_id");

-- CreateIndex
CREATE INDEX "payment_allocations_package_id_idx" ON "payment_allocations"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_package_id_key" ON "payment_allocations"("payment_id", "package_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_container_number_key" ON "shipments"("container_number");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_origin_id_idx" ON "shipments"("origin_id");

-- CreateIndex
CREATE INDEX "shipments_destination_id_idx" ON "shipments"("destination_id");

-- CreateIndex
CREATE INDEX "shipments_created_at_idx" ON "shipments"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_provider_message_id_key" ON "notifications"("provider_message_id");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_category_created_at_idx" ON "notifications"("category", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_package_id_idx" ON "notifications"("package_id");

-- CreateIndex
CREATE INDEX "notification_reads_user_id_idx" ON "notification_reads"("user_id");

-- CreateIndex
CREATE INDEX "quotes_created_at_idx" ON "quotes"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "import_fingerprints_entity_fingerprint_key" ON "import_fingerprints"("entity", "fingerprint");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rates" ADD CONSTRAINT "pricing_rates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_client_id_fkey" FOREIGN KEY ("payment_id", "client_id") REFERENCES "payments"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_package_id_client_id_fkey" FOREIGN KEY ("package_id", "client_id") REFERENCES "packages"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==================== CONTRAINTES CHECK ====================
-- Ajoutées à la main : Prisma ne sait pas les décrire dans le schéma.

-- Adresses de connexion normalisées : l'unicité ignore ainsi la casse et les espaces.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email")));

-- La nouvelle adresse n'existe que pour un changement d'e-mail, et elle est normalisée.
ALTER TABLE "user_tokens"
  ADD CONSTRAINT "user_tokens_new_email_purpose" CHECK (("purpose" = 'email_change') = ("new_email" IS NOT NULL)),
  ADD CONSTRAINT "user_tokens_new_email_normalized" CHECK ("new_email" IS NULL OR "new_email" = lower(btrim("new_email")));

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_country_code_format" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "locations_has_role" CHECK ("is_origin" OR "is_destination");

ALTER TABLE "pricing_rates"
  ADD CONSTRAINT "pricing_rates_client_rate_positive" CHECK ("client_rate_per_cbm" > 0),
  ADD CONSTRAINT "pricing_rates_margin_range" CHECK ("collector_margin_per_cbm" >= 0 AND "collector_margin_per_cbm" < "client_rate_per_cbm");

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_route_distinct" CHECK ("origin_id" <> "destination_id"),
  ADD CONSTRAINT "packages_dimensions_positive" CHECK ("length_cm" > 0 AND "width_cm" > 0 AND "height_cm" > 0 AND "weight_kg" > 0),
  ADD CONSTRAINT "packages_cubic_meter_positive" CHECK ("cubic_meter" > 0),
  ADD CONSTRAINT "packages_prices_not_negative" CHECK ("rate_per_cbm" >= 0 AND "final_price" >= 0),
  ADD CONSTRAINT "packages_margin_range" CHECK ("collector_margin" >= 0 AND "collector_margin" <= "final_price"),
  ADD CONSTRAINT "packages_amount_paid_not_negative" CHECK ("amount_paid" >= 0);

-- Un paiement est positif ; une écriture d'annulation est négative et pointe vers le paiement annulé.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_sign" CHECK (
    ("reverses_payment_id" IS NULL AND "amount" > 0)
    OR ("reverses_payment_id" IS NOT NULL AND "amount" < 0)
  ),
  ADD CONSTRAINT "payments_not_self_reversal" CHECK ("reverses_payment_id" IS NULL OR "reverses_payment_id" <> "id");

-- Le signe d'une part suit celui du paiement, et leur somme égale son montant : vérifié par le
-- service, car ces règles portent sur plusieurs lignes.
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_not_zero" CHECK ("amount" <> 0);

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_route_distinct" CHECK ("origin_id" <> "destination_id"),
  ADD CONSTRAINT "shipments_capacity_positive" CHECK ("max_volume_cbm" > 0),
  ADD CONSTRAINT "shipments_arrival_after_departure" CHECK (
    "departure_date" IS NULL OR "estimated_arrival" IS NULL OR "estimated_arrival" >= "departure_date"
  );

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_measures_positive" CHECK ("length_cm" > 0 AND "width_cm" > 0 AND "height_cm" > 0 AND "weight_kg" > 0 AND "cubic_meter" > 0),
  ADD CONSTRAINT "quotes_prices_not_negative" CHECK ("rate_per_cbm" >= 0 AND "final_price" >= 0);
