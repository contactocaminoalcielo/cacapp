-- 088_agente_wa.sql
-- Agente conversacional de la línea de veterinarias.
--
-- DECISIÓN DE DISEÑO (David, 2026-08-06): el agente es AISLADO. No consulta la
-- operación (servicios, clientes, aliados, cuadres). Todo lo que sabe sale de
-- dos sitios y de ningún otro:
--   1. `agente_wa.instrucciones`  — el contexto que se configura desde la UI
--   2. `agente_wa_conocimiento`   — la base de conocimiento que se le carga
-- Su única escritura sobre la operación es dejar una fila en
-- `solicitudes_servicio` (origen='AGENTE_WA'), que cae en la columna
-- Solicitudes del Kanban para que el coordinador apruebe o descarte.
--
-- Nada de esto se expone por PostgREST: la pantalla de configuración habla con
-- el backend propio (/api/agente/...), según la arquitectura objetivo.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El agente y su contexto
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agente_wa (
  id                integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  clave             text        NOT NULL UNIQUE,
  nombre            text        NOT NULL,

  -- Apagado por defecto A PROPÓSITO. Un despliegue no debe poder dejar al
  -- agente hablando solo con veterinarias sin que alguien lo encienda.
  activo            boolean     NOT NULL DEFAULT false,

  -- El contexto. Es TODO lo que define su comportamiento y su conocimiento
  -- base; se edita desde la pantalla de configuración.
  instrucciones     text        NOT NULL DEFAULT '',

  modelo            text        NOT NULL DEFAULT 'claude-opus-5',
  effort            text        NOT NULL DEFAULT 'medium'
                                CHECK (effort IN ('low','medium','high','xhigh','max')),

  -- Tope de respuestas del agente por conversación. Al superarlo deja de
  -- responder y la conversación queda para un humano: es el freno si algo se
  -- descontrola (bucle, cliente insistente, prompt mal configurado).
  max_turnos        integer     NOT NULL DEFAULT 20 CHECK (max_turnos BETWEEN 1 AND 200),

  -- Líneas donde actúa. Vacío = no actúa en ninguna (fail-closed, igual que
  -- WHATSAPP_ALLOWED_PHONE_IDS en el receptor).
  phone_number_ids  text[]      NOT NULL DEFAULT '{}',

  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_por   uuid        REFERENCES public.personal(id) ON DELETE SET NULL
);

COMMENT ON TABLE  public.agente_wa IS
  'Agente conversacional de WhatsApp. Aislado: solo sabe lo de instrucciones + agente_wa_conocimiento.';
COMMENT ON COLUMN public.agente_wa.activo IS
  'Interruptor. false = el agente no responde nada, la bandeja funciona normal.';
COMMENT ON COLUMN public.agente_wa.phone_number_ids IS
  'phone_number_id de Meta donde el agente actúa. Vacío = ninguno (fail-closed).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Base de conocimiento
-- ─────────────────────────────────────────────────────────────────────────────
-- Los archivos se guardan en la propia tabla (bytea) en vez de en un bucket:
-- son pocos y pequeños, Claude necesita las imágenes en base64 de todos modos,
-- y así la configuración del agente es atómica — no hay forma de que la fila
-- exista y el archivo no.

