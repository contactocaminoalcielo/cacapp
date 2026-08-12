-- 094 — Los archivos que mandan por WhatsApp
--
-- Hasta hoy de una foto solo quedaba el rastro "[imagen]" y, con suerte, el pie
-- de foto. El archivo se perdía: Meta lo guarda unos días y nadie lo bajaba. Una
-- veterinaria mandando la foto de la mascota, del recibo o de la dirección
-- escrita a mano estaba hablando con una pared.
--
-- Meta NO manda el archivo en el webhook: manda un `id`. Bajarlo son dos
-- llamadas (id → URL firmada → bytes) y la URL vive minutos. O se baja en el
-- momento, o se pierde.
--
-- ¿Por qué `bytea` y no un bucket? Mismo criterio que la base de conocimiento
-- del agente (migración 088): son pocos y pequeños, el agente los necesita en
-- base64 de todos modos, y así la conversación es UNA cosa que se respalda y se
-- borra junta. Los comprobantes ya enseñaron lo que pasa cuando el archivo vive
-- en un sitio y la fila en otro: divergen. Ver `feedback_comprobantes_dos_fuentes`.
--
-- Tabla aparte y no una columna en `whatsapp_mensajes` a propósito: ahí un
-- `SELECT *` distraído se traería megabytes de fotos en cada refresco de la
-- bandeja.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_media (
  id           bigserial PRIMARY KEY,
  -- CASCADE: borrar una conversación de prueba se lleva sus archivos. Sin esto
  -- quedarían huérfanos y ocupando, que es la basura que nadie encuentra.
  mensaje_id   bigint NOT NULL REFERENCES public.whatsapp_mensajes(id) ON DELETE CASCADE,
  wa_media_id  text,
  mime         text,
  bytes        integer,
  sha256       text,
  -- NULL con `error` puesto = se intentó y no se pudo. Distinguirlo de "no se
  -- ha intentado" es lo que permite reintentar sin adivinar.
  archivo      bytea,
  error        text,
  creado_en    timestamptz NOT NULL DEFAULT now()
);

-- Un archivo por mensaje: Meta manda un adjunto por mensaje.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_media_mensaje_uq
  ON public.whatsapp_media (mensaje_id);

COMMENT ON TABLE public.whatsapp_media IS
  'Archivos recibidos por WhatsApp, bajados de Meta en el momento (su URL vive minutos).';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- El rol del backend es `orbit_backend`, NO `postgres`: sin estos GRANT el
-- webhook responde 200 y no guarda nada.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_media TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_media_id_seq        TO orbit_backend;

-- Nadie más la toca: la UI pide los bytes al backend, que valida sesión y rol.
-- Por PostgREST saldrían fotos de conversaciones a cualquiera con un JWT.
REVOKE ALL ON TABLE public.whatsapp_media FROM anon, authenticated;

COMMIT;
