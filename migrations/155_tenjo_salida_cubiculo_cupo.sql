-- ============================================================================
-- 155 — Tenjo: salida del cubículo, cupo por cubículo y reloj de recordatorios
-- Fecha: 2026-09-11
--
-- Tres cosas, en este orden:
--
-- 1. CUPO POR CUBÍCULO. Hasta hoy el índice único `uq_cubiculo_ocupado` hacía
--    IMPOSIBLE meter dos mascotas en el mismo cubículo (decisión del 16-jul).
--    La planta necesita meter varias. Se cambia el candado, NO se quita: cada
--    cubículo lleva su `capacidad` (por defecto 1) y un trigger que serializa
--    sobre la fila del cubículo (SELECT … FOR UPDATE) y rechaza el que se pase.
--    Un índice único no sirve para "hasta N", y sin nada no habría red alguna
--    contra el error de dedo del operario.
--
-- 2. FECHA DE SALIDA EDITABLE. `cubiculo_liberado_en` es el sello de CUÁNDO SE
--    PULSÓ el botón; no es la hora real en que la mascota salió (mismo patrón
--    de `cuarto_frio.fecha_ingreso`). Se agrega `cubiculo_salida date`, que es
--    el hecho operativo y se puede corregir después.
--
-- 3. EL RELOJ DE LOS RECORDATORIOS ARRANCA EN LA SALIDA, NO EN LAS IMÁGENES.
--    `fn_calcular_fecha_entrega` (migr. 007) fija `fecha_limite_entrega` =
--    imágenes + días hábiles del plan. En un compostaje de 2–3 meses esa fecha
--    NACE VENCIDA: la mascota sigue en el cubículo cuando el plazo ya pasó, y
--    Kanban/Producción la pintan en rojo durante dos meses.
--    Regla nueva, solo para COMPOSTAJE_INDIVIDUAL cuya familia NO marcó que
--    quiere los recordatorios anticipados (`recordatorios_anticipados IS NOT
--    TRUE`, o sea: dijo "todos al final" o no contestó):
--        fecha_limite_entrega = salida del cubículo + días hábiles del plan
--    Mientras siga adentro la fecha es NULL — no hay compromiso que medir
--    todavía, y una fecha inventada es peor que ninguna.
--
-- Nada de esto toca a quien SÍ pidió los recordatorios anticipados: ese sigue
-- contando desde las imágenes, porque su producción arranca ahí.
-- ============================================================================

-- ─── 1. Cupo por cubículo ───────────────────────────────────────────────────
ALTER TABLE public.cubiculos
  ADD COLUMN IF NOT EXISTS capacidad smallint NOT NULL DEFAULT 1;

ALTER TABLE public.cubiculos DROP CONSTRAINT IF EXISTS ck_cubiculo_capacidad;
ALTER TABLE public.cubiculos
  ADD CONSTRAINT ck_cubiculo_capacidad CHECK (capacidad BETWEEN 1 AND 20);

COMMENT ON COLUMN public.cubiculos.capacidad IS
  'Cuántas mascotas caben a la vez en este cubículo. Por defecto 1. Se sube a mano en Tenjo → Cubículos solo en los que de verdad aguantan más.';

-- El índice único se cae: ya no es "uno y solo uno", es "hasta capacidad".
DROP INDEX IF EXISTS public.uq_cubiculo_ocupado;

-- Compuerta nueva. Serializa sobre la fila del cubículo para que dos operarios
-- guardando a la vez no puedan pasarse del cupo (el índice único daba esa
-- garantía gratis; un COUNT sin bloqueo no la da).
CREATE OR REPLACE FUNCTION public.fn_cubiculo_cupo()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_cap    smallint;
  v_activo boolean;
  v_ocup   integer;
  v_cod    text;
BEGIN
  -- La fila no ocupa cubículo: nada que validar.
  IF NEW.cubiculo_id IS NULL OR NEW.cubiculo_liberado_en IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE que no cambia la ocupación (ya estaba dentro del mismo cubículo):
  -- no se revalida, o cualquier edición de otra columna podría fallar sola.
  IF TG_OP = 'UPDATE'
     AND OLD.cubiculo_id IS NOT DISTINCT FROM NEW.cubiculo_id
     AND OLD.cubiculo_liberado_en IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT capacidad, activo, codigo INTO v_cap, v_activo, v_cod
    FROM public.cubiculos WHERE id = NEW.cubiculo_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cubiculo_inexistente: el cubículo indicado no está en el catálogo';
  END IF;

  IF NOT COALESCE(v_activo, true) THEN
    RAISE EXCEPTION 'cubiculo_fuera_de_servicio: % está fuera de servicio', v_cod;
  END IF;

  SELECT count(*) INTO v_ocup
    FROM public.lotes_tenjo_items
   WHERE cubiculo_id = NEW.cubiculo_id
     AND cubiculo_liberado_en IS NULL
     AND id <> NEW.id;

  IF v_ocup >= v_cap THEN
    RAISE EXCEPTION 'cubiculo_sin_cupo: % está en su tope (% de %)', v_cod, v_ocup, v_cap;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_cubiculo_cupo ON public.lotes_tenjo_items;