CREATE TABLE IF NOT EXISTS public.agente_wa_conocimiento (
  id          bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  agente_id   integer     NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,

  tipo        text        NOT NULL CHECK (tipo IN ('TEXTO','TABLA','IMAGEN','DOCUMENTO')),
  titulo      text        NOT NULL,

  -- TEXTO / TABLA / DOCUMENTO viajan como texto en el contexto.
  -- TABLA se guarda ya convertida a Markdown; DOCUMENTO, con el texto extraído.
  texto       text,

  -- IMAGEN viaja como bloque de imagen. Tope de 5 MB por pieza: por encima de
  -- eso el coste por conversación se dispara y conviene recortarla antes.
  archivo     bytea,
  mime        text,
  bytes       integer     CHECK (bytes IS NULL OR bytes <= 5242880),

  orden       integer     NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,

  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid        REFERENCES public.personal(id) ON DELETE SET NULL,

  -- Cada pieza tiene contenido de su tipo, y solo de su tipo.
  CONSTRAINT agente_wa_conocimiento_contenido_chk CHECK (
    (tipo = 'IMAGEN' AND archivo IS NOT NULL AND mime IS NOT NULL AND texto IS NULL)
    OR
    (tipo <> 'IMAGEN' AND texto IS NOT NULL AND archivo IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS agente_wa_conocimiento_agente_idx
  ON public.agente_wa_conocimiento (agente_id, orden, id) WHERE activo;

COMMENT ON TABLE public.agente_wa_conocimiento IS
  'Base de conocimiento del agente: textos, tablas, imágenes y documentos que se le cargan desde la UI.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bitácora de ejecuciones
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin esto no hay forma de saber POR QUÉ el agente contestó lo que contestó.
-- Es lo que permite ajustar el contexto con evidencia en vez de a ciegas.

CREATE TABLE IF NOT EXISTS public.agente_wa_ejecuciones (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  agente_id        integer     NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,

  contacto         text,
  phone_number_id  text,

  -- 'PRUEBA' = disparado desde el panel de la UI; 'WHATSAPP' = mensaje real.
  origen           text        NOT NULL DEFAULT 'WHATSAPP'
                               CHECK (origen IN ('WHATSAPP','PRUEBA')),

  entrada          text,
  salida           text,
  herramientas     jsonb,
  tokens_entrada   integer,
  tokens_salida    integer,
  error            text,

  creado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agente_wa_ejecuciones_recientes_idx
  ON public.agente_wa_ejecuciones (agente_id, creado_en DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. actualizado_en automático
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_agente_wa_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agente_wa_touch ON public.agente_wa;
CREATE TRIGGER trg_agente_wa_touch
  BEFORE UPDATE ON public.agente_wa
  FOR EACH ROW EXECUTE FUNCTION public.fn_agente_wa_touch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Semilla: el agente de veterinarias, APAGADO
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.agente_wa (clave, nombre, activo, instrucciones)
VALUES (
  'VETERINARIAS',
  'Agente línea veterinarias',
  false,
  'Eres el asistente de WhatsApp de Camino al Cielo para veterinarias aliadas.'
  || E'\n\nResponde únicamente con la información de tu base de conocimiento. '
  || 'Si te preguntan algo que no está ahí, dilo con naturalidad y ofrece pasar '
  || 'la conversación a una persona del equipo. Nunca inventes precios, tiempos '
  || 'ni condiciones.'
)
ON CONFLICT (clave) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Marcar en solicitudes_servicio qué solicitudes trajo el agente
-- ─────────────────────────────────────────────────────────────────────────────
-- NO se añade 'AGENTE_WA' a solicitudes_servicio.origen a propósito. Ese CHECK
-- solo admite CLIENTE|ALIADO, y un valor nuevo rompería DOS cosas en silencio:
--   · NotificacionesAliados.jsx filtra `origen !== 'ALIADO'` → coordinación
--     dejaría de recibir el aviso de solicitud nueva.
--   · Kanban.jsx decide con `origen === 'ALIADO'` si viene del portal de
--     aliados; al convertir tomaría la otra rama y perdería `aliado_origen_id`,
--     que es de donde sale la COMISIÓN DEL ALIADO. Un bug de dinero.
-- `origen` describe de quién viene la solicitud (una veterinaria = ALIADO);
-- el canal por el que entró es otra dimensión y va en su propia columna.

ALTER TABLE public.solicitudes_servicio
  ADD COLUMN IF NOT EXISTS agente_id integer
    REFERENCES public.agente_wa(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.solicitudes_servicio.agente_id IS
  'Agente de WhatsApp que capturó la solicitud. NULL = la creó una persona (portal o registro manual).';

CREATE INDEX IF NOT EXISTS solicitudes_servicio_agente_idx
  ON public.solicitudes_servicio (agente_id) WHERE agente_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Permisos
-- ─────────────────────────────────────────────────────────────────────────────
-- Nadie entra por PostgREST: la UI pasa por /api/agente/*. El rol del backend
-- es `orbit_backend` y necesita GRANT explícito — sin el de la SECUENCIA el
-- INSERT falla con "permission denied for sequence" y el síntoma es silencioso.

REVOKE ALL ON TABLE public.agente_wa              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agente_wa_conocimiento FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agente_wa_ejecuciones  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.agente_wa              TO postgres, service_role;
GRANT ALL ON TABLE public.agente_wa_conocimiento TO postgres, service_role;
GRANT ALL ON TABLE public.agente_wa_ejecuciones  TO postgres, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agente_wa              TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agente_wa_conocimiento TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agente_wa_ejecuciones  TO orbit_backend;

-- Las secuencias de las columnas IDENTITY.
GRANT USAGE, SELECT ON SEQUENCE public.agente_wa_id_seq              TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.agente_wa_conocimiento_id_seq TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.agente_wa_ejecuciones_id_seq  TO orbit_backend;

REVOKE ALL    ON FUNCTION public.fn_agente_wa_touch() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_agente_wa_touch() TO orbit_backend;

ALTER TABLE public.agente_wa              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_wa_conocimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_wa_ejecuciones  ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: nadie llega por PostgREST. postgres y service_role
-- bypasean RLS; orbit_backend tiene BYPASSRLS.

COMMIT;
