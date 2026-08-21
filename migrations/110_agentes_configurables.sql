-- 110 — Que un agente se DEFINA desde Orbit, no desde el código.
--
-- El objetivo, en palabras de David: "una estructura de agente, pero la
-- definición la damos nosotros y no programada — con eso lo reutilizamos cuando
-- metamos la otra empresa".
--
-- Lo que faltaba para eso, mirado de verdad:
--
--   · TRES de las cinco herramientas YA se construyen desde catálogos
--     editables (materiales, interactivos, etiquetas). Eso ya estaba bien.
--     El problema era que esos catálogos son GLOBALES: dos agentes
--     compartirían brochure, menús y etiquetas.
--   · LAS OTRAS DOS están quemadas en `agente-wa.js`, y son justo las del
--     negocio: `enviar_enlace_registro` y `registrar_solicitud` escriben en la
--     operación de Camino al Cielo. Un agente de otra empresa las heredaría
--     tal cual y le ofrecería a sus clientes registrarse en una funeraria de
--     mascotas de Bogotá.
--
-- 🩸 LO QUE **NO** SE PUEDE VOLVER DATO: lo que una herramienta HACE. Registrar
-- una solicitud es código y va a seguir siéndolo. Lo que sí pasa a ser dato es
-- QUÉ herramientas tiene cada agente y CÓMO se le describen al modelo — que es
-- donde estaba el candado para reutilizar esto.

BEGIN;

-- ── 1. Los tres catálogos, por agente ─────────────────────────────────────
--
-- `agente_id` nulo = "de todos", para no romper nada mientras se migra y para
-- dejar sitio a catálogos comunes de verdad si algún día hacen falta.
-- Lo que existe hoy se asigna al agente de veterinarias, que es de quien es.

ALTER TABLE public.whatsapp_materiales
  ADD COLUMN IF NOT EXISTS agente_id integer REFERENCES public.agente_wa(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_interactivos
  ADD COLUMN IF NOT EXISTS agente_id integer REFERENCES public.agente_wa(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_etiquetas
  ADD COLUMN IF NOT EXISTS agente_id integer REFERENCES public.agente_wa(id) ON DELETE CASCADE;

UPDATE public.whatsapp_materiales   SET agente_id = (SELECT min(id) FROM public.agente_wa) WHERE agente_id IS NULL;
UPDATE public.whatsapp_interactivos SET agente_id = (SELECT min(id) FROM public.agente_wa) WHERE agente_id IS NULL;

-- ⚠️ Las etiquetas `solo_sistema` NO son de nadie: las pone el servidor cuando
-- el agente revienta o cuando llega algo que no puede leer. Si se le asignan a
-- un agente, el siguiente se queda sin la única señal que avisa de los fallos
-- mudos (ver migración 093).
UPDATE public.whatsapp_etiquetas SET agente_id = (SELECT min(id) FROM public.agente_wa)
 WHERE agente_id IS NULL AND NOT solo_sistema;

-- 🩸 La clave era única EN TODA LA TABLA. Con dos agentes eso impide que cada
-- uno tenga su propio "brochure" o su propia etiqueta "PRECIOS" — les obligaría
-- a inventarse nombres distintos para lo mismo. Ahora la clave es única DENTRO
-- de cada agente.
ALTER TABLE public.whatsapp_materiales   DROP CONSTRAINT whatsapp_materiales_clave_key;
ALTER TABLE public.whatsapp_interactivos DROP CONSTRAINT whatsapp_interactivos_clave_key;
ALTER TABLE public.whatsapp_etiquetas    DROP CONSTRAINT whatsapp_etiquetas_clave_key;

-- NULLS NOT DISTINCT para que dos catálogos comunes (agente_id nulo) no puedan
-- repetir clave entre ellos: sin eso, PostgreSQL trata cada NULL como distinto
-- y dejaría colar duplicados exactos.
CREATE UNIQUE INDEX uq_wa_materiales_clave
  ON public.whatsapp_materiales (agente_id, clave) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX uq_wa_interactivos_clave
  ON public.whatsapp_interactivos (agente_id, clave) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX uq_wa_etiquetas_clave
  ON public.whatsapp_etiquetas (agente_id, clave) NULLS NOT DISTINCT;

-- ── 2. Qué herramientas tiene CADA agente ─────────────────────────────────
--
-- La implementación es código (registrar una solicitud escribe en la operación
-- y eso no se configura desde una pantalla). Lo que se configura es si este
-- agente la tiene, y con qué palabras se le explica al modelo.
--
-- `descripcion` nula = la que trae el código. Ponerle texto la reemplaza, y eso
-- es lo que permite que la misma herramienta se le explique distinto a dos
-- empresas sin tocar una línea.
CREATE TABLE IF NOT EXISTS public.agente_wa_herramientas (
  id          serial PRIMARY KEY,
  agente_id   integer NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  -- Casa con una implementación del motor. No es texto libre: si no existe la
  -- implementación, la herramienta sencillamente no se ofrece.
  clave       text NOT NULL,
  activa      boolean NOT NULL DEFAULT true,
  descripcion text,
  -- Para lo que cada empresa necesite parametrizar sin cambiar código: un
  -- enlace propio, un identificador de formulario, un destinatario.
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  orden       integer NOT NULL DEFAULT 0,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agente_id, clave)
);

-- El agente de hoy conserva EXACTAMENTE lo que tiene ahora. Esta migración no
-- puede cambiarle nada al que está en producción atendiendo clínicas.
INSERT INTO public.agente_wa_herramientas (agente_id, clave, orden)
SELECT a.id, h.clave, h.orden
  FROM public.agente_wa a
  CROSS JOIN (VALUES
    ('enviar_enlace_registro', 1),
    ('registrar_solicitud',    2),
    ('enviar_interactivo',     3),
    ('enviar_material',        4),
    ('clasificar_conversacion',5)
  ) AS h(clave, orden)
ON CONFLICT (agente_id, clave) DO NOTHING;

-- ── 3. La cara del agente ─────────────────────────────────────────────────
-- Para la lista y para el menú: un agente necesita nombre corto y con qué
-- saludar. Hoy el saludo de voz está quemado ("Camino al Cielo, buenas") —
-- con dos empresas eso no puede seguir en el código.
ALTER TABLE public.agente_wa ADD COLUMN IF NOT EXISTS etiqueta_menu text;
ALTER TABLE public.agente_wa ADD COLUMN IF NOT EXISTS saludo_voz    text;

UPDATE public.agente_wa
   SET etiqueta_menu = COALESCE(etiqueta_menu, 'Veterinarias'),
       saludo_voz    = COALESCE(saludo_voz, 'Camino al Cielo, buenas. ¿En qué te puedo ayudar?')
 WHERE clave = 'VETERINARIAS';

-- ── Permisos ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agente_wa_herramientas TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.agente_wa_herramientas_id_seq        TO orbit_backend;
REVOKE ALL ON TABLE public.agente_wa_herramientas FROM anon, authenticated;

COMMIT;