CREATE TRIGGER trg_cubiculo_cupo
  BEFORE INSERT OR UPDATE OF cubiculo_id, cubiculo_liberado_en ON public.lotes_tenjo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_cubiculo_cupo();

-- ─── 2. Fecha real de salida del cubículo ───────────────────────────────────
ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS cubiculo_salida date;

COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_salida IS
  'Día en que la mascota SALIÓ del cubículo (hecho operativo, editable). NO es cubiculo_liberado_en, que es el sello de cuándo se pulsó el botón. De esta fecha cuelgan los días hábiles de entrega de los recordatorios.';

-- Historia: lo ya liberado toma como salida el día (hora de Bogotá) del sello.
UPDATE public.lotes_tenjo_items
   SET cubiculo_salida = (cubiculo_liberado_en AT TIME ZONE 'America/Bogota')::date
 WHERE cubiculo_liberado_en IS NOT NULL
   AND cubiculo_salida IS NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_tenjo_items_salida
  ON public.lotes_tenjo_items (cubiculo_salida)
  WHERE cubiculo_salida IS NOT NULL;

-- ─── 3. El reloj de los recordatorios ───────────────────────────────────────
-- `recordatorios_anticipados` existe en producción pero NUNCA se creó por una
-- migración del repo (nació fuera). Se declara aquí para que cualquier entorno
-- limpio pueda correr esta migración sin fallar; en prod el IF NOT EXISTS la
-- deja intacta con todos sus datos.
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS recordatorios_anticipados boolean;

COMMENT ON COLUMN public.servicios.recordatorios_anticipados IS
  'Compostaje individual: true = la familia los quiere cuanto antes (se producen mientras avanza el proceso); false = los quiere todos al final; NULL = no contestó, se trata como "al final".';

-- ¿Este servicio espera a que la mascota salga del cubículo?
-- Sí ⟺ es compostaje individual Y la familia no marcó "los quiero cuanto antes".
CREATE OR REPLACE FUNCTION public.fn_compostaje_espera_salida(p_servicio uuid)
RETURNS boolean LANGUAGE sql STABLE AS $func$
  SELECT COALESCE(p.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL'
                  AND s.recordatorios_anticipados IS NOT TRUE, false)
    FROM public.servicios s
    JOIN public.planes p ON p.id = s.plan_id
   WHERE s.id = p_servicio;
$func$;

COMMENT ON FUNCTION public.fn_compostaje_espera_salida(uuid) IS
  'true si los recordatorios de este servicio se entregan al final del compostaje: su plazo cuenta desde la salida del cubículo, no desde las imágenes.';

CREATE OR REPLACE FUNCTION public.fn_recalcular_limite_compostaje(p_servicio uuid)
RETURNS void LANGUAGE plpgsql AS $func$
DECLARE
  v_dias   integer;
  v_salida date;
  v_nueva  date;
BEGIN
  IF p_servicio IS NULL OR NOT public.fn_compostaje_espera_salida(p_servicio) THEN
    RETURN;
  END IF;

  SELECT COALESCE(p.dias_entrega_prometidos, 8) INTO v_dias
    FROM public.servicios s JOIN public.planes p ON p.id = s.plan_id
   WHERE s.id = p_servicio;

  -- Si la mascota estuvo en varios cubículos, manda la última salida: es el día
  -- en que de verdad quedó fuera del proceso.
  SELECT max(cubiculo_salida) INTO v_salida
    FROM public.lotes_tenjo_items
   WHERE servicio_id = p_servicio AND cubiculo_salida IS NOT NULL;

  v_nueva := CASE WHEN v_salida IS NULL
                  THEN NULL
                  ELSE public.fn_sumar_dias_habiles(v_salida, v_dias) END;

  -- Lo ya entregado o cancelado no se reescribe: su fecha es historia.
  UPDATE public.servicios
     SET fecha_limite_entrega = v_nueva
   WHERE id = p_servicio
     AND estado NOT IN ('ENTREGADO', 'CANCELADO')
     AND fecha_limite_entrega IS DISTINCT FROM v_nueva;
END;
$func$;

COMMENT ON FUNCTION public.fn_recalcular_limite_compostaje(uuid) IS
  'Recalcula servicios.fecha_limite_entrega = salida del cubículo + días hábiles del plan, solo para compostajes que esperan al final. Mientras la mascota siga adentro deja NULL.';

CREATE OR REPLACE FUNCTION public.fn_item_salida_recalcula_limite()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  PERFORM public.fn_recalcular_limite_compostaje(NEW.servicio_id);
  -- Si el item cambió de servicio, el viejo también queda desactualizado.
  IF TG_OP = 'UPDATE' AND OLD.servicio_id IS DISTINCT FROM NEW.servicio_id THEN
    PERFORM public.fn_recalcular_limite_compostaje(OLD.servicio_id);
  END IF;
  RETURN NULL;
