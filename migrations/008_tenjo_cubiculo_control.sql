-- ============================================================================
-- 008 — Tenjo: cubiculo de compostaje + control de procesos
-- Fecha: 2026-06-24
--
-- Agrega a lotes_tenjo_items (unica fuente de verdad del flujo de lotes) las
-- columnas que captura el operario de planta al finalizar el proceso:
--   - cubiculo_codigo        — cubiculo donde quedo la mascota de compostaje
--   - fecha_compostaje_inicio — fecha de ingreso al cubiculo (conteo +2 meses)
--
-- La fecha real de cremacion / fin de proceso ya vive en fecha_fin_proceso.
-- La pestana Control deriva los plazos:
--   cenizas listas   = fecha_fin_proceso + 5 dias calendario   (cremacion)
--   compostaje listo = fecha_compostaje_inicio + 2 meses        (compostaje)
--
-- Todo aditivo y re-ejecutable (IF NOT EXISTS). No requiere GRANTs nuevos:
-- la policy "auth_full" y GRANT ALL ... authenticated de la migracion 003
-- ya cubren columnas nuevas de la tabla.
--
-- Aplicar en VPS Contabo (archivo completo):
--   cat 008_tenjo_cubiculo_control.sql | docker compose exec -T db psql -U postgres -d postgres
-- ============================================================================

ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS cubiculo_codigo        text,
  ADD COLUMN IF NOT EXISTS fecha_compostaje_inicio date;

COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_codigo IS
  'Cubiculo donde quedo la mascota de compostaje individual (capturado por el operario al finalizar).';
COMMENT ON COLUMN public.lotes_tenjo_items.fecha_compostaje_inicio IS
  'Fecha de ingreso al cubiculo; base para el conteo de +2 meses hasta compostaje listo.';

-- ============================================================================
-- ROLLBACK:
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS fecha_compostaje_inicio;
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS cubiculo_codigo;
-- ============================================================================
