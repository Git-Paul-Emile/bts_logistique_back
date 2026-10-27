-- Fige sur chaque colis le taux de marge collecteur au m³ en vigueur à son enregistrement :
-- la marge est recalculée avec ce taux si les dimensions du colis sont corrigées (F6).
-- Retour arrière : ALTER TABLE "packages" DROP COLUMN "collector_margin_per_cbm";

-- 1. Colonne ajoutée sans contrainte, pour ne pas échouer sur une table déjà remplie.
ALTER TABLE "packages" ADD COLUMN "collector_margin_per_cbm" DECIMAL(12,2);

-- 2. Colis existants : taux retrouvé à partir de leur marge et de leur volume, déjà figés.
UPDATE "packages"
SET "collector_margin_per_cbm" = ROUND("collector_margin" / "cubic_meter", 2)
WHERE "collector_margin_per_cbm" IS NULL;

-- 3. Contraintes définitives.
ALTER TABLE "packages" ALTER COLUMN "collector_margin_per_cbm" SET NOT NULL;
ALTER TABLE "packages"
  ADD CONSTRAINT "packages_margin_rate_not_negative" CHECK ("collector_margin_per_cbm" >= 0);