END;
$func$;

DROP TRIGGER IF EXISTS trg_item_salida_limite ON public.lotes_tenjo_items;
CREATE TRIGGER trg_item_salida_limite
  AFTER INSERT OR UPDATE OF cubiculo_salida, servicio_id ON public.lotes_tenjo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_salida_recalcula_limite();

-- El trigger de las imágenes deja de fijar la fecha en estos compostajes.
-- Ojo: `recordatorios_anticipados` se escribe en el MISMO UPDATE que
-- `fecha_imagenes_recibidas` (orbit-backend/src/imagenes.js), así que en un
-- trigger BEFORE el NEW ya trae la respuesta de la familia.
CREATE OR REPLACE FUNCTION public.fn_calcular_fecha_entrega()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_dias_prometidos INTEGER := 8;
  v_tipo            TEXT;
BEGIN
  IF OLD.fecha_imagenes_recibidas IS NULL AND NEW.fecha_imagenes_recibidas IS NOT NULL THEN
    SELECT dias_entrega_prometidos, tipo_proceso
      INTO v_dias_prometidos, v_tipo
      FROM public.planes WHERE id = NEW.plan_id;

    IF v_tipo = 'COMPOSTAJE_INDIVIDUAL' AND NEW.recordatorios_anticipados IS NOT TRUE THEN
      -- Los recibe al final del compostaje: el plazo lo abre la salida del
      -- cubículo (fn_recalcular_limite_compostaje), no estas imágenes.
      NEW.fecha_limite_entrega := NULL;
    ELSE
      NEW.fecha_limite_entrega := public.fn_sumar_dias_habiles(
        NEW.fecha_imagenes_recibidas, COALESCE(v_dias_prometidos, 8));
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

-- ─── 4. Puesta al día de lo que ya está en cubículo ─────────────────────────
-- Decisión de David (11-sep): se recalcula lo vivo, no solo lo nuevo. Las que
-- siguen dentro quedan sin fecha (dejan de salir vencidas); las que ya salieron
-- toman salida + días hábiles. Lo ENTREGADO/CANCELADO no se toca.
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT i.servicio_id
      FROM public.lotes_tenjo_items i
      JOIN public.servicios s ON s.id = i.servicio_id
     WHERE i.cubiculo_id IS NOT NULL
       AND s.estado NOT IN ('ENTREGADO', 'CANCELADO')
  LOOP
    PERFORM public.fn_recalcular_limite_compostaje(r.servicio_id);
  END LOOP;
END
$backfill$;

-- ============================================================================
-- VERIFICACIÓN
--   -- cupo: todos en 1 salvo los que David suba a mano
--   SELECT capacidad, count(*) FROM cubiculos GROUP BY 1 ORDER BY 1;
--   -- ningún cubículo por encima de su cupo
--   SELECT c.codigo, c.capacidad, count(i.id)
--     FROM cubiculos c JOIN lotes_tenjo_items i
--       ON i.cubiculo_id = c.id AND i.cubiculo_liberado_en IS NULL
--    GROUP BY 1,2 HAVING count(i.id) > c.capacidad;         -- esperado: 0 filas
--   -- compostajes que esperan al final y siguen dentro → sin fecha límite
--   SELECT m.nombre, i.cubiculo_salida, s.fecha_limite_entrega
--     FROM lotes_tenjo_items i
--     JOIN servicios s ON s.id = i.servicio_id
--     JOIN mascotas  m ON m.id_mascota = s.mascota_id
--    WHERE i.cubiculo_id IS NOT NULL
--      AND public.fn_compostaje_espera_salida(s.id)
--    ORDER BY i.cubiculo_salida NULLS FIRST;
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_item_salida_limite ON public.lotes_tenjo_items;
--   DROP TRIGGER IF EXISTS trg_cubiculo_cupo      ON public.lotes_tenjo_items;
--   DROP FUNCTION IF EXISTS public.fn_item_salida_recalcula_limite();
--   DROP FUNCTION IF EXISTS public.fn_recalcular_limite_compostaje(uuid);
--   DROP FUNCTION IF EXISTS public.fn_compostaje_espera_salida(uuid);
--   DROP FUNCTION IF EXISTS public.fn_cubiculo_cupo();
--   DROP INDEX IF EXISTS public.idx_lotes_tenjo_items_salida;
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS cubiculo_salida;
--   ALTER TABLE public.cubiculos DROP CONSTRAINT IF EXISTS ck_cubiculo_capacidad;
--   ALTER TABLE public.cubiculos DROP COLUMN IF EXISTS capacidad;
--   CREATE UNIQUE INDEX uq_cubiculo_ocupado ON public.lotes_tenjo_items (cubiculo_id)
--     WHERE cubiculo_id IS NOT NULL AND cubiculo_liberado_en IS NULL;
--   -- y devolver fn_calcular_fecha_entrega a la versión de la migración 007
-- ============================================================================
