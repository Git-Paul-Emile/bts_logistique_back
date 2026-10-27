-- Nouveau type d'e-mail : le lien de suivi renvoyé au client depuis la fiche d'un colis.
-- Retour arrière : PostgreSQL ne retire pas une valeur d'énumération ; il faudrait recréer le
-- type sans elle, après s'être assuré qu'aucune ligne de email_outbox ne l'utilise.

-- AlterEnum
ALTER TYPE "email_kind" ADD VALUE 'tracking_link';
