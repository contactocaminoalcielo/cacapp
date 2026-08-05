-- 086 — WhatsApp Cloud API: bitácora cruda de eventos del webhook
--
-- Primer paso de la migración de la línea de VETERINARIAS desde Zolutium/GHL
-- hacia Cloud API directo. Por ahora esta tabla SOLO recibe: nada la lee, nada
-- responde. Es el cimiento de lo que viene después (agente propio, WhatsApp
-- Flows, plantillas con botones): las respuestas de botón y los datos de un Flow
-- NO llegan como texto, llegan como eventos de webhook. Por eso se guarda el
-- payload íntegro aunque hoy no interpretemos casi nada de él.
--
-- ⚠️ Lo que ya funciona en Zolutium SIGUE en Zolutium. El filtro por
-- phone_number_id vive en el backend (WHATSAPP_ALLOWED_PHONE_IDS) y descarta en
-- silencio cualquier número que no sea el de vets, para no tocar la operación.

BEGIN;

-- ── 1. Tabla ─────────────────────────────────────────────────────────────────
-- PK bigserial y no uuid a propósito: es una tabla de log de alto volumen que
-- ninguna otra referencia por FK. Un contador es más liviano que un uuid random
-- (mejor localidad en el índice, filas más cortas).
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id              bigserial PRIMARY KEY,
  phone_number_id text        NOT NULL,
  wa_message_id   text,
  from_number     text,
  event_type      text        NOT NULL,
  status          text,
  payload         jsonb       NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed       boolean     NOT NULL DEFAULT false,
  processed_at    timestamptz,
  CONSTRAINT whatsapp_webhook_events_tipo_check
    CHECK (event_type = ANY (ARRAY['message', 'status']))
);

COMMENT ON TABLE  public.whatsapp_webhook_events IS
  'Eventos crudos del webhook de WhatsApp Cloud API (línea de veterinarias). Solo escribe orbit-backend.';
COMMENT ON COLUMN public.whatsapp_webhook_events.phone_number_id IS
  'Número de Meta que recibió el evento. Se filtra contra WHATSAPP_ALLOWED_PHONE_IDS antes de insertar.';
COMMENT ON COLUMN public.whatsapp_webhook_events.wa_message_id IS
  'wamid del mensaje. En event_type=status es el wamid del mensaje NUESTRO que cambió de estado.';
COMMENT ON COLUMN public.whatsapp_webhook_events.from_number IS
  'message → quién escribió. status → recipient_id (a quién le iba nuestro mensaje).';
COMMENT ON COLUMN public.whatsapp_webhook_events.status IS
  'Solo en event_type=status: sent | delivered | read | failed. NULL en los mensajes entrantes.';
COMMENT ON COLUMN public.whatsapp_webhook_events.payload IS
  'Request COMPLETO de Meta, tal cual llegó. Si un request trae varios eventos se repite en cada fila: es barato y garantiza no perder nada que hoy no sepamos leer (p.ej. nfm_reply de los Flows).';
COMMENT ON COLUMN public.whatsapp_webhook_events.processed IS
  'Lo consumirá el worker del agente (todavía no existe). Hoy siempre false.';

-- ── 2. Deduplicación ─────────────────────────────────────────────────────────
-- Meta REENVÍA eventos si no le respondemos 200 en <5s, así que hace falta
-- descartar repetidos. Pero un UNIQUE plano sobre wa_message_id sería un error
-- silencioso: los acuses de estado de UN mismo mensaje (sent → delivered → read)
-- comparten el mismo wamid. Con un único índice plano guardaríamos "sent" y
-- tiraríamos "delivered" y "read" — es decir, perderíamos justo la señal de si
-- la veterinaria leyó o no. De ahí dos índices distintos:

-- Mensajes entrantes: un wamid = un mensaje. Cualquier repetición es un reintento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_webhook_message
  ON public.whatsapp_webhook_events (wa_message_id)
  WHERE event_type = 'message' AND wa_message_id IS NOT NULL;

