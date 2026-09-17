-- ============================================================================
-- 165 — Cuando el técnico reporta una novedad, hay que avisarle a la familia
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-09-17): si el técnico reporta una novedad en la ruta o
-- dice que no puede ir, que salte una alerta en el tablero y que no deje seguir
-- hasta que el coordinador vaya al número —el de la veterinaria si la recogida
-- es en clínica, el del propietario si es a domicilio— a avisar que hubo un
-- problema o que va retrasado.
--
-- Qué había hasta hoy:
--   • «No puedo aceptar» (TECNICO_DECLINA) — SOLO creaba una notificación. Ni
--     novedad en el servicio ni rastro en `recogidas`. 18 casos entre el 27-may
--     y el 26-jul, y de ninguno queda constancia de si la familia se enteró.
--   • «Problema en ruta» (TECNICO_PROBLEMA_RUTA) — devolvía el servicio a
--     INGRESADO, dejaba una NOTA y notificaba. 2 casos (2-jun).
--   • En el tablero, las dos caían en un banner plegable «Reasignación urgente»
--     que sirve para REASIGNAR, no para avisar: no hay ningún botón que lleve al
--     WhatsApp de la familia ni nada que registre que se le avisó.
--
-- Por qué columnas y no solo la notificación: las notificaciones se auto-expiran
-- a los DIAS_EXPIRA_ALERTA y se llevan consigo la única señal de que faltó
-- avisar. Es exactamente lo que ya se corrigió con el aviso de la hora de
-- recogida (154), y por eso estas columnas viven al lado de aquellas y con el
-- mismo patrón: `*_en`, `*_destino`, `*_por`.
--
-- Una recogida tiene UNA novedad viva a la vez: al reportar una nueva se pisan
-- estas columnas y se limpia el aviso. El histórico completo no se pierde —cada
-- reporte deja su fila en `novedades_servicio`—; esto es "lo que está pendiente
-- ahora", que es lo que el tablero necesita preguntar.
--
-- Aditiva, idempotente, reversible. No pisa datos.
-- Aplicar en VPS (Contabo) — el archivo se PIPEA desde local; no vive en el VPS:
--   cat migrations/165_novedad_ruta_aviso.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. La novedad que reportó el técnico ───────────────────────────────────
ALTER TABLE public.recogidas
  ADD COLUMN IF NOT EXISTS novedad_tipo          text,
  ADD COLUMN IF NOT EXISTS novedad_motivo        text,
  ADD COLUMN IF NOT EXISTS novedad_reportada_en  timestamptz,
  ADD COLUMN IF NOT EXISTS novedad_reportada_por uuid REFERENCES public.personal(id);

-- ─── 2. El aviso que el coordinador le dio a la familia o a la clínica ──────
-- `novedad_avisada_via` distingue el WhatsApp del «ya avisé por otra vía»: sin
-- eso, una llamada y un wa.me quedan iguales en los datos y no se puede saber
-- si de verdad salió un mensaje.
ALTER TABLE public.recogidas
  ADD COLUMN IF NOT EXISTS novedad_avisada_en      timestamptz,
  ADD COLUMN IF NOT EXISTS novedad_avisada_destino text,
  ADD COLUMN IF NOT EXISTS novedad_avisada_por     uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS novedad_avisada_via     text,
  ADD COLUMN IF NOT EXISTS novedad_avisada_nota    text;

ALTER TABLE public.recogidas
  DROP CONSTRAINT IF EXISTS recogidas_novedad_tipo_check,
  ADD  CONSTRAINT recogidas_novedad_tipo_check
       CHECK (novedad_tipo IS NULL OR novedad_tipo IN ('DECLINA', 'PROBLEMA_RUTA'));

ALTER TABLE public.recogidas
  DROP CONSTRAINT IF EXISTS recogidas_novedad_via_check,
  ADD  CONSTRAINT recogidas_novedad_via_check
       CHECK (novedad_avisada_via IS NULL OR novedad_avisada_via IN ('WHATSAPP', 'OTRA'));

-- Topes de largo: el motivo y la nota los escribe una persona en el celular, y
-- sin tope un pegado accidental entra entero a la base.
ALTER TABLE public.recogidas
  DROP CONSTRAINT IF EXISTS recogidas_novedad_largos,
  ADD  CONSTRAINT recogidas_novedad_largos CHECK (
        length(COALESCE(novedad_motivo,          '')) <= 500
    AND length(COALESCE(novedad_avisada_nota,    '')) <= 500
    AND length(COALESCE(novedad_avisada_destino, '')) <= 20
  );

COMMENT ON COLUMN public.recogidas.novedad_tipo IS
  'DECLINA = el técnico no pudo aceptar el servicio; PROBLEMA_RUTA = lo reportó ya en camino. NULL = sin novedad viva.';
COMMENT ON COLUMN public.recogidas.novedad_avisada_en IS
  'Cuándo el coordinador le avisó a la familia o a la clínica. NULL con novedad_reportada_en lleno = pendiente, y así lo pinta el tablero.';

-- ─── 3. Índice del pendiente ────────────────────────────────────────────────
-- Parcial: solo interesan las que están SIN avisar, que son un puñado a la vez.
CREATE INDEX IF NOT EXISTS ix_recogidas_novedad_sin_avisar
  ON public.recogidas (novedad_reportada_en DESC)
  WHERE novedad_reportada_en IS NOT NULL AND novedad_avisada_en IS NULL;

-- ─── 4. Permisos ────────────────────────────────────────────────────────────
-- `recogidas` ya tiene su RLS y sus GRANT; estas columnas los heredan y no hay
-- nada que volver a conceder. Se deja la comprobación como constancia.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'recogidas' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'recogidas sin UPDATE para authenticated: el técnico no podría reportar la novedad';
  END IF;
END $$;

COMMIT;

-- Verificación después de aplicar:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'recogidas' AND column_name LIKE 'novedad%' ORDER BY 1;
-- SELECT count(*) FROM public.recogidas WHERE novedad_reportada_en IS NOT NULL;
