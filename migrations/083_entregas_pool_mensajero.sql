-- 083 — Entregas: pool de entregas disponibles para mensajeros y técnicos
--
-- Hasta ahora la entrega solo podía existir asignada a una persona concreta:
-- "Preparar entrega" en Producción exigía elegir mensajero y dejaba la fila en
-- ASIGNADA. En la práctica el flujo nunca se usó — en prod hay 683 entregas y
-- TODAS están en PENDIENTE, ninguna con mensajero_id, ninguna ENTREGADA.
--
-- Ojo con PENDIENTE: NO significa "lista para entregar". `fn_post_crear_servicio`
-- inserta una fila cascarón (servicio_id + estado) apenas se crea el servicio, así
-- que PENDIENTE = "todavía no se ha preparado nada". Por eso hace falta un estado
-- nuevo y no basta con reusar PENDIENTE:
--
--   PENDIENTE  → cascarón del trigger, sin datos
--   DISPONIBLE → publicada al pool: cualquier mensajero/técnico la ve y puede tomarla
--   ASIGNADA   → tiene dueño (la tomó del pool, o el coordinador se la asignó)
--   EN_CAMINO → ENTREGADA / FALLIDA / REPROGRAMADA (sin cambios)
--
-- Decisión David 2026-07-31: la entrega se publica MANUALMENTE al prepararla en
-- Producción (no automático al llegar a LISTO: sin dirección ni contacto el
-- mensajero no puede decidir si le sirve), y se conserva la asignación directa.

BEGIN;

-- ── 1. Estado nuevo ──────────────────────────────────────────────────────────
ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_estado_check;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_estado_check
  CHECK (estado::text = ANY (ARRAY[
    'PENDIENTE', 'DISPONIBLE', 'ASIGNADA', 'EN_CAMINO',
    'ENTREGADA', 'FALLIDA', 'REPROGRAMADA'
  ]));

-- ── 2. Traza del pool ────────────────────────────────────────────────────────
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS publicada_en  timestamptz,
  ADD COLUMN IF NOT EXISTS publicada_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS tomada_en     timestamptz;

COMMENT ON COLUMN public.entregas.publicada_en  IS 'Cuándo se publicó al pool (estado DISPONIBLE). Se conserva si alguien la toma.';
COMMENT ON COLUMN public.entregas.publicada_por IS 'Quién la publicó desde Producción.';
COMMENT ON COLUMN public.entregas.tomada_en     IS 'Cuándo un mensajero/técnico la tomó del pool. NULL si el coordinador la asignó directo.';

-- El pool se consulta desde la app de campo cada pocos segundos.
CREATE INDEX IF NOT EXISTS idx_entregas_disponibles
  ON public.entregas (publicada_en)
  WHERE estado = 'DISPONIBLE';

-- Mis entregas (la app filtra por mensajero + estados activos)
CREATE INDEX IF NOT EXISTS idx_entregas_mensajero_activas
  ON public.entregas (mensajero_id, estado)
  WHERE estado IN ('ASIGNADA', 'EN_CAMINO');

-- ── 3. Realtime ──────────────────────────────────────────────────────────────
-- Para que una entrega tomada desaparezca del pool de los demás sin esperar al
-- polling. REPLICA IDENTITY FULL: la app filtra por columnas que no son PK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'entregas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.entregas;
  END IF;
END $$;
ALTER TABLE public.entregas REPLICA IDENTITY FULL;

COMMIT;