-- Acuses: se admite uno por (mensaje, estado). El reintento del mismo estado sí se descarta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_webhook_status
  ON public.whatsapp_webhook_events (wa_message_id, status)
  WHERE event_type = 'status' AND wa_message_id IS NOT NULL AND status IS NOT NULL;

-- ── 3. Índices de consulta ───────────────────────────────────────────────────
-- Bandeja / depuración: "los últimos N de este número".
CREATE INDEX IF NOT EXISTS idx_wa_webhook_recientes
  ON public.whatsapp_webhook_events (phone_number_id, received_at DESC);

-- Conversación de un contacto.
CREATE INDEX IF NOT EXISTS idx_wa_webhook_from
  ON public.whatsapp_webhook_events (from_number, received_at DESC)
  WHERE from_number IS NOT NULL;

-- Cola del futuro worker del agente: solo lo pendiente.
CREATE INDEX IF NOT EXISTS idx_wa_webhook_pendientes
  ON public.whatsapp_webhook_events (received_at)
  WHERE processed = false;

-- ── 4. Permisos ──────────────────────────────────────────────────────────────
-- Esta tabla NO se expone por PostgREST. La escribe orbit-backend por conexión
-- directa y se lee por el endpoint del backend (con JWT + rol). Mismo criterio
-- que Digitales: sin GRANT a anon ni a authenticated.
-- Contiene teléfonos y texto libre de conversaciones: no debe viajar al bundle.
REVOKE ALL ON TABLE public.whatsapp_webhook_events FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.whatsapp_webhook_events TO postgres, service_role;
REVOKE ALL ON SEQUENCE public.whatsapp_webhook_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT  ALL ON SEQUENCE public.whatsapp_webhook_events_id_seq TO postgres, service_role;

-- ⚠️ orbit-backend NO se conecta como `postgres`: usa el rol dedicado
-- `orbit_backend` (con BYPASSRLS, sin superusuario). Los ALTER DEFAULT PRIVILEGES
-- de la DB cubren postgres/anon/authenticated/service_role pero NO a este rol, así
-- que TODA tabla nueva que el backend escriba necesita su GRANT explícito — y la
-- SECUENCIA también, o el INSERT falla con "permission denied for sequence".
-- (Se descubrió desplegando: el webhook devolvía 200 y no guardaba nada.)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_webhook_events TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_webhook_events_id_seq        TO orbit_backend;

ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: nadie entra por PostgREST. postgres (el backend) y
-- service_role bypasean RLS de forma nativa.

-- ── 5. Aseo (creado pero NO programado) ──────────────────────────────────────
-- El payload crudo solo sirve para depurar lo reciente; el resumen (quién,
-- cuándo, qué) es lo que interesa conservar. Esta función vacía el JSON viejo y
-- deja la fila. Estimado: ~1-2 KB por evento; una conversación de 10+10
-- mensajes ≈ 40 filas ≈ 60 KB (cada mensaje NUESTRO genera 3 acuses).
--
-- NO se agrega al cron todavía — primero medimos crecimiento real. Para
-- activarlo: SELECT public.whatsapp_webhook_purge(90);  (mensual en /etc/cron.d)
CREATE OR REPLACE FUNCTION public.whatsapp_webhook_purge(dias integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.whatsapp_webhook_events
     SET payload = '{"purgado": true}'::jsonb
   WHERE received_at < now() - make_interval(days => dias)
     AND payload <> '{"purgado": true}'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.whatsapp_webhook_purge(integer) IS
  'Vacía el payload crudo de eventos con más de N días, conservando la fila resumen. No programada aún.';

-- Sin este REVOKE, cualquiera con la ANON_KEY (que viaja en el bundle) podría
-- ejecutarla por RPC y borrar el histórico crudo.
REVOKE ALL ON FUNCTION public.whatsapp_webhook_purge(integer) FROM PUBLIC, anon, authenticated;

COMMIT;
