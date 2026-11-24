-- ============================================================================
-- 219 — Compets: los recordatorios anticipados pedidos DESPUÉS tienen plazo propio
-- Fecha: 2026-11-24 · REPORTE ORBIT (Producción y Diseño, urgencia alta)
--
-- Contexto. En un Compets (planes COMPOSTAJE_INDIVIDUAL) la entrega principal es
-- la planta, 2 a 3 meses desde el ingreso. Eso lo muestra ahora el frontend
-- (src/lib/utils.js → estimadoCompets) y no vive en la base.
-- `fecha_limite_entrega` queda solo para los recordatorios físicos:
--   · «al final» (false / NULL): salida del cubículo + días del plan (migr. 155).
--   · anticipados (true): las fotos + días del plan (fn_calcular_fecha_entrega).
--
-- El hueco. `recordatorios_anticipados` solo se fijaba en el portal de fotos, en
-- el MISMO UPDATE que `fecha_imagenes_recibidas`. Si el propietario pide un
-- recordatorio antes de terminar el proceso DESPUÉS de subir las fotos (por
-- WhatsApp), no había cómo abrirle el plazo: coordinación no podía marcarlo y,
-- aunque lo marcara a mano, ningún trigger recalculaba la fecha.
--
-- Arreglo. Trigger propio sobre el cambio de `recordatorios_anticipados` cuando
-- las fotos YA estaban (OLD.fecha_imagenes_recibidas NOT NULL). Así no pisa a
-- fn_calcular_fecha_entrega, que solo actúa cuando las fotos llegan en ese UPDATE:
--   · pasa a true  → fecha = HOY (Bogotá) + días del plan. Desde hoy y no desde
--                    las fotos: si las subió hace un mes, la fecha nacería vencida.
--   · deja de ser true → vuelve a la regla 155 (salida + días, o NULL si sigue
--                    en el cubículo).
-- Lo ENTREGADO/CANCELADO no se toca: su fecha es historia.
-- No es SECURITY DEFINER: lee planes y lotes_tenjo_items, que ya lee quien
-- actualiza servicios (authenticated y orbit_backend).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_anticipados_recalcula_limite()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_dias   integer;
  v_tipo   text;
  v_salida date;
BEGIN
  IF NEW.recordatorios_anticipados IS NOT DISTINCT FROM OLD.recordatorios_anticipados
     OR OLD.fecha_imagenes_recibidas IS NULL
     OR NEW.estado IN ('ENTREGADO', 'CANCELADO') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(dias_entrega_prometidos, 8), tipo_proceso
    INTO v_dias, v_tipo
    FROM public.planes WHERE id = NEW.plan_id;

  IF v_tipo IS DISTINCT FROM 'COMPOSTAJE_INDIVIDUAL' THEN
    RETURN NEW;
  END IF;

  IF NEW.recordatorios_anticipados IS TRUE THEN
    NEW.fecha_limite_entrega := public.fn_sumar_dias_habiles(public.fn_hoy_bogota(), v_dias);
  ELSE
    SELECT max(cubiculo_salida) INTO v_salida
      FROM public.lotes_tenjo_items
     WHERE servicio_id = NEW.id AND cubiculo_salida IS NOT NULL;
    NEW.fecha_limite_entrega := CASE WHEN v_salida IS NULL THEN NULL
                                     ELSE public.fn_sumar_dias_habiles(v_salida, v_dias) END;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.fn_anticipados_recalcula_limite() IS
  'Compets: al marcar/desmarcar recordatorios_anticipados con las fotos ya recibidas, abre (hoy + días del plan) o devuelve a la regla de la salida del cubículo el plazo de los recordatorios (migr. 219).';

DROP TRIGGER IF EXISTS trg_anticipados_recalcula_limite ON public.servicios;
CREATE TRIGGER trg_anticipados_recalcula_limite
  BEFORE UPDATE OF recordatorios_anticipados ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.fn_anticipados_recalcula_limite();

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (solo lectura)
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.servicios'::regclass AND tgname = 'trg_anticipados_recalcula_limite';
--   -- Compets vivos por marca y si tienen fecha
--   SELECT p.codigo, s.recordatorios_anticipados, count(*), count(s.fecha_limite_entrega)
--     FROM servicios s JOIN planes p ON p.id = s.plan_id
--    WHERE p.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL' AND s.estado NOT IN ('ENTREGADO','CANCELADO')
--    GROUP BY 1,2 ORDER BY 1,2;
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_anticipados_recalcula_limite ON public.servicios;
--   DROP FUNCTION IF EXISTS public.fn_anticipados_recalcula_limite();
-- ============================================================================
