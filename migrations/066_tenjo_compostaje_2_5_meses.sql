-- 066_tenjo_compostaje_2_5_meses.sql
-- Tenjo: permitir 2.5 meses de compostaje (punto intermedio entre 2 y 3).
--
-- La migración 050 fijó meses_compostaje como smallint con CHECK IN (2, 3).
-- David pidió un valor intermedio (2 meses y medio). Se cambia la columna a
-- numeric(3,1) y el CHECK a IN (2, 2.5, 3). El cálculo de "compostaje listo"
-- (lib/tenjo.js sumarMeses / finCompostaje) trata el medio mes como ~15 días.
--
-- Aditivo y re-ejecutable. Los datos existentes (todos 2 o 3) siguen válidos.

BEGIN;

-- El CHECK viejo (nombre autogenerado por el inline de la 050) rechazaría 2.5.
ALTER TABLE public.lotes_tenjo_items
  DROP CONSTRAINT IF EXISTS lotes_tenjo_items_meses_compostaje_check;

ALTER TABLE public.lotes_tenjo_items
  ALTER COLUMN meses_compostaje TYPE numeric(3,1) USING meses_compostaje::numeric(3,1);

ALTER TABLE public.lotes_tenjo_items
  ALTER COLUMN meses_compostaje SET DEFAULT 2;

ALTER TABLE public.lotes_tenjo_items
  ADD CONSTRAINT lotes_tenjo_items_meses_compostaje_check
  CHECK (meses_compostaje IN (2, 2.5, 3));

COMMENT ON COLUMN public.lotes_tenjo_items.meses_compostaje IS
  'Duración del compostaje en meses (2, 2.5 o 3), decidida por el operario al finalizar. Fecha de listo = fecha_compostaje_inicio + meses_compostaje (½ mes ≈ 15 días).';

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Solo si NO hay filas con 2.5 (si las hay, primero migrarlas a 2 o 3):
-- BEGIN;
--   ALTER TABLE public.lotes_tenjo_items DROP CONSTRAINT IF EXISTS lotes_tenjo_items_meses_compostaje_check;
--   ALTER TABLE public.lotes_tenjo_items ALTER COLUMN meses_compostaje TYPE smallint USING meses_compostaje::smallint;
--   ALTER TABLE public.lotes_tenjo_items ADD CONSTRAINT lotes_tenjo_items_meses_compostaje_check CHECK (meses_compostaje IN (2, 3));
-- COMMIT;
