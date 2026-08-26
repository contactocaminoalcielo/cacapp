-- 135 — Prueba en sombra: qué habría contestado otro modelo.
--
-- Para decidir si VETERINARIAS puede bajar de Sonnet a Haiku (~$10/mes, el 40 %
-- de la factura) sin arriesgar el único flujo que ESCRIBE en la operación.
--
-- Dos intentos de compararlos en el banco de pruebas salieron mal montados: el
-- primero corrió sin el bloque <sistema>, así que ninguno de los dos modelos
-- sabía si el número era de una clínica registrada — que es justo lo que decide
-- si hay que verificar. El segundo sí tenía contexto, pero las herramientas
-- seguían apuntando a 'PRUEBA', así que el contexto decía "registrada" y la
-- herramienta respondía "no registrado": los dos modelos recibieron información
-- contradictoria y ninguna conclusión valía.
--
-- La sombra resuelve eso porque corre sobre la conversación REAL, con su
-- contexto real, en el momento real.
--
-- 🩸 LA SOMBRA NO EJECUTA NADA. Una sola pasada al modelo: se guarda el texto y
-- QUÉ herramienta pidió, y ahí se acaba. Si ejecutara, `enviar_material` y
-- `enviar_plantilla` le mandarían mensajes de verdad a las clínicas — una prueba
-- que le escribe a los clientes no es una prueba. Y para lo que queremos saber
-- basta con la decisión: si Haiku pide `registrar_solicitud` sin verificar
-- primero, eso ya se ve en la petición.

BEGIN;

ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS sombra_modelo text,
  ADD COLUMN IF NOT EXISTS sombra_effort text;

COMMENT ON COLUMN public.agente_wa.sombra_modelo IS
  'Modelo a comparar en sombra tras cada turno real. NULL = apagado. No responde a nadie.';

CREATE TABLE IF NOT EXISTS public.agente_wa_sombra (
  id                bigserial PRIMARY KEY,
  agente_id         integer NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  ejecucion_id      bigint,
  contacto          text NOT NULL,
  phone_number_id   text,
  entrada           text,
  -- Lo que de verdad se envió, con el modelo de producción.
  modelo_real       text NOT NULL,
  texto_real        text,
  herramientas_real jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Lo que habría contestado el candidato. NUNCA se envía.
  modelo_sombra     text NOT NULL,
  texto_sombra      text,
  herramientas_sombra jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_entrada    integer,
  tokens_salida     integer,
  error             text,
  -- Lo que una persona anota al revisar: si la sombra habría servido igual.
  veredicto         text,
  nota              text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_wa_sombra_veredicto_chk CHECK
    (veredicto IS NULL OR veredicto IN ('IGUAL', 'SOMBRA_PEOR', 'SOMBRA_MEJOR'))
);

CREATE INDEX IF NOT EXISTS ix_wa_sombra_agente
  ON public.agente_wa_sombra (agente_id, creado_en DESC);

COMMENT ON TABLE public.agente_wa_sombra IS
  'Comparación lado a lado: lo que respondió el modelo en producción y lo que habría respondido el candidato. La sombra nunca se envía ni ejecuta herramientas.';

REVOKE ALL ON public.agente_wa_sombra FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agente_wa_sombra TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.agente_wa_sombra_id_seq TO orbit_backend;

COMMIT;
