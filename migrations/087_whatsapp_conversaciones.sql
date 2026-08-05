-- 087 — WhatsApp Cloud API: capa de CONVERSACIÓN (bandeja de Orbit)
--
-- La 086 dejó `whatsapp_webhook_events`: el log CRUDO, tal como lo manda Meta.
-- Sirve para depurar y para no perder nada, pero no se puede pintar una bandeja
-- encima (un mensaje entrante y sus 3 acuses son 4 filas distintas, y lo que
-- NOSOTROS enviamos ni siquiera llega por webhook como mensaje: solo como acuse).
--
-- Esta migración agrega la capa normalizada, que es la que lee la UI:
--
--   whatsapp_webhook_events  →  log crudo, append-only, nadie lo pinta
--   whatsapp_mensajes        →  un renglón por mensaje, IN y OUT, con su estado
--   whatsapp_contactos       →  un renglón por interlocutor (para la lista y no-leídos)
--
-- El log crudo NO se toca: sigue siendo la fuente de verdad si algún día hay que
-- reconstruir algo o entender un payload que hoy no interpretamos (Flows, etc.).

BEGIN;

-- ── 1. Mensajes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_mensajes (
  id              bigserial PRIMARY KEY,
  phone_number_id text        NOT NULL,
  contacto        text        NOT NULL,
  direccion       text        NOT NULL,
  wa_message_id   text,
  tipo            text        NOT NULL DEFAULT 'text',
  texto           text,
  payload         jsonb,
  estado          text,
  estado_en       timestamptz,
  error           text,
  enviado_por     uuid REFERENCES public.personal(id),
  ocurrido_en     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_mensajes_direccion_check CHECK (direccion = ANY (ARRAY['IN', 'OUT']))
);

COMMENT ON TABLE  public.whatsapp_mensajes IS
  'Un renglón por mensaje de la línea de vets, en ambos sentidos. Es lo que pinta la bandeja de Orbit.';
COMMENT ON COLUMN public.whatsapp_mensajes.contacto IS
  'wa_id del INTERLOCUTOR (nunca el nuestro), solo dígitos con indicativo: 573001234567. Es la llave del hilo.';
COMMENT ON COLUMN public.whatsapp_mensajes.direccion IS
  'IN = lo escribió la veterinaria. OUT = lo enviamos nosotros desde Orbit.';
COMMENT ON COLUMN public.whatsapp_mensajes.estado IS
  'Solo en OUT: sent → delivered → read, o failed. Lo actualizan los acuses del webhook. NULL en los entrantes.';
COMMENT ON COLUMN public.whatsapp_mensajes.ocurrido_en IS
  'Hora del mensaje según Meta (no la de inserción): es la que ordena el hilo.';
COMMENT ON COLUMN public.whatsapp_mensajes.enviado_por IS
  'Quién lo mandó desde Orbit. NULL en los entrantes y en los automáticos.';

