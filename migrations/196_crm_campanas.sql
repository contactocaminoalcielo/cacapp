-- Módulo de campañas CRM (migración 196)
-- Permite programar envíos masivos de plantillas WA a la cartera de aliados
-- y/o prospectos, con seguimiento de embudo por destinatario.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_campanas (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text        NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 160),
  descripcion         text,
  estado              text        NOT NULL DEFAULT 'BORRADOR'
                      CHECK (estado IN ('BORRADOR','LISTA','ENVIANDO','COMPLETADA','CANCELADA')),
  tipo_audiencia      text        NOT NULL DEFAULT 'ACTIVAS'
                      CHECK (tipo_audiencia IN ('TODAS','ACTIVAS','ENFRIANDOSE','EN_RIESGO','DORMIDAS','PROSPECTOS','MANUAL')),
  plantilla_nombre    text,
  idioma              text        NOT NULL DEFAULT 'es_MX',
  variables_plantilla jsonb,
  agente_id           integer     REFERENCES public.agente_wa(id) ON DELETE SET NULL,
  programada_para     timestamptz,
  total               integer     NOT NULL DEFAULT 0,
  enviados            integer     NOT NULL DEFAULT 0,
  fallidos            integer     NOT NULL DEFAULT 0,
  creado_por          uuid        REFERENCES public.personal(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_campana_envios (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campana_id      uuid        NOT NULL REFERENCES public.crm_campanas(id) ON DELETE CASCADE,
  aliado_id       uuid        REFERENCES public.aliados(id_aliado) ON DELETE SET NULL,
  prospecto_id    uuid        REFERENCES public.crm_prospectos(id) ON DELETE SET NULL,
  nombre_destino  text,
  numero_wa       text        NOT NULL,
  estado          text        NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE','ENVIADO','FALLIDO')),
  wam_id          text,
  enviado_en      timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campana_envios_campana
  ON public.crm_campana_envios(campana_id);
CREATE INDEX IF NOT EXISTS idx_crm_campana_envios_aliado
  ON public.crm_campana_envios(aliado_id) WHERE aliado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_campanas_estado
  ON public.crm_campanas(estado);

GRANT ALL ON public.crm_campanas        TO orbit_backend;
GRANT ALL ON public.crm_campana_envios  TO orbit_backend;

COMMIT;
