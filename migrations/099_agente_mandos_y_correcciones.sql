-- 099 — Los mandos del agente y el circuito de correcciones
--
-- Hasta ahora, ajustar al agente era cosa de un desarrollador: el retraso vivía
-- en una variable de entorno del contenedor y las correcciones se hacían
-- reescribiendo el contexto a mano. David pidió poder hacerlo él.
--
-- Dos cosas distintas:
--
--  1. TIEMPOS. `espera_ms` es cuánto calla el agente esperando a que la
--     veterinaria termine de escribir (manda los mensajes de tres en tres), y
--     `espera_max_ms` el techo desde el primero. Estaban en
--     AGENTE_WA_ESPERA_MS/AGENTE_WA_ESPERA_MAX_MS, así que cambiarlos exigía
--     tocar el .env y recrear el contenedor.
--
--  2. CORRECCIONES. Se marca en el propio chat si una respuesta estuvo bien o
--     mal y se escribe qué debió decir. Eso NO entra solo al agente: queda como
--     valoración y David decide cuáles ascienden a REGLA. Se eligió así a
--     propósito — que cada corrección entrara sola haría crecer el contexto sin
--     control y dos correcciones que se contradigan vuelven al agente errático
--     sin que nadie se entere.

BEGIN;

-- ── 1. Tiempos, editables desde la pantalla ─────────────────────────────────
ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS espera_ms     integer NOT NULL DEFAULT 12000,
  ADD COLUMN IF NOT EXISTS espera_max_ms integer NOT NULL DEFAULT 30000;

ALTER TABLE public.agente_wa DROP CONSTRAINT IF EXISTS agente_wa_espera_chk;
ALTER TABLE public.agente_wa
  ADD CONSTRAINT agente_wa_espera_chk CHECK (
    espera_ms     BETWEEN 0 AND 120000 AND
    espera_max_ms BETWEEN 0 AND 300000 AND
    -- El techo por debajo de la espera partiría la ráfaga justo en el hueco que
    -- la espera intenta cubrir: es la configuración que no debe poder guardarse.
    espera_max_ms >= espera_ms
  );

-- ── 2. Valoración de una respuesta concreta ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agente_wa_valoraciones (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mensaje_id   bigint      NOT NULL REFERENCES public.whatsapp_mensajes(id) ON DELETE CASCADE,
  agente_id    integer     NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  buena        boolean     NOT NULL,
  correccion   text,
  estado       text        NOT NULL DEFAULT 'NUEVA',
  personal_id  uuid        REFERENCES public.personal(id) ON DELETE SET NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  resuelto_en  timestamptz,
  CONSTRAINT agente_wa_valoraciones_estado_chk
    CHECK (estado IN ('NUEVA', 'APLICADA', 'DESCARTADA'))
);

-- Una valoración por mensaje: volver a marcarlo lo REEMPLAZA (el backend hace
-- upsert). Sin esto, dos clics seguidos dejarían dos opiniones del mismo
-- coordinador sobre la misma respuesta.
CREATE UNIQUE INDEX IF NOT EXISTS agente_wa_valoraciones_mensaje_uq
  ON public.agente_wa_valoraciones (mensaje_id);

CREATE INDEX IF NOT EXISTS agente_wa_valoraciones_pendientes_idx
  ON public.agente_wa_valoraciones (creado_en DESC)
  WHERE estado = 'NUEVA';

-- ── 3. Reglas: lo que sí llega al agente ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agente_wa_reglas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agente_id      integer     NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  texto          text        NOT NULL,
  activo         boolean     NOT NULL DEFAULT true,
  orden          integer     NOT NULL DEFAULT 0,
  -- De qué corrección salió, para poder volver a la conversación que la motivó.
  valoracion_id  bigint      REFERENCES public.agente_wa_valoraciones(id) ON DELETE SET NULL,
  creado_por     uuid        REFERENCES public.personal(id) ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agente_wa_reglas_activas_idx
  ON public.agente_wa_reglas (agente_id, orden, id) WHERE activo;

-- ⚠️ El backend NO es `postgres`: sin GRANT falla en silencio.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agente_wa_valoraciones TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agente_wa_reglas       TO orbit_backend;

-- Nada se expone por PostgREST: la UI habla con el backend propio.
REVOKE ALL ON public.agente_wa_valoraciones FROM anon, authenticated;
REVOKE ALL ON public.agente_wa_reglas       FROM anon, authenticated;

COMMIT;
