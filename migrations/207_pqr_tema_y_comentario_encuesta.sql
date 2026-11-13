-- ============================================================================
-- 207 — Clasificar lo que dicen las familias: TEMA en la PQR + canal del
--       comentario de la encuesta post-entrega
-- Fecha: 2026-11-13 · Pedido de David
--
-- Decisiones de David (13-nov):
--   · Todo comentario de la encuesta (Regular o Malo) queda como PQR, con el
--     PQRSF de siempre: Malo → QUEJA, Regular → SUGERENCIA. Coordinación lo
--     puede cambiar al atender (p. ej. a PETICION).
--   · Además un TEMA, para saber qué falla más: recordatorios, tiempos,
--     atención, mensajero, cobro u otro.
--   · Si la familia escribe en el chat en vez de usar el formulario, ese texto
--     es su comentario (no despierta al agente) → hay que saber por dónde llegó.
--
-- `tema` va en `pqrs` (no en nps_seguimiento) porque sirve para TODA PQR, no
-- solo las de la encuesta: /pqr y la ficha del servicio también lo usan.
-- NULL = sin clasificar (las PQR viejas quedan así).
--
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de REVERSA al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pqrs
  ADD COLUMN IF NOT EXISTS tema text
        CHECK (tema IS NULL OR tema IN ('RECORDATORIOS','TIEMPOS','ATENCION','MENSAJERO','COBRO','OTRO'));

COMMENT ON COLUMN public.pqrs.tema IS
  'De qué trata (migr. 207): RECORDATORIOS, TIEMPOS, ATENCION, MENSAJERO, COBRO, OTRO. NULL = sin clasificar.';

CREATE INDEX IF NOT EXISTS idx_pqrs_tema ON public.pqrs (tema) WHERE tema IS NOT NULL;

ALTER TABLE public.nps_seguimiento
  ADD COLUMN IF NOT EXISTS comentario_canal varchar(12)
        CHECK (comentario_canal IS NULL OR comentario_canal IN ('FORMULARIO','CHAT'));

COMMENT ON COLUMN public.nps_seguimiento.comentario_canal IS
  'Por dónde dejó el comentario de la encuesta (migr. 207): FORMULARIO (/#/opinion) o CHAT (escribió en WhatsApp).';

-- orbit_backend ya tiene SELECT/INSERT/UPDATE en las dos tablas (migr. 206) y
-- el GRANT de tabla cubre las columnas nuevas.

COMMIT;

-- ============================================================================
-- Verificación:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_name IN ('pqrs','nps_seguimiento') AND column_name IN ('tema','comentario_canal');
--   SELECT count(*) FROM pqrs WHERE tema IS NOT NULL;            -- 0
--
-- REVERSA:
--   BEGIN;
--     DROP INDEX IF EXISTS public.idx_pqrs_tema;
--     ALTER TABLE public.pqrs DROP COLUMN IF EXISTS tema;
--     ALTER TABLE public.nps_seguimiento DROP COLUMN IF EXISTS comentario_canal;
--   COMMIT;
-- ============================================================================
