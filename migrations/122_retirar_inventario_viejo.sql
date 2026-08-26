-- 122 — Retirar el módulo de inventario viejo
--
-- ⚠️ La 121 la tomó el agente de Familias (`121_agente_familias_configuracion.sql`).
-- El repo se trabaja desde más de una sesión: mirar `ls migrations/` antes de numerar.
--
-- QUÉ SE RETIRA Y POR QUÉ
-- Antes de la migración 120 existía un primer intento del mismo módulo: la tabla
-- `inventario`, su libro `movimientos_inventario`, una tabla de recetas
-- `recordatorio_materiales`, la vista `v_stock_bajo` y una pestaña dentro de
-- Gestión. Nunca se adoptó:
--
--   inventario               20 filas — semilla de prototipo, confirmada como de
--                            prueba por David el 2026-08-26
--   movimientos_inventario    0 filas — nadie registró un movimiento jamás
--   recordatorio_materiales   0 filas — nadie configuró una receta jamás
--
-- Y tenía dos defectos que explican por qué murió, los mismos que la 120 corrige:
--
--   1. `Gestion.jsx` insertaba el movimiento y actualizaba `stock_actual` en DOS
--      escrituras sueltas, sin transacción. Si la segunda fallaba, el saldo y el
--      libro quedaban divergentes en silencio. En la 120 eso es imposible: el
--      saldo lo mueve el mismo trigger que inserta el movimiento.
--   2. Bloqueaba cuando el stock iba a quedar negativo. El módulo nuevo lo
--      permite a propósito — el inventario no frena a producción; un negativo es
--      la señal de que faltó registrar una entrada.
--
-- Las 20 filas quedaron respaldadas en
-- `respaldos/inventario_viejo_2026-08-26.sql` (pg_dump --column-inserts).
--
-- REQUISITO: desplegar primero el frontend sin la pestaña. Si se corre esto
-- antes, la pestaña Inventario de Gestión revienta contra tablas que ya no están.
--
-- Aplicar en el VPS Contabo:
--   cat 122_retirar_inventario_viejo.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -

BEGIN;

-- Cerrojo: si alguien empezó a usarlas entre que se escribió esto y se aplica,
-- la migración se detiene en vez de borrar datos reales.
DO $$
DECLARE v_movs bigint; v_recetas bigint;
BEGIN
  SELECT count(*) INTO v_movs    FROM public.movimientos_inventario;
  SELECT count(*) INTO v_recetas FROM public.recordatorio_materiales;
  IF v_movs > 0 OR v_recetas > 0 THEN
    RAISE EXCEPTION
      'ABORTADA: el módulo viejo tiene datos reales (% movimientos, % recetas). Revisar antes de borrar.',
      v_movs, v_recetas;
  END IF;
END $$;

DROP VIEW  IF EXISTS public.v_stock_bajo;
DROP TABLE IF EXISTS public.movimientos_inventario;
DROP TABLE IF EXISTS public.recordatorio_materiales;
DROP TABLE IF EXISTS public.inventario;

COMMIT;

-- Para que PostgREST deje de exponerlas:
--   NOTIFY pgrst, 'reload schema';
