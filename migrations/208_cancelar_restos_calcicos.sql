-- ============================================================================
-- 208 — Cancelar los restos cálcicos cuando la familia se retracta
-- Fecha: 2026-11-13 · Pedido de David
--
-- «A aquellos compostajes que pidieron cenizas, si se retractan, que se pueda
--  cancelar la opción y quitar el cofre y demás, o que salga como cancelado.»
--
-- Cancelar (lo hace coordinación desde el Kanban, backend `cancelarRestos`):
--   · `restos_calcicos` vuelve a false → Tenjo deja de pedir separarlos,
--     Producción deja de mostrar el cenizario, el certificado y el recibo dejan
--     de cobrarlos (todos leen esa marca).
--   · Se le RESTA su valor al servicio y se recalcula `estado_pago`.
--   · `restos_respuesta` = 'NO' → el portal de visita no lo vuelve a ofrecer.
--   · Queda la huella de quién, cuándo y por qué (estas columnas) para que en
--     la ficha salga «cancelado» y no «la familia dijo que no».
--   · Se conservan valor, foto y fecha de la compra: son historia.
--
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de REVERSA al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.planta_elecciones
  ADD COLUMN IF NOT EXISTS restos_cancelado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS restos_cancelado_por    uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS restos_cancelado_motivo text;

COMMENT ON COLUMN public.planta_elecciones.restos_cancelado_en IS
  'La familia se retractó de los restos cálcicos y coordinación los canceló (migr. 208): se restó su valor del servicio. Bloquea volver a cobrarlos.';

-- orbit_backend ya tiene SELECT/UPDATE en planta_elecciones (149/205); el
-- GRANT de tabla cubre las columnas nuevas.

COMMIT;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verificación:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'planta_elecciones' AND column_name LIKE 'restos_cancelado%';   -- 3
--
-- REVERSA:
--   BEGIN;
--     ALTER TABLE public.planta_elecciones
--       DROP COLUMN IF EXISTS restos_cancelado_en,
--       DROP COLUMN IF EXISTS restos_cancelado_por,
--       DROP COLUMN IF EXISTS restos_cancelado_motivo;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
