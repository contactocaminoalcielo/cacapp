-- ============================================================================
-- 007 — Tenjo: fecha objetivo de reprogramación
-- Fecha: 2026-06-18
--
-- Aditivo y re-ejecutable. Agrega a lotes_tenjo_items la jornada futura a la
-- que apunta una reprogramación, para dar trazabilidad ("¿para cuándo se
-- reprogramó?"). La columna es opcional; la mascota sigue volviendo al pool
-- de candidatas, pero ahora con la fecha objetivo registrada y visible.
--
-- Aplicar en VPS Contabo:
--   cat migrations/007_tenjo_reprogramacion_y_control.sql | docker compose exec -T db psql -U postgres -d postgres
-- ============================================================================

ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS fecha_reprogramacion_objetivo date;

-- ============================================================================
-- ROLLBACK:
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS fecha_reprogramacion_objetivo;
-- ============================================================================
