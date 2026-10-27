-- Décision D6 (23/10/2026) : le calculateur de devis et l'historique des calculs sont retirés,
-- car le cahier des charges ne les demande pas. Le prix d'un colis est calculé à son
-- enregistrement (F6) et le site public garde son simulateur (F4).
-- Retour arrière : recréer la table "quotes" telle que décrite dans 20261022000000_init.

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_author_id_fkey";

-- DropTable
DROP TABLE "quotes";
