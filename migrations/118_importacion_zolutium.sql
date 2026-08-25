-- 118 — Importación aislada de historiales desde Zolutium/LeadConnector
--
-- La línea todavía no tiene `phone_number_id` de Meta. Por eso no se puede
-- escribir directamente en whatsapp_mensajes: aparecería en la bandeja con una
-- identidad falsa y después podría salir una respuesta por la línea equivocada.
-- Estas tablas son una zona de preparación privada y reanudable. Solo
-- `publicar` mueve los registros validados a la bandeja, ya con el id de Meta.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_importaciones (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor                text NOT NULL DEFAULT 'ZOLUTIUM',
  location_id              text NOT NULL,
  linea_origen             text NOT NULL,
  phone_number_id_destino  text,
  estado                   text NOT NULL DEFAULT 'NUEVA',
  provider_ids             text[] NOT NULL DEFAULT '{}',
  desde                    timestamptz,
  hasta                    timestamptz,
  mensajes_vistos          bigint NOT NULL DEFAULT 0,
  mensajes_seleccionados   bigint NOT NULL DEFAULT 0,
  conversaciones           bigint NOT NULL DEFAULT 0,
  contactos                bigint NOT NULL DEFAULT 0,
  adjuntos                 bigint NOT NULL DEFAULT 0,
  plantillas               bigint NOT NULL DEFAULT 0,
  error                    text,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  actualizado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_importaciones_estado_check CHECK
    (estado IN ('NUEVA','CAPTURANDO','CAPTURADA','PUBLICANDO','COMPLETA','ERROR')),
  CONSTRAINT whatsapp_importaciones_linea_check CHECK (linea_origen ~ '^[0-9]{8,15}$'),
  UNIQUE (proveedor, location_id, linea_origen)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_import_ventanas (
  importacion_id    uuid NOT NULL REFERENCES public.whatsapp_importaciones(id) ON DELETE CASCADE,
  desde             timestamptz NOT NULL,
  hasta             timestamptz NOT NULL,
  estado            text NOT NULL DEFAULT 'PENDIENTE',
  intentos          integer NOT NULL DEFAULT 0,
  paginas           integer NOT NULL DEFAULT 0,
  mensajes_vistos   bigint NOT NULL DEFAULT 0,
  seleccionados     bigint NOT NULL DEFAULT 0,
  error             text,
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (importacion_id, desde, hasta),
  CONSTRAINT whatsapp_import_ventanas_estado_check CHECK
    (estado IN ('PENDIENTE','PROCESANDO','COMPLETA','ERROR')),
  CONSTRAINT whatsapp_import_ventanas_rango_check CHECK (hasta > desde)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_import_mensajes (
  importacion_id          uuid NOT NULL REFERENCES public.whatsapp_importaciones(id) ON DELETE CASCADE,
  external_id             text NOT NULL,
  alt_id                  text,
  conversation_id         text,
  contact_id              text,
  provider_id             text,
  contacto                text NOT NULL,
  direccion               text NOT NULL,
  tipo                    text NOT NULL DEFAULT 'text',
  texto                   text,
  estado                  text,
  ocurrido_en             timestamptz NOT NULL,
  attachment_urls         jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (importacion_id, external_id),
  CONSTRAINT whatsapp_import_mensajes_direccion_check CHECK (direccion IN ('IN','OUT'))
);

CREATE INDEX IF NOT EXISTS ix_wa_import_mensajes_hilo
  ON public.whatsapp_import_mensajes (importacion_id, contacto, ocurrido_en);
CREATE INDEX IF NOT EXISTS ix_wa_import_mensajes_contact
  ON public.whatsapp_import_mensajes (importacion_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_import_contactos (
  importacion_id  uuid NOT NULL REFERENCES public.whatsapp_importaciones(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  telefono        text,
  nombre          text,
  email           text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (importacion_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_import_adjuntos (
  importacion_id  uuid NOT NULL,
  external_id     text NOT NULL,
  indice          integer NOT NULL DEFAULT 0,
  url_origen      text NOT NULL,
  mime            text,
  bytes           integer,
  sha256          text,
  archivo         bytea,
  error           text,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (importacion_id, external_id, indice),
  FOREIGN KEY (importacion_id, external_id)
    REFERENCES public.whatsapp_import_mensajes(importacion_id, external_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.whatsapp_import_plantillas (
  importacion_id  uuid NOT NULL REFERENCES public.whatsapp_importaciones(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  nombre          text,
  payload         jsonb NOT NULL,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (importacion_id, external_id)
);

COMMENT ON TABLE public.whatsapp_importaciones IS
  'Lotes privados y reanudables para migrar una línea sin mezclarla con otras ni despertar agentes.';
COMMENT ON TABLE public.whatsapp_import_mensajes IS
  'Solo mensajes cuyo from/to corresponde a linea_origen; nunca se almacenan chats de otras líneas.';
COMMENT ON COLUMN public.whatsapp_importaciones.phone_number_id_destino IS
  'Identificador de Meta asignado después de migrar el número. Es obligatorio para publicar.';

REVOKE ALL ON public.whatsapp_importaciones, public.whatsapp_import_ventanas,
  public.whatsapp_import_mensajes, public.whatsapp_import_contactos,
  public.whatsapp_import_adjuntos, public.whatsapp_import_plantillas
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_importaciones,
  public.whatsapp_import_ventanas, public.whatsapp_import_mensajes,
  public.whatsapp_import_contactos, public.whatsapp_import_adjuntos,
  public.whatsapp_import_plantillas TO orbit_backend;

COMMIT;