-- Dedupe: el receptor puede reprocesar el mismo evento (Meta reenvía).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_mensajes_wamid
  ON public.whatsapp_mensajes (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- El hilo de un contacto, del más reciente al más viejo.
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_hilo
  ON public.whatsapp_mensajes (contacto, ocurrido_en DESC);

-- Contador de no leídos (ver v_whatsapp_conversaciones).
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_entrantes
  ON public.whatsapp_mensajes (contacto, ocurrido_en)
  WHERE direccion = 'IN';

-- ── 2. Contactos ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_contactos (
  contacto           text PRIMARY KEY,
  phone_number_id    text,
  nombre_perfil      text,
  ultimo_mensaje_en  timestamptz,
  ultimo_entrante_en timestamptz,
  ultimo_leido_en    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.whatsapp_contactos IS
  'Un renglón por interlocutor de la línea de vets. Lo mantiene un trigger sobre whatsapp_mensajes.';
COMMENT ON COLUMN public.whatsapp_contactos.nombre_perfil IS
  'Nombre que la persona tiene puesto en su WhatsApp (lo manda Meta). Puede no existir.';
COMMENT ON COLUMN public.whatsapp_contactos.ultimo_entrante_en IS
  'Último mensaje que ELLOS escribieron. Define la ventana de 24h de Meta: pasadas 24h desde aquí ya no se puede mandar texto libre, solo plantilla.';
COMMENT ON COLUMN public.whatsapp_contactos.ultimo_leido_en IS
  'Hasta dónde leyó el coordinador en Orbit. Lo que sea posterior cuenta como no leído.';

-- ── 3. El contacto se mantiene solo ──────────────────────────────────────────
-- Trigger y no lógica de aplicación: así da igual quién inserte el mensaje
-- (el receptor del webhook, el emisor, un backfill a mano) — nunca se desincroniza.
CREATE OR REPLACE FUNCTION public.fn_wa_touch_contacto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.whatsapp_contactos AS c
    (contacto, phone_number_id, ultimo_mensaje_en, ultimo_entrante_en)
  VALUES (
    NEW.contacto,
    NEW.phone_number_id,
    NEW.ocurrido_en,
    CASE WHEN NEW.direccion = 'IN' THEN NEW.ocurrido_en END
  )
  ON CONFLICT (contacto) DO UPDATE SET
    phone_number_id    = COALESCE(EXCLUDED.phone_number_id, c.phone_number_id),
    -- GREATEST ignora NULL, así que un mensaje viejo insertado tarde
    -- (reproceso, backfill) no puede retroceder el reloj de la conversación.
    ultimo_mensaje_en  = GREATEST(c.ultimo_mensaje_en,  EXCLUDED.ultimo_mensaje_en),
    ultimo_entrante_en = GREATEST(c.ultimo_entrante_en, EXCLUDED.ultimo_entrante_en);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_touch_contacto ON public.whatsapp_mensajes;
CREATE TRIGGER trg_wa_touch_contacto
  AFTER INSERT ON public.whatsapp_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.fn_wa_touch_contacto();

-- ── 3b. Los acuses solo avanzan ──────────────────────────────────────────────
-- Meta NO garantiza el orden en que entrega los webhooks: un "sent" retrasado
-- puede llegar después del "read". Sin este rango, ese acuse tardío pisaría el
-- estado bueno y la bandeja mostraría como recién enviado un mensaje ya leído.
CREATE OR REPLACE FUNCTION public.rango_estado_wa(estado text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE estado
           WHEN 'sent'      THEN 1
           WHEN 'delivered' THEN 2
           WHEN 'read'      THEN 3
           WHEN 'failed'    THEN 9
           ELSE 0
         END;
$$;

COMMENT ON FUNCTION public.rango_estado_wa(text) IS
  'Orden de los acuses de WhatsApp. Un UPDATE solo debe aplicar si el rango nuevo es mayor (failed siempre gana).';

-- ── 4. Quién nos está escribiendo ────────────────────────────────────────────
-- Los teléfonos están guardados con formatos distintos según quién los digitó
-- (+57 300…, 300…, con espacios, con guiones). Meta siempre manda 573001234567.
-- Comparar por los ÚLTIMOS 10 DÍGITOS es lo único que funciona con todos.
CREATE OR REPLACE FUNCTION public.wa_tel10(tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(RIGHT(regexp_replace(COALESCE(tel, ''), '\D', '', 'g'), 10), '');
$$;

COMMENT ON FUNCTION public.wa_tel10(text) IS
  'Últimos 10 dígitos de un teléfono, sin formato. Para cruzar el wa_id de Meta con aliados/clientes.';

-- aliados y clientes son tablas chicas, pero el cruce corre en cada refresco de
-- la bandeja (polling): con índice el planificador no las recorre enteras.
CREATE INDEX IF NOT EXISTS idx_aliados_tel10_whatsapp  ON public.aliados  (public.wa_tel10(whatsapp));
CREATE INDEX IF NOT EXISTS idx_aliados_tel10_telefono  ON public.aliados  (public.wa_tel10(telefono));
CREATE INDEX IF NOT EXISTS idx_clientes_tel10_whatsapp ON public.clientes (public.wa_tel10(whatsapp));
CREATE INDEX IF NOT EXISTS idx_clientes_tel10_telefono ON public.clientes (public.wa_tel10(telefono));

-- ── 5. Vista de la bandeja ───────────────────────────────────────────────────
-- Resuelve de una: quién es, cuándo escribió, cuántos sin leer y si la ventana
-- de 24h sigue abierta. La veterinaria manda sobre el cliente: es la línea de vets.
CREATE OR REPLACE VIEW public.v_whatsapp_conversaciones AS
SELECT
  c.contacto,
  c.phone_number_id,
  c.nombre_perfil,
  c.ultimo_mensaje_en,
  c.ultimo_entrante_en,
  c.ultimo_leido_en,
  a.id_aliado                                     AS aliado_id,
  a.nombre                                        AS aliado_nombre,
  cl.id_cliente                                   AS cliente_id,
  TRIM(CONCAT_WS(' ', cl.nombre, cl.apellido))    AS cliente_nombre,
  COALESCE(a.nombre, NULLIF(TRIM(CONCAT_WS(' ', cl.nombre, cl.apellido)), ''), c.nombre_perfil)
                                                  AS nombre,
  CASE WHEN a.id_aliado IS NOT NULL THEN 'ALIADO'
       WHEN cl.id_cliente IS NOT NULL THEN 'CLIENTE'
       ELSE 'DESCONOCIDO' END                     AS tipo_contacto,
  -- Ventana de 24h de Meta: solo se puede mandar texto libre mientras esté abierta.
  (c.ultimo_entrante_en IS NOT NULL AND c.ultimo_entrante_en > now() - interval '24 hours')
                                                  AS ventana_abierta,
  c.ultimo_entrante_en + interval '24 hours'      AS ventana_hasta,
  (SELECT m.texto FROM public.whatsapp_mensajes m
    WHERE m.contacto = c.contacto ORDER BY m.ocurrido_en DESC, m.id DESC LIMIT 1)
                                                  AS ultimo_texto,
  (SELECT m.direccion FROM public.whatsapp_mensajes m
    WHERE m.contacto = c.contacto ORDER BY m.ocurrido_en DESC, m.id DESC LIMIT 1)
                                                  AS ultima_direccion,
  (SELECT count(*) FROM public.whatsapp_mensajes m
    WHERE m.contacto = c.contacto AND m.direccion = 'IN'
      AND (c.ultimo_leido_en IS NULL OR m.ocurrido_en > c.ultimo_leido_en))
                                                  AS sin_leer
FROM public.whatsapp_contactos c
-- LEFT JOIN LATERAL + LIMIT 1: si dos aliados comparten teléfono (pasa: sedes de
-- la misma clínica), un JOIN normal duplicaría la conversación en la bandeja.
LEFT JOIN LATERAL (
  SELECT x.id_aliado, x.nombre FROM public.aliados x
   WHERE public.wa_tel10(x.whatsapp) = public.wa_tel10(c.contacto)
      OR public.wa_tel10(x.telefono) = public.wa_tel10(c.contacto)
   ORDER BY x.activo DESC NULLS LAST, x.nombre
   LIMIT 1
) a ON true
LEFT JOIN LATERAL (
  SELECT x.id_cliente, x.nombre, x.apellido FROM public.clientes x
   WHERE public.wa_tel10(x.whatsapp) = public.wa_tel10(c.contacto)
      OR public.wa_tel10(x.telefono) = public.wa_tel10(c.contacto)
   ORDER BY x.id_cliente
   LIMIT 1
) cl ON true;

-- security_invoker + sin GRANT a anon/authenticated: la vista NO se expone por
-- PostgREST. Se lee por el endpoint del backend, que valida JWT y rol.
-- (Regla del hardening de vistas del 2026-06-10.)
ALTER VIEW public.v_whatsapp_conversaciones SET (security_invoker = on);

-- ── 6. Permisos ──────────────────────────────────────────────────────────────
-- Contienen teléfonos y texto libre de conversaciones: nada de esto viaja al bundle.
REVOKE ALL ON TABLE public.whatsapp_mensajes            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_contactos           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.v_whatsapp_conversaciones    FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.whatsapp_mensajes            TO postgres, service_role;
GRANT  ALL ON TABLE public.whatsapp_contactos           TO postgres, service_role;
GRANT  SELECT ON TABLE public.v_whatsapp_conversaciones TO postgres, service_role;

REVOKE ALL ON SEQUENCE public.whatsapp_mensajes_id_seq FROM PUBLIC, anon, authenticated;
GRANT  ALL ON SEQUENCE public.whatsapp_mensajes_id_seq TO postgres, service_role;

REVOKE ALL ON FUNCTION public.wa_tel10(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rango_estado_wa(text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_wa_touch_contacto()  FROM PUBLIC, anon, authenticated;

-- ⚠️ El rol real del backend es `orbit_backend`, no `postgres` (ver nota en la 086).
-- Sin estos GRANT el INSERT falla con "permission denied for sequence" y el
-- webhook responde 200 sin guardar nada — falla silenciosa.
-- El REVOKE de arriba quita EXECUTE a PUBLIC, así que las funciones también
-- necesitan su GRANT explícito: `wa_tel10` la usa la vista, `rango_estado_wa` el
-- UPDATE de acuses y `fn_wa_touch_contacto` el trigger.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_mensajes  TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_contactos TO orbit_backend;
GRANT SELECT               ON TABLE    public.v_whatsapp_conversaciones TO orbit_backend;
GRANT USAGE, SELECT        ON SEQUENCE public.whatsapp_mensajes_id_seq  TO orbit_backend;
GRANT EXECUTE ON FUNCTION public.wa_tel10(text)         TO orbit_backend;
GRANT EXECUTE ON FUNCTION public.rango_estado_wa(text)  TO orbit_backend;
GRANT EXECUTE ON FUNCTION public.fn_wa_touch_contacto() TO orbit_backend;

ALTER TABLE public.whatsapp_mensajes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contactos ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: nadie entra por PostgREST. postgres (el backend) y
-- service_role bypasean RLS de forma nativa.

COMMIT;
