-- ============================================================================
-- 007 — Festivos globales: TODAS las funciones de días hábiles respetan festivos
-- Fecha: 2026-06-18
--
-- Antes, varias funciones contaban días hábiles solo saltando fines de semana
-- (EXTRACT(DOW) NOT IN (0,6)), ignorando la tabla `festivos`. Ahora todas usan
-- public.fn_es_dia_habil / fn_sumar_dias_habiles (creadas en la migración 006),
-- que sí consultan `festivos`. Así, agregar/quitar un festivo en Configuración
-- afecta a todas las operaciones de Orbit que usen días hábiles.
--
-- Afecta (hacia adelante; no recalcula servicios existentes):
--   - fecha_limite_entrega       (fn_calcular_fecha_entrega — trigger)
--   - fecha_limite_cambio_plan   (fn_inicializar_servicio   — trigger)
--   - conteo de días hábiles     (fn_dias_habiles_hasta)
-- ============================================================================

-- 1. Fecha límite de entrega de recordatorios
CREATE OR REPLACE FUNCTION public.fn_calcular_fecha_entrega()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_dias_prometidos INTEGER := 8;
BEGIN
  IF OLD.fecha_imagenes_recibidas IS NULL AND NEW.fecha_imagenes_recibidas IS NOT NULL THEN
    SELECT dias_entrega_prometidos INTO v_dias_prometidos FROM public.planes WHERE id = NEW.plan_id;
    NEW.fecha_limite_entrega := public.fn_sumar_dias_habiles(NEW.fecha_imagenes_recibidas, COALESCE(v_dias_prometidos, 8));
  END IF;
  RETURN NEW;
END;
$func$;

-- 2. Inicializar servicio: fecha límite de cambio de plan = +2 días hábiles
CREATE OR REPLACE FUNCTION public.fn_inicializar_servicio()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_es_vip BOOLEAN := FALSE;
BEGIN
  NEW.fecha_limite_cambio_plan := public.fn_sumar_dias_habiles(NEW.fecha_ingreso, 2);
  IF NEW.aliado_origen_id IS NOT NULL THEN
    SELECT vip INTO v_es_vip FROM public.aliados WHERE id_aliado = NEW.aliado_origen_id;
  END IF;
  RETURN NEW;
END;
$func$;

-- 3. Conteo de días hábiles entre hoy y una fecha (respeta festivos)
CREATE OR REPLACE FUNCTION public.fn_dias_habiles_hasta(fecha_fin date)
RETURNS integer LANGUAGE plpgsql STABLE AS $func$
DECLARE
  v_inicio DATE := CURRENT_DATE; v_fin DATE := fecha_fin; v_signo INTEGER := 1; v_count INTEGER;
BEGIN
  IF fecha_fin IS NULL THEN RETURN NULL; END IF;
  IF v_fin < v_inicio THEN v_signo := -1; v_inicio := fecha_fin; v_fin := CURRENT_DATE; END IF;
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM generate_series(v_inicio, v_fin, '1 day'::interval) d
  WHERE public.fn_es_dia_habil(d::date) AND d::date <> v_inicio;
  RETURN v_signo * v_count;
END;
$func$;
