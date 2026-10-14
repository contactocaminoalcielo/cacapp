-- 175_afiliaciones_motivo_cancelacion.sql
--
-- POR QUÉ SE CANCELÓ UN PLAN PRE-EXEQUIAL.
--
-- Pedido de coordinación el 2026-10-14: «el cliente no quiere renovar porque se
-- mudó de ciudad — dejar la novedad». Hasta hoy cancelar era un UPDATE de
-- `estado` a secas: sin fecha, sin quién, sin motivo. Al 14-oct hay 92
-- contratos CANCELADOS y de ninguno se sabe si se fue el cliente o si el job
-- de vencimientos lo cerró por no pagar.
--
-- Las cancelaciones llegan por TRES caminos y los tres tienen que quedar
-- iguales de bien registrados:
--   1. Coordinación cancela el contrato (Pre-exequiales › ficha › Cancelar).
--   2. Coordinación retira la última mascota viva (el contrato cae con ella).
--   3. El job de orbit-backend (07:00) cancela por vencimiento + gracia.
-- Por eso el sello va en un TRIGGER y no en el frontend: el job (3) no pasa
-- por la pantalla, y sin trigger esas cancelaciones seguirían saliendo mudas.
--
-- Todo aditivo y re-ejecutable. Los 92 históricos se quedan sin motivo: no
-- hay de dónde sacarlo, y la pantalla los muestra como «sin motivo registrado».

BEGIN;

ALTER TABLE public.afiliaciones
  ADD COLUMN IF NOT EXISTS cancelada_en        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por       uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS motivo_cancelacion  text,
  ADD COLUMN IF NOT EXISTS detalle_cancelacion text;

COMMENT ON COLUMN public.afiliaciones.motivo_cancelacion IS
  'Por qué se canceló. Catálogo en src/lib/afiliaciones.js (MOTIVOS_CANCELACION). VENCIMIENTO = lo cerró el job por no renovar dentro de la gracia. NULL en las canceladas antes de la migración 175.';
COMMENT ON COLUMN public.afiliaciones.detalle_cancelacion IS
  'Lo que contó el cliente, en palabras de coordinación (p. ej. a qué ciudad se mudó).';

-- ── El sello ────────────────────────────────────────────────────────────────
-- · Entra a CANCELADA → fecha siempre; motivo VENCIMIENTO si nadie puso otro
--   (es el job: la pantalla siempre manda motivo).
-- · Sale de CANCELADA (Reactivar) → se limpia. El rastro de la reactivación ya
--   queda en `notas`; dejar el motivo viejo haría que, si el job la vuelve a
--   cancelar un año después, saliera con el motivo de la primera vez.
CREATE OR REPLACE FUNCTION public.fn_afiliacion_sello_cancelacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'CANCELADA' AND OLD.estado IS DISTINCT FROM 'CANCELADA' THEN
    NEW.cancelada_en       := COALESCE(NEW.cancelada_en, now());
    NEW.motivo_cancelacion := COALESCE(NEW.motivo_cancelacion, 'VENCIMIENTO');
  ELSIF OLD.estado = 'CANCELADA' AND NEW.estado IS DISTINCT FROM 'CANCELADA' THEN
    NEW.cancelada_en        := NULL;
    NEW.cancelada_por       := NULL;
    NEW.motivo_cancelacion  := NULL;
    NEW.detalle_cancelacion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_afiliacion_sello_cancelacion ON public.afiliaciones;
CREATE TRIGGER trg_afiliacion_sello_cancelacion
  BEFORE UPDATE OF estado ON public.afiliaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_afiliacion_sello_cancelacion();

-- PostgREST cachea el esquema: sin esto las columnas nuevas no existen para el
-- frontend (PGRST204) aunque estén en la tabla.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (tras aplicar):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='afiliaciones' AND column_name LIKE '%cancela%';   -- 4
--   SELECT tgname FROM pg_trigger WHERE tgname='trg_afiliacion_sello_cancelacion';
--   SELECT count(*) FROM afiliaciones WHERE estado='CANCELADA' AND motivo_cancelacion IS NULL; -- 92 históricas
--
-- REVERSA:
--   BEGIN;
--     DROP TRIGGER IF EXISTS trg_afiliacion_sello_cancelacion ON public.afiliaciones;
--     DROP FUNCTION IF EXISTS public.fn_afiliacion_sello_cancelacion();
--     ALTER TABLE public.afiliaciones
--       DROP COLUMN IF EXISTS cancelada_en, DROP COLUMN IF EXISTS cancelada_por,
--       DROP COLUMN IF EXISTS motivo_cancelacion, DROP COLUMN IF EXISTS detalle_cancelacion;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
