-- ============================================================================
-- 156 — El cupo de un cubículo no puede quedar por debajo de lo que ya tiene
-- Fecha: 2026-09-14
--
-- La 155 trajo `cubiculos.capacidad` y el trigger `fn_cubiculo_cupo`, que frena
-- al que intenta METER una mascota de más. Quedó el camino contrario abierto:
-- BAJAR el cupo de un cubículo que ya está lleno. `ck_cubiculo_capacidad` solo
-- comprueba BETWEEN 1 AND 20 y no mira la ocupación.
--
-- Comprobado contra producción el 14-sep-2026, en una transacción revertida:
--   capacidad 2 con 2 mascotas dentro  →  UPDATE ... SET capacidad = 1  →  OK
--   resultado: cap 1, dentro 2, libres calculados = -1
-- No estalla en ningún sitio —`cuposLibres` hace Math.max(0, …)— pero los
-- totales por zona del mapa pasan a mentir sobre el espacio de la planta, y una
-- mascota queda en un cubículo que oficialmente no tiene sitio para ella.
--
-- El único freno hasta hoy vivía en el `onBlur` de un input del navegador, que
-- compara contra la ocupación que esa pestaña cargó hace rato. Basta con dos
-- operarios a la vez, una pestaña vieja, o un UPDATE a mano —que aquí es
-- rutina— para saltárselo.
--
-- 🔑 No hace falta bloquear nada a mano: el propio `UPDATE cubiculos` toma el
-- lock de la fila, y `fn_cubiculo_cupo` pide esa misma fila con
-- `SELECT … FOR UPDATE` antes de contar. Quien intente entrar mientras se baja
-- el cupo espera, y quien baje el cupo mientras entra alguien cuenta después.
-- Las dos compuertas se serializan solas sobre la fila del cubículo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cubiculo_capacidad_no_baja()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_ocup integer;
  v_cod  text;
BEGIN
  -- Subir el cupo, o dejarlo igual, nunca es problema.
  IF NEW.capacidad >= OLD.capacidad THEN
    RETURN NEW;
  END IF;

  -- 🪤 `NEW.codigo` llega NULL: `cubiculos.codigo` es GENERATED ALWAYS y
  -- Postgres lo calcula DESPUÉS de los triggers BEFORE. El ensayo del 14-sep
  -- sacó un "<NULL> tiene 2 mascota(s) adentro". Se rehace aquí con las
  -- columnas crudas, que son las mismas de la expresión generada.
  v_cod := NEW.zona || '-' || NEW.talla || '-' || lpad(NEW.numero::text, 2, '0');

  SELECT count(*) INTO v_ocup
    FROM public.lotes_tenjo_items
   WHERE cubiculo_id = NEW.id
     AND cubiculo_liberado_en IS NULL;

  IF NEW.capacidad < v_ocup THEN
    RAISE EXCEPTION
      'cubiculo_capacidad_menor_que_ocupacion: % tiene % mascota(s) adentro y no puede quedar en cupo %',
      v_cod, v_ocup, NEW.capacidad;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.fn_cubiculo_capacidad_no_baja() IS
  'Impide dejar el cupo de un cubículo por debajo de las mascotas que ya tiene dentro. Complementa fn_cubiculo_cupo (migr. 155), que vigila el camino contrario.';

DROP TRIGGER IF EXISTS trg_cubiculo_capacidad ON public.cubiculos;
CREATE TRIGGER trg_cubiculo_capacidad
  BEFORE UPDATE OF capacidad ON public.cubiculos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cubiculo_capacidad_no_baja();

-- ============================================================================
-- VERIFICACIÓN
--   -- 1. No debe haber NINGUNO por debajo de su ocupación (esperado: 0 filas)
--   SELECT c.codigo, c.capacidad, count(i.id) AS dentro
--     FROM cubiculos c JOIN lotes_tenjo_items i
--       ON i.cubiculo_id = c.id AND i.cubiculo_liberado_en IS NULL
--    GROUP BY 1,2 HAVING count(i.id) > c.capacidad;
--
--   -- 2. El trigger existe
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.cubiculos'::regclass AND NOT tgisinternal;
--
--   -- 3. Ensayo real (revertir): debe fallar la ÚLTIMA sentencia
--   --    BEGIN;
--   --      UPDATE cubiculos SET capacidad = 2 WHERE codigo = 'AMARILLO-G-13';
--   --      -- meter dos items …
--   --      UPDATE cubiculos SET capacidad = 1 WHERE codigo = 'AMARILLO-G-13';
--   --    ROLLBACK;
--
-- ROLLBACK:
--   DROP TRIGGER  IF EXISTS trg_cubiculo_capacidad ON public.cubiculos;
--   DROP FUNCTION IF EXISTS public.fn_cubiculo_capacidad_no_baja();
-- ============================================================================
