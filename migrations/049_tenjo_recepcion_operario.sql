-- 049_tenjo_recepcion_operario.sql
-- Recepción en planta por el operario de Tenjo.
--
-- Problema: cuando el lote llega a Tenjo nadie "recibe" formalmente. El operario
-- saltaba directo de AUTORIZADA_SALIDA/EN_TRASLADO a "Iniciar proceso", sin que
-- quedara rastro de la hora real de llegada a la planta, de quién recibió, ni de
-- si llegó todo lo que salió (faltantes / novedades). Es el equivalente, en
-- Tenjo, del "Confirmar llegada" del técnico (migración 045) y del ingreso real
-- a la nevera (migración 046).
--
-- Solución: paso de RECEPCIÓN por mascota. El operario recibe cada mascotica
-- (o "Recibir todas"), lo que sella hora + responsable, cierra la custodia del
-- cuarto frío (idempotente) y completa el traslado. La recepción es COMPUERTA:
-- "Iniciar proceso" solo se habilita cuando el item quedó RECIBIDA.
--   - recepcion_estado = 'RECIBIDA' → llegó bien, avanza el flujo.
--   - recepcion_estado = 'NOVEDAD'  → llegó pero con novedad (detalle en la nota); igual avanza.
--   - recepcion_estado = 'NO_LLEGO' → no llegó a la planta; NO avanza (el item.estado
--                                     se queda como estaba) y queda pendiente para el cierre del lote.
--
-- Todo NULLABLE y aditivo: los lotes/traslados en curso siguen funcionando.
-- fecha_recepcion es timestamptz (instante exacto, como fecha_ingreso_real).

-- ─── 1. Recepción en los items del lote (flujo Jornada) ──────────────────────
ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS fecha_recepcion   timestamptz,
  ADD COLUMN IF NOT EXISTS recibido_por      uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS recepcion_estado  varchar
    CHECK (recepcion_estado IN ('RECIBIDA','NOVEDAD','NO_LLEGO')),
  ADD COLUMN IF NOT EXISTS recepcion_novedad text;

COMMENT ON COLUMN public.lotes_tenjo_items.fecha_recepcion IS
  'Instante real en que el operario recibió la mascota en la planta de Tenjo.';
COMMENT ON COLUMN public.lotes_tenjo_items.recibido_por IS
  'Operario que recibió la mascota en Tenjo.';
COMMENT ON COLUMN public.lotes_tenjo_items.recepcion_estado IS
  'RECIBIDA | NOVEDAD (llegó con novedad) | NO_LLEGO (no llegó a la planta). NULL = sin recibir.';
COMMENT ON COLUMN public.lotes_tenjo_items.recepcion_novedad IS
  'Detalle de la novedad de recepción o motivo de no llegada.';

-- ─── 2. Recepción en los traslados individuales (pestaña Operación) ──────────
ALTER TABLE public.traslados_tenjo
  ADD COLUMN IF NOT EXISTS fecha_recepcion   timestamptz,
  ADD COLUMN IF NOT EXISTS recibido_por      uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS recepcion_novedad text;

COMMENT ON COLUMN public.traslados_tenjo.fecha_recepcion IS
  'Instante real en que el operario recibió el traslado individual en la planta de Tenjo.';
COMMENT ON COLUMN public.traslados_tenjo.recibido_por IS
  'Operario que recibió el traslado individual en Tenjo.';
COMMENT ON COLUMN public.traslados_tenjo.recepcion_novedad IS
  'Novedad registrada al recibir el traslado individual (opcional).';

-- GRANTs: lotes_tenjo_items y traslados_tenjo tienen los privilegios a nivel de
-- TABLA (no por columna), así que las columnas nuevas quedan cubiertas. RLS ya
-- activo con la policy auth_full (ALL, authenticated) — el OPERARIO puede recibir.

-- Verificación:
--   select id, estado, recepcion_estado, fecha_recepcion, recibido_por
--     from lotes_tenjo_items where recepcion_estado is not null order by fecha_recepcion desc limit 10;
--   select id, estado, fecha_recepcion, recibido_por
--     from traslados_tenjo where fecha_recepcion is not null order by fecha_recepcion desc limit 10;

-- ROLLBACK:
--   ALTER TABLE public.lotes_tenjo_items
--     DROP COLUMN IF EXISTS fecha_recepcion, DROP COLUMN IF EXISTS recibido_por,
--     DROP COLUMN IF EXISTS recepcion_estado, DROP COLUMN IF EXISTS recepcion_novedad;
--   ALTER TABLE public.traslados_tenjo
--     DROP COLUMN IF EXISTS fecha_recepcion, DROP COLUMN IF EXISTS recibido_por,
--     DROP COLUMN IF EXISTS recepcion_novedad;
