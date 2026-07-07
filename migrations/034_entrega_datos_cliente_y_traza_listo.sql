-- ============================================================================
-- 034 — Traza de LISTO + datos de entrega que deja el cliente + entrega ampliada
-- ----------------------------------------------------------------------------
-- Tres cosas, todas aditivas/idempotentes/reversibles:
--
--  1. TRAZA DE LISTO: servicios.fecha_listo (timestamptz) + trigger que la
--     estampa la PRIMERA vez que el servicio pasa a estado 'LISTO', por
--     cualquier vía (front, job, SQL). Trazabilidad robusta por DB (no por
--     useState), como el patrón del proyecto.
--
--  2. DATOS DE ENTREGA DEL CLIENTE: el cliente los deja en el portal de fotos
--     (solicitud de imágenes). Se guardan en servicios.datos_entrega_cliente
--     (jsonb) + datos_entrega_recibidos_en. Son SUGERENCIA/prefill para cuando
--     se prepara la entrega; el coordinador confirma. jsonb:
--       { direccion, barrio, localidad, recibe, telefono, telefono_adicional, horarios }
--
--  3. ENTREGA AMPLIADA: la tabla entregas gana localidad, telefono_adicional y
--     horarios_atencion (antes no existían) para persistir lo que dejó el
--     cliente y que salga en el certificado.
--
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   docker exec -i supabase-db psql -U postgres < 034_entrega_datos_cliente_y_traza_listo.sql
-- ============================================================================

BEGIN;

-- ─── 1. Traza de LISTO ──────────────────────────────────────────────────────
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS fecha_listo timestamptz;

COMMENT ON COLUMN public.servicios.fecha_listo
  IS 'Momento en que el servicio quedó LISTO por primera vez (todos los recordatorios terminados). Estampado por trigger fn_stamp_fecha_listo.';

CREATE OR REPLACE FUNCTION public.fn_stamp_fecha_listo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Estampa la primera llegada a LISTO. Si luego revierte y vuelve, conserva la
  -- primera fecha (traza de cuándo estuvo listo por primera vez).
  IF NEW.estado = 'LISTO' AND NEW.fecha_listo IS NULL THEN
    NEW.fecha_listo := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_servicios_fecha_listo ON public.servicios;
CREATE TRIGGER trg_servicios_fecha_listo
  BEFORE UPDATE ON public.servicios
  FOR EACH ROW
  WHEN (NEW.estado = 'LISTO' AND NEW.fecha_listo IS NULL)
  EXECUTE FUNCTION public.fn_stamp_fecha_listo();

-- Backfill: servicios que YA están listos/en entrega/entregados sin fecha_listo.
-- Se aproxima con la última fecha_fin_prod de sus recordatorios (mejor dato
-- histórico disponible); si no hay, queda NULL (no se inventa).
UPDATE public.servicios s SET fecha_listo = sub.f
FROM (
  SELECT sr.servicio_id, MAX(sr.fecha_fin_prod)::timestamptz AS f
  FROM public.servicio_recordatorios sr
  WHERE sr.fecha_fin_prod IS NOT NULL
  GROUP BY sr.servicio_id
) sub
WHERE s.id = sub.servicio_id
  AND s.fecha_listo IS NULL
  AND s.estado IN ('LISTO','EN_ENTREGA','ENTREGADO');

-- ─── 2. Datos de entrega que deja el cliente en el portal ───────────────────
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS datos_entrega_cliente      jsonb,
  ADD COLUMN IF NOT EXISTS datos_entrega_recibidos_en timestamptz;

COMMENT ON COLUMN public.servicios.datos_entrega_cliente
  IS 'Datos de entrega que el cliente deja en el portal de fotos: { direccion, barrio, localidad, recibe, telefono, telefono_adicional, horarios }. Prefill para preparar la entrega; NO es la entrega confirmada.';

-- ─── 3. Entrega ampliada ────────────────────────────────────────────────────
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS localidad          text,
  ADD COLUMN IF NOT EXISTS telefono_adicional varchar,
  ADD COLUMN IF NOT EXISTS horarios_atencion  text;

COMMENT ON COLUMN public.entregas.horarios_atencion
  IS 'Horarios que el cliente pide tener en cuenta. No es hora exacta confirmada de entrega.';

COMMIT;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='servicios' AND column_name IN ('fecha_listo','datos_entrega_cliente','datos_entrega_recibidos_en');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='entregas' AND column_name IN ('localidad','telefono_adicional','horarios_atencion');
-- SELECT tgname FROM pg_trigger WHERE tgname='trg_servicios_fecha_listo';
