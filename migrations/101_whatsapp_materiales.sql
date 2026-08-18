-- 101 — Materiales que el agente puede enviar: brochure, tarifario, instructivos
--
-- Salió de una petición real. El 14-ago, Quiripets escribió:
--
--   "Buenos días, ¿nos podrías volver a enviar el brochure por favor?"
--   "es que es para brindarle la información a un cliente"
--
-- El agente contestó que no tenía brochure, lo escaló, y el equipo acabó
-- mandándolo POR LA OTRA LÍNEA. Es la petición más fácil de toda la línea —un
-- archivo que ya existe— y era la única que no podía resolver.
--
-- 🔑 CATÁLOGO, no código, igual que los interactivos (100) y las etiquetas (090):
-- David sube el archivo desde la pantalla y la `descripcion` es lo que el modelo
-- lee para saber cuándo mandarlo. Un material nuevo NO exige desplegar.
--
-- Los bytes van en la TABLA, no en un bucket, por lo mismo que la base de
-- conocimiento del agente (088): son pocos archivos, la configuración queda
-- atómica, y un bucket más es un sitio más donde algo puede quedarse sin
-- desplegar. El tope de 16 MB es el de `whatsapp-media.js` para documentos: no
-- se ponen dos topes distintos para lo mismo.
--
-- ⚠️ LÍMITE DE META: como todo lo que no es plantilla, solo sale DENTRO de la
-- ventana de 24 h. `enviarSobre` lo valida antes de subir el archivo.
--
-- 📌 Anotado a propósito: cada envío vuelve a subir el archivo a Meta y deja una
-- copia en `whatsapp_media` (así el coordinador puede abrir desde el hilo lo que
-- se mandó). Es la misma vía que la bandeja, sin caminos nuevos. Si algún día
-- pesa en disco, lo que hay que cachear es el `media_id` de Meta, que dura 30
-- días — no hace falta tocar esta tabla.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_materiales (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave        text        NOT NULL UNIQUE,
  nombre       text        NOT NULL,
  -- Lo que LEE EL AGENTE para decidir si este es el archivo que le piden. Mal
  -- escrita, no lo mandará nunca o lo mandará donde no toca.
  descripcion  text,
  archivo      bytea       NOT NULL,
  mime         text        NOT NULL,
  -- Lo que la clínica ve como título del documento en WhatsApp. Sin él sale un
  -- archivo sin nombre que nadie sabe qué es.
  nombre_archivo text      NOT NULL,
  -- El pie con el que se manda. Va aquí y no lo escribe el modelo: así el
  -- material siempre llega igual, lo mande el agente o una persona.
  pie          text,
  bytes        integer     NOT NULL,
  -- Que exista no significa que el agente pueda mandarlo: habrá material que
  -- solo deba salir de la mano de una persona.
  usa_agente   boolean     NOT NULL DEFAULT true,
  activo       boolean     NOT NULL DEFAULT true,
  orden        integer     NOT NULL DEFAULT 0,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz,
  CONSTRAINT whatsapp_materiales_bytes_chk CHECK (bytes > 0 AND bytes <= 16777216)
);

CREATE INDEX IF NOT EXISTS whatsapp_materiales_activos_idx
  ON public.whatsapp_materiales (orden, id) WHERE activo;

-- Sin semilla: el brochure es un archivo que solo David tiene. La tabla vacía es
-- el estado correcto hasta que lo suba, y el agente no ofrece la herramienta
-- mientras no haya nada que mandar.

-- ⚠️ El backend NO es `postgres`: sin GRANT falla en silencio.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_materiales TO orbit_backend;
-- Los bytes NO salen por PostgREST: se sirven por el backend, con sesión y rol.
REVOKE ALL ON public.whatsapp_materiales FROM anon, authenticated;

COMMIT;
