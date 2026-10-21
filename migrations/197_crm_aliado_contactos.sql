-- Migración 197: contactos múltiples por veterinaria aliada
-- Permite registrar dueño, administrador, auxiliar, encargado, etc.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_aliado_contactos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id   uuid        NOT NULL REFERENCES public.aliados(id_aliado) ON DELETE CASCADE,
  nombre      text        NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 160),
  rol         text        NOT NULL DEFAULT 'OTRO'
              CHECK (rol IN ('DUENO','ADMINISTRADOR','AUXILIAR','ENCARGADO','OTRO')),
  telefono    text,
  whatsapp    text,
  email       text,
  notas       text,
  principal   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_aliado_contactos_aliado
  ON public.crm_aliado_contactos(aliado_id);

GRANT ALL ON public.crm_aliado_contactos TO orbit_backend;

COMMIT;
