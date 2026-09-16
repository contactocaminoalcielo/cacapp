-- ============================================================================
-- 158 — Precio "antes" del extra: el gancho de la promoción
-- Fecha: 2026-09-16
--
-- La segunda planta cuesta $40.000 y ese ES el precio real. Lo que faltaba era
-- CONTARLE a la familia que ese precio ya lleva el descuento por tener el plan
-- de compostaje: en el portal se veía un $40.000 a secas, sin referencia, y una
-- cifra sola no se lee como oferta.
--
-- Va como columna del catálogo y no como número en el código, por lo mismo que
-- la especie es catálogo (migración 149): el día que el precio de lista cambie
-- —o que se quiera quitar la promoción— se edita en Configuración → Plantas y
-- no hay que tocar el portal.
--
-- Reglas:
--   · `precio_antes` es OPCIONAL. NULL = sin promoción, se muestra solo el precio.
--   · El portal solo tacha el "antes" cuando es MAYOR que el precio. Un "antes"
--     igual o menor no se muestra: sería un descuento de $0 o, peor, al revés.
--   · NO entra en ningún cobro. El extra se sigue cobrando por `precio`, que es
--     la única fuente de verdad del monto (ver `plantas.precio`).
--
-- A propósito SIN un CHECK cruzado `precio_antes > precio`: dejaría a David
-- atrapado al subir el precio (tendría que borrar el antes primero). Que sobre
-- un valor inservible es barato; que la pantalla de Configuración rechace un
-- cambio de precio, no.
--
-- Ejecutar por SSH→psql en Contabo (ver memory/ops_aplicar_migraciones_vps.md).
-- Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plantas
  ADD COLUMN IF NOT EXISTS precio_antes numeric
    CHECK (precio_antes IS NULL OR precio_antes >= 0);

COMMENT ON COLUMN public.plantas.precio_antes IS
  'Precio de lista que se muestra TACHADO junto al precio real, como gancho de promoción. NULL = sin promoción. Nunca se cobra: el cobro sale siempre de `precio`.';

-- Los dos extras vigentes (Helecho y Pescadito, $40.000) pasan a mostrarse como
-- promoción sobre un precio de lista de $50.000. Acotado a esas filas: una
-- planta futura con otro precio no debe heredar un "antes" que nadie decidió.
UPDATE public.plantas
   SET precio_antes = 50000
 WHERE adicional = true
   AND precio = 40000
   AND precio_antes IS NULL;

COMMIT;

-- ============================================================================
-- VERIFICAR:
--   SELECT nombre, precio, precio_antes,
--          (precio_antes IS NOT NULL AND precio_antes > precio) AS sale_como_promo
--     FROM public.plantas ORDER BY orden;
--   -- Esperado: Helecho y Pescadito → 40000 / 50000 / t
--
-- ROLLBACK:
--   ALTER TABLE public.plantas DROP COLUMN IF EXISTS precio_antes;
-- ============================================================================
