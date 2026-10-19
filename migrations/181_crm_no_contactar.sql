-- ============================================================================
-- 181 — "No contactar": veterinarias y prospectos que no quieren saber nada
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-10-19): marcar a las veterinarias que de verdad no
-- quieren saber nada de la empresa, para no llenarlas de publicidad.
--
-- Qué bloquea (lo hace el backend, no esta migración): campañas masivas —incluso
-- las que ya están en curso—, plantillas y recursos enviados desde el CRM, hitos
-- de agradecimiento, seguimientos, llamadas sugeridas y el agente de ventas.
--
-- Qué NO bloquea, a propósito: la OPERACIÓN. Si una clínica bloqueada igual
-- manda un servicio, le siguen llegando el aviso de hora de recogida, el recibo
-- y el certificado. Cortar eso dejaría un servicio real a medias.
--
-- El bloqueo vive en la fila (aliado o prospecto) y se consulta por TELÉFONO con
-- `fn_crm_no_contactar`: una campaña armada desde un archivo importado no trae
-- id de aliado, solo el número, y también tiene que respetarlo.
--
-- Aditiva e idempotente.
--   cat migrations/181_crm_no_contactar.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.aliados
  ADD COLUMN IF NOT EXISTS no_contactar        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_contactar_motivo text,
  ADD COLUMN IF NOT EXISTS no_contactar_desde  timestamptz,
  ADD COLUMN IF NOT EXISTS no_contactar_por    uuid REFERENCES public.personal(id);

ALTER TABLE public.crm_prospectos
  ADD COLUMN IF NOT EXISTS no_contactar        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_contactar_motivo text,
  ADD COLUMN IF NOT EXISTS no_contactar_desde  timestamptz,
  ADD COLUMN IF NOT EXISTS no_contactar_por    uuid REFERENCES public.personal(id);

-- Bloquear siempre con motivo: dentro de un año nadie recordará por qué.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aliados_no_contactar_con_motivo') THEN
    ALTER TABLE public.aliados ADD CONSTRAINT aliados_no_contactar_con_motivo
      CHECK (NOT no_contactar OR coalesce(trim(no_contactar_motivo), '') <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_prospectos_no_contactar_con_motivo') THEN
    ALTER TABLE public.crm_prospectos ADD CONSTRAINT crm_prospectos_no_contactar_con_motivo
      CHECK (NOT no_contactar OR coalesce(trim(no_contactar_motivo), '') <> '');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aliados_no_contactar ON public.aliados (id_aliado) WHERE no_contactar;
CREATE INDEX IF NOT EXISTS idx_crm_prosp_no_contactar ON public.crm_prospectos (id) WHERE no_contactar;

-- ¿Este número pidió no ser contactado? Por los 10 últimos dígitos, contra
-- aliadas (whatsapp, teléfono, teléfono 2) y prospectos.
CREATE OR REPLACE FUNCTION public.fn_crm_no_contactar(tel text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN public.wa_tel10(tel) IS NULL OR length(public.wa_tel10(tel)) < 10 THEN false ELSE
    EXISTS (SELECT 1 FROM public.aliados a
             WHERE a.no_contactar
               AND public.wa_tel10(tel) IN (public.wa_tel10(a.whatsapp), public.wa_tel10(a.telefono), public.wa_tel10(a.telefono_2)))
    OR EXISTS (SELECT 1 FROM public.crm_prospectos p
             WHERE p.no_contactar
               AND public.wa_tel10(tel) IN (public.wa_tel10(p.whatsapp), public.wa_tel10(p.telefono)))
  END
$$;

GRANT EXECUTE ON FUNCTION public.fn_crm_no_contactar(text) TO orbit_backend, authenticated, service_role;

COMMIT;

-- Verificación:
--   select count(*) from information_schema.columns where column_name = 'no_contactar'
--      and table_name in ('aliados','crm_prospectos');                       -- 2
--   select public.fn_crm_no_contactar('573000000000');                        -- f
