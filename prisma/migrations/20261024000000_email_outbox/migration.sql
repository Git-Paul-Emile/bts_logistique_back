-- Boîte d'envoi des e-mails (F10) : les e-mails sont inscrits dans la transaction de l'action
-- qui les déclenche, puis envoyés par le répartiteur avec reprises.
-- Retour arrière : DROP TABLE "email_outbox"; DROP TYPE "email_outbox_status"; DROP TYPE "email_kind";

-- CreateEnum
CREATE TYPE "email_kind" AS ENUM ('password_reset', 'invitation', 'email_change', 'package_registered', 'package_status');

-- CreateEnum
CREATE TYPE "email_outbox_status" AS ENUM ('pending', 'sending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "kind" "email_kind" NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "payload" JSONB,
    "status" "email_outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "provider_message_id" VARCHAR(255),
    "notification_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_provider_message_id_key" ON "email_outbox"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_notification_id_key" ON "email_outbox"("notification_id");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes CHECK, que Prisma ne sait pas décrire.
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_attempts_not_negative" CHECK ("attempts" >= 0),
  -- Un e-mail encore à envoyer garde ses données ; un e-mail terminé n'en garde aucune.
  ADD CONSTRAINT "email_outbox_payload_lifecycle" CHECK (
    ("status" IN ('pending', 'sending') AND "payload" IS NOT NULL)
    OR ("status" IN ('sent', 'failed') AND "payload" IS NULL)
  ),
  ADD CONSTRAINT "email_outbox_recipient_normalized" CHECK ("recipient" = lower(btrim("recipient")));
