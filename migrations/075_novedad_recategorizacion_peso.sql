-- ============================================================================
-- 075 — Nuevo tipo de novedad: RECATEGORIZACION_PESO
-- ----------------------------------------------------------------------------
-- David (2026-07-23): mostrar una etiqueta en las mascotas que fueron
-- recategorizadas por plan o por peso, para estar alerta del cambio.
--
-- El cambio de PLAN ya deja rastro (novedad tipo CAMBIO_PLAN). El recálculo por
-- PESO (aplicarRecalculoPorPeso) cambiaba el precio EN SILENCIO, sin novedad, así
-- que no había cómo detectarlo. Se añade el tipo RECATEGORIZACION_PESO al CHECK
-- para que el recálculo deje su propia novedad (y la etiqueta lo pueda leer).
--
-- Solo extiende la lista de valores permitidos; no toca datos.
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.novedades_servicio
  DROP CONSTRAINT IF EXISTS novedades_servicio_tipo_novedad_check;

ALTER TABLE public.novedades_servicio
  ADD CONSTRAINT novedades_servicio_tipo_novedad_check
  CHECK (tipo_novedad::text = ANY (ARRAY[
    'CAMBIO_ESTADO', 'CAMBIO_PLAN', 'CAMBIO_FLUJO', 'ITEM_ADICIONAL',
    'ITEM_REMOVIDO', 'CAMBIO_ACOMPANAMIENTO', 'DESCUENTO', 'PAGO_RECIBIDO',
    'NOTA', 'RECATEGORIZACION_PESO'
  ]));

COMMIT;
