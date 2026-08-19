-- 104 — Envíos masivos: campañas de plantillas
--
-- Hasta ahora una plantilla se mandaba de una en una. Avisar a las 203
-- veterinarias de que escriban por la línea nueva era, literalmente, 203 clics.
--
-- 🩸 POR QUÉ ESTO NO ES UN BUCLE `for`:
--
--   1. **No se puede deshacer.** Un fallo en un envío individual es un mensaje
--      raro a una clínica; el mismo fallo aquí son 203. Por eso la lista de
--      destinatarios se construye ANTES, se mira, y solo entonces se arranca.
--   2. **Meta tiene cupo diario y no deja consultarlo** (`messaging_limit_tier`
--      dejó de exponerse; comprobado el 2026-08-19). Al topar responde con un
--      error y hay que parar y seguir más tarde, no reintentar en bucle.
--   3. **La calidad de la línea es frágil.** Una ráfaga en la que mucha gente
--      bloquea o reporta baja el `quality_rating` y Meta puede limitar el
--      número. Por eso el ritmo es un dato de la campaña, no una constante.
--   4. **El backend se reinicia.** Un envío a medias en memoria se perdería sin
--      saber por dónde iba. El estado de CADA destinatario vive en la tabla:
--      quien se reinicie sigue donde estaba y nadie recibe dos veces.

BEGIN;

-- ── La campaña ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_campanas (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      text NOT NULL,
  plantilla   text NOT NULL,
  idioma      text NOT NULL DEFAULT 'es_MX',
  -- Clave del catálogo CERRADO del backend (`AUDIENCIAS`), nunca SQL: mismo
  -- criterio que el catálogo de campos de la migración 097.
  audiencia   text NOT NULL,
  filtros     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Lo que se escribe una vez y vale para todos (una fecha, un nombre de
  -- campaña). Se usa donde el dato no sale de la base.
  valores_fijos jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- El ritmo es DE LA CAMPAÑA, no del sistema: avisar de una urgencia y hacer
  -- una promoción no se mandan igual.
  por_hora    integer NOT NULL DEFAULT 200 CHECK (por_hora BETWEEN 1 AND 3600),
  estado      text NOT NULL DEFAULT 'BORRADOR'
              CHECK (estado IN ('BORRADOR','EN_CURSO','PAUSADA','TERMINADA','CANCELADA')),
  -- Por qué se paró. Una campaña pausada sin motivo es una campaña que nadie
  -- se atreve a reanudar.
  pausa_motivo    text,
  -- Cuándo volver a intentar cuando Meta dijo "cupo alcanzado". NULL = solo a
  -- mano.
  reintentar_desde timestamptz,
  creada_por  uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  iniciada_en timestamptz,
  terminada_en timestamptz
);

COMMENT ON TABLE public.whatsapp_campanas IS
  'Envío de una plantilla a muchos. El ritmo y el estado son de la campaña: el envío se reanuda solo tras un reinicio o un cupo de Meta.';

-- ── Cada destinatario, con su desenlace ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_campana_destinos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campana_id bigint NOT NULL REFERENCES public.whatsapp_campanas(id) ON DELETE CASCADE,
  contacto   text NOT NULL,
  -- De dónde salió (id del aliado). Con él, el número y los datos se vuelven a
  -- leer JUSTO ANTES de enviar: congelarlos repetiría el bug de los envíos que
  -- salían al WhatsApp viejo porque leían un snapshot.
  ref_id     text,
  nombre     text,
  estado     text NOT NULL DEFAULT 'PENDIENTE'
             CHECK (estado IN ('PENDIENTE','ENVIADO','FALLIDO','OMITIDO')),
  wa_message_id text,
  error      text,
  enviado_en timestamptz,
  -- Nadie recibe dos veces la misma campaña, pase lo que pase con el proceso.
  UNIQUE (campana_id, contacto)
);

CREATE INDEX IF NOT EXISTS whatsapp_campana_destinos_cola_idx
  ON public.whatsapp_campana_destinos (campana_id, estado);

COMMENT ON TABLE public.whatsapp_campana_destinos IS
  'Un renglón por destinatario y su desenlace. El UNIQUE por (campaña, contacto) es lo que impide mandar dos veces.';

-- ── La forma de decir "a esta no" ───────────────────────────────────────────
-- Reutiliza las etiquetas de conversación (migración 090) en vez de inventar
-- otra lista: la etiqueta se pone desde la bandeja, donde está quien recibe el
-- "no me escriban más".
INSERT INTO public.whatsapp_etiquetas (clave, nombre, grupo, color, descripcion, orden)
VALUES ('NO_MASIVOS', 'No enviar masivos', 'OTRO', '#DC2626',
        'Pidió no recibir avisos masivos. Las campañas la saltan siempre. No afecta a los mensajes de su propio servicio.',
        90)
ON CONFLICT (clave) DO NOTHING;

-- ── El número como lo quiere Meta, también desde SQL ────────────────────────
-- `clientes.whatsapp` y `aliados.whatsapp` guardan diez dígitos (3002214704) y
-- la API quiere el indicativo (573002214704). En JS eso lo hace
-- `aInternacional()` (whatsapp-plantillas.js); aquí hace falta la misma regla
-- para poder cruzar con las etiquetas de conversación, que sí van con
-- indicativo. Si un día cambia una, hay que cambiar la otra.
CREATE OR REPLACE FUNCTION public.fn_wa_internacional(tel text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN length(d) = 10 AND left(d, 1) = '3' THEN '57' || d
    ELSE d
  END
  FROM (SELECT regexp_replace(COALESCE(tel, ''), '\D', '', 'g') AS d) x
$$;

COMMENT ON FUNCTION public.fn_wa_internacional(text) IS
  'Numero con indicativo y sin +, como lo pide Cloud API. Espejo de aInternacional() en whatsapp-plantillas.js.';

REVOKE ALL ON FUNCTION public.fn_wa_internacional(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_wa_internacional(text) TO orbit_backend;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- El rol del backend es `orbit_backend`, NO `postgres`.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_campanas TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_campana_destinos TO orbit_backend;

-- La pantalla pasa por el backend, no por PostgREST.
REVOKE ALL ON TABLE public.whatsapp_campanas FROM anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_campana_destinos FROM anon, authenticated;

COMMIT;
