-- 100 — Mensajes interactivos de WhatsApp: botones, menús y botón de enlace
--
-- Meta permite tres cosas que hoy no usamos al enviar: botones de respuesta
-- (hasta 3), un menú de lista (hasta 10 filas) y un botón que abre una URL.
-- Recibirlos ya funcionaba desde la 086 (`[botón] …`, `[lista] …`); lo que
-- faltaba era mandarlos.
--
-- 🔑 NO van escritos en el código: son un CATÁLOGO que David edita, igual que
-- las plantillas. El agente elige de él por su clave, y la `descripcion` es lo
-- que lee para saber cuándo usar cada uno — el mismo patrón que ya funciona con
-- `whatsapp_etiquetas` y `clasificar_conversacion`. Así se añade un menú nuevo
-- sin tocar el motor ni desplegar.
--
-- ⚠️ LÍMITE DE META QUE MANDA SOBRE TODO ESTO: los interactivos solo se pueden
-- enviar DENTRO de la ventana de 24 h. Fuera hace falta una plantilla aprobada.
-- Sirven para la conversación viva, no para el primer contacto en frío.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_interactivos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave        text        NOT NULL UNIQUE,
  nombre       text        NOT NULL,
  -- Lo que LEE EL AGENTE para decidir si este es el mensaje que toca. Si está
  -- mal escrita, el agente no lo usará nunca o lo usará donde no debe.
  descripcion  text,
  tipo         text        NOT NULL,
  encabezado   text,
  cuerpo       text        NOT NULL,
  pie          text,
  -- BOTONES: se ignora · LISTA: el rótulo que abre el menú · CTA_URL: el rótulo
  -- del botón.
  boton_texto  text,
  -- BOTONES → [{"id":"si","titulo":"Sí"}]
  -- LISTA    → [{"titulo":"Planes","filas":[{"id":"basico","titulo":"Básico","descripcion":"…"}]}]
  opciones     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Solo CTA_URL. Admite {{enlace_registro}}, que resuelve el servidor con el
  -- enlace de ESA clínica — nunca se escribe un enlace personal a mano aquí.
  url          text,
  -- Que exista no significa que el agente pueda usarlo: hay mensajes que solo
  -- debería mandar una persona.
  usa_agente   boolean     NOT NULL DEFAULT true,
  activo       boolean     NOT NULL DEFAULT true,
  orden        integer     NOT NULL DEFAULT 0,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz,
  CONSTRAINT whatsapp_interactivos_tipo_chk
    CHECK (tipo IN ('BOTONES', 'LISTA', 'CTA_URL')),
  -- Un CTA sin URL es un botón que no lleva a ninguna parte; Meta lo rechaza
  -- con un error que no dice cuál es el problema.
  CONSTRAINT whatsapp_interactivos_cta_chk
    CHECK (tipo <> 'CTA_URL' OR (url IS NOT NULL AND btrim(url) <> ''))
);

CREATE INDEX IF NOT EXISTS whatsapp_interactivos_activos_idx
  ON public.whatsapp_interactivos (orden, id) WHERE activo;

-- ── Semillas: los dos que ya sabemos que hacen falta ────────────────────────
--
-- 1) El enlace de registro como BOTÓN. Hoy va como una URL pegada en el texto;
--    un botón se toca y no se copia mal. Es lo que más manda esta línea.
INSERT INTO public.whatsapp_interactivos
  (clave, nombre, descripcion, tipo, cuerpo, boton_texto, url, orden)
SELECT 'ENLACE_REGISTRO', 'Enlace de registro (botón)',
       'El enlace del portal para que la clínica registre ella misma el servicio, como botón. '
       || 'Úsalo en lugar de pegar la dirección cuando le pases el enlace de registro.',
       'CTA_URL',
       'Con este botón registras el servicio tú mismo, eligiendo el plan con los precios a la vista.',
       'Registrar servicio', '{{enlace_registro}}', 0
WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_interactivos WHERE clave = 'ENLACE_REGISTRO');

-- 2) Dónde se recoge. Es de las pocas preguntas con solo dos respuestas
--    posibles, y de ella depende la dirección a la que va el técnico.
INSERT INTO public.whatsapp_interactivos
  (clave, nombre, descripcion, tipo, cuerpo, opciones, orden)
SELECT 'DONDE_RECOGER', 'Dónde se recoge',
       'Pregunta si la recogida es en la clínica o en la casa de la familia, con dos botones. '
       || 'Úsalo cuando estés tomando los datos y falte ese dato.',
       'BOTONES',
       '¿Dónde recogemos a la mascota?',
       '[{"id":"veterinaria","titulo":"En la clínica"},{"id":"domicilio","titulo":"En la casa"}]'::jsonb,
       1
WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_interactivos WHERE clave = 'DONDE_RECOGER');

-- ⚠️ El backend NO es `postgres`: sin GRANT falla en silencio.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_interactivos TO orbit_backend;
REVOKE ALL ON public.whatsapp_interactivos FROM anon, authenticated;

COMMIT;
