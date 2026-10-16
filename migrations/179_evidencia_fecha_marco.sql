-- ============================================================================
-- 179 — Fecha editable en el marco de las evidencias (sobre la 178)
-- Fecha: 2026-10-16
--
-- El marco ponía siempre la fecha en que el operario inició el proceso en
-- Orbit. Coordinación necesita poder corregirla: a veces el proceso se
-- registra en Orbit un día distinto del que se hizo en la planta.
--
-- Columna aparte y no encima de `fecha_inicio`: esa es el dato del proceso y
-- no se toca. NULL = se usa `fecha_inicio`.
--
-- Ejecutar por SSH→psql en Contabo. Reversible: ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.evidencias_familia
  ADD COLUMN IF NOT EXISTS fecha_marco date;

COMMENT ON COLUMN public.evidencias_familia.fecha_marco IS
  'Fecha que se imprime en el marco, si coordinación la cambió. NULL = la de fecha_inicio.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   ALTER TABLE public.evidencias_familia DROP COLUMN IF EXISTS fecha_marco;
