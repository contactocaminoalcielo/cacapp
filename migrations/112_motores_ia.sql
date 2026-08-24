-- 112 — El motor de IA deja de estar quemado: se elige por agente.
--
-- Lo que pide David: crear un agente entero desde Orbit, eligiendo con qué
-- motor piensa (Claude, ChatGPT, el que sea) y con qué modelo. Es la última
-- pieza para que un agente sea DEFINICIÓN y no código, que es lo que permite
-- traer otra línea —y la empresa hermana— sin programar nada.
--
-- Hasta hoy `agente_wa.modelo` guardaba un id de modelo y el código daba por
-- hecho que era de Anthropic: la forma de las herramientas, la caché de
-- contexto, el razonamiento y hasta los campos de consumo son propios de esa
-- API. Cambiar de proveedor no era cambiar un texto, era otro dialecto.
--
-- 🩸 EL CATÁLOGO ES UNA TABLA, NO UNA LISTA EN EL CÓDIGO. Salen modelos nuevos
-- cada pocas semanas; si la lista vive en un `const`, cada modelo nuevo es un
-- despliegue. Y lo que es peor: el día que uno se retire, el agente sigue
-- pidiéndolo y falla en silencio hasta que alguien lo note.

BEGIN;

-- ── 1. Con qué motor piensa cada agente ───────────────────────────────────
ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS proveedor text NOT NULL DEFAULT 'ANTHROPIC';

-- ── 2. El catálogo de motores ─────────────────────────────────────────────
--
-- Las CAPACIDADES no son adorno: la pantalla esconde lo que el motor no sabe
-- hacer, y el backend no manda parámetros que la otra API rechazaría. Sin esto,
-- elegir un modelo sin razonamiento y dejar el selector de esfuerzo puesto
-- produce un error 400 que no menciona ni al modelo ni al esfuerzo.
CREATE TABLE IF NOT EXISTS public.ia_motores (
  id        serial PRIMARY KEY,
  proveedor text NOT NULL,              -- ANTHROPIC | OPENAI | …
  -- El id EXACTO que viaja en la petición. No se valida contra una lista
  -- nuestra: es el proveedor quien manda, y así un modelo nuevo se añade desde
  -- la pantalla el mismo día que sale.
  modelo    text NOT NULL,
  etiqueta  text NOT NULL,              -- lo que lee una persona
  ayuda     text,
  razona    boolean NOT NULL DEFAULT false,  -- admite profundidad de razonamiento
  cachea    boolean NOT NULL DEFAULT false,  -- admite caché de contexto explícita
  ve        boolean NOT NULL DEFAULT true,   -- puede mirar imágenes
  activo    boolean NOT NULL DEFAULT true,
  orden     integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proveedor, modelo)
);

-- Los de Anthropic, que son los que están medidos y en uso.
INSERT INTO public.ia_motores (proveedor, modelo, etiqueta, ayuda, razona, cachea, ve, orden) VALUES
  ('ANTHROPIC', 'claude-haiku-4-5',  'Claude Haiku 4.5',
   'El más barato y rápido. Suele bastar para responder desde una base de conocimiento.',
   false, true, true, 1),
  ('ANTHROPIC', 'claude-sonnet-5',   'Claude Sonnet 5',
   'Equilibrado. Mejor criterio cuando la conversación se sale del guion. Es el que usa hoy la línea de veterinarias.',
   true, true, true, 2),
  ('ANTHROPIC', 'claude-opus-4-8',   'Claude Opus 4.8',
   'Muy capaz y caro. Lo usa el análisis de cuadres en Finanzas.',
   true, true, true, 3),
  ('ANTHROPIC', 'claude-opus-5',     'Claude Opus 5',
   'El más capaz de la familia. Solo si los otros se quedan cortos: cuesta más del doble que Sonnet.',
   true, true, true, 4)
ON CONFLICT (proveedor, modelo) DO NOTHING;

-- ⚠️ OPENAI VA SIN MODELOS A PROPÓSITO. No hay `OPENAI_API_KEY` en el servidor,
-- así que no se ha podido probar ni uno solo — y sembrar identificadores de
-- memoria es la forma segura de que el día que alguien lo elija falle con un
-- "modelo no encontrado" que no dice nada. Los añade David desde la pantalla
-- con el id exacto que le dé su cuenta, que es quien manda.
--
-- Lo mismo con los precios: `costos_precios` no lleva filas de OpenAI. Los
-- tokens se contarán igual desde el primer día; el valor en dinero aparece
-- cuando se carguen las tarifas, como ya pasa con ElevenLabs.

-- ── 3. Permisos ───────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ia_motores TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.ia_motores_id_seq        TO orbit_backend;
REVOKE ALL ON TABLE public.ia_motores FROM anon, authenticated;

COMMIT;
