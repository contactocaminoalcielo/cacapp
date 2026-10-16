-- ============================================================================
-- 178 — Evidencias del inicio del proceso, enmarcadas y enviadas a la familia
-- Fecha: 2026-10-16 · Reporte Orbit (planta de Tenjo, urgencia alta/media)
--
-- Hasta hoy el operario sube las fotos al iniciar el proceso (migración 051:
-- altar + horno en cremación, dos del cubículo en compostaje) y coordinación
-- las decoraba con un marco a mano y se las mandaba a la familia por WhatsApp.
--
-- Ahora Orbit lo prepara solo (decisiones de David, 2026-10-16):
--   · SOLO compostaje individual con acompañamiento EVIDENCIA (Compets
--     evidencia). Cremación no; quien estuvo presente o en videollamada ya lo vio.
--   · Al iniciar el proceso se crea una fila POR_REVISAR con las dos fotos del
--     cubículo. Nada sale sin revisión: coordinación ajusta el encuadre y la
--     frase (como en el memorial), ve el marco final y envía con un clic.
--   · Llega DENTRO del mensaje: plantilla con imagen de cabecera. Como una
--     plantilla lleva una sola imagen, las dos fotos van en el mismo marco.
--
-- El marco NO se guarda como archivo: se dibuja en el backend (Chromium, el de
-- los PDFs) a partir de las fotos originales y los ajustes.
--
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.evidencias_familia (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id       uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  lote_item_id      uuid REFERENCES public.lotes_tenjo_items(id) ON DELETE SET NULL,
  estado            text NOT NULL DEFAULT 'POR_REVISAR'
                    CHECK (estado IN ('POR_REVISAR','ENVIADO','ERROR','DESCARTADA')),
  tipo_proceso      text,
  fecha_inicio      timestamptz,
  -- [{clave,label,url,incluir,zoom,posX,posY}] — las fotos y su encuadre.
  fotos             jsonb NOT NULL DEFAULT '[]'::jsonb,
  frase             text,
  -- Línea del pie, antes de la fecha. Vacía = solo la fecha.
  leyenda           text,
  formato           text NOT NULL DEFAULT 'horizontal' CHECK (formato IN ('horizontal','vertical')),
  whatsapp_destino  text,
  linea_wa          text,
  mensaje_id        text,
  error             text,
  intentos          integer NOT NULL DEFAULT 0,
  fecha_envio       timestamptz,
  -- MANUAL = coordinación la mandó por su cuenta (bajó las fotos) y lo marcó.
  medio_envio       text CHECK (medio_envio IS NULL OR medio_envio IN ('PLANTILLA','MANUAL')),
  revisado_por      uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Una por servicio: candado anti-duplicado de quien la prepara.
  CONSTRAINT uq_evidencia_familia_servicio UNIQUE (servicio_id)
);

COMMENT ON TABLE public.evidencias_familia IS
  'Evidencias del inicio del proceso que se le mandan a la familia, enmarcadas. Una por servicio. Migración 178.';
COMMENT ON COLUMN public.evidencias_familia.fotos IS
  'Fotos y encuadre: [{clave,label,url,incluir,zoom,posX,posY}]. El marco se dibuja al vuelo desde aquí.';

CREATE INDEX IF NOT EXISTS idx_evid_familia_estado ON public.evidencias_familia (estado, created_at DESC);

DROP TRIGGER IF EXISTS trg_evidencias_familia_touch ON public.evidencias_familia;
CREATE TRIGGER trg_evidencias_familia_touch BEFORE UPDATE ON public.evidencias_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_plantas_touch();

-- ─── Configuración ──────────────────────────────────────────────────────────
-- `arranque_desde` = hoy: no se preparan las de procesos ya iniciados (esas
-- ya se mandaron a mano). La plantilla arranca en NULL: mientras Meta no la
-- apruebe, coordinación puede bajar las fotos enmarcadas y marcarlas enviadas.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('EVIDENCIA_INICIO', 'activo', 'true'::jsonb,
   'Prepara las evidencias del inicio del proceso para revisión de coordinación.'),
  ('EVIDENCIA_INICIO', 'plantilla', 'null'::jsonb,
   'Plantilla HSM aprobada con cabecera de IMAGEN: {"nombre","idioma","vars":["nombre","mascota"]}. NULL → solo descarga y envío manual.'),
  ('EVIDENCIA_INICIO', 'arranque_desde', '"2026-10-16"'::jsonb,
   'No preparar evidencias de procesos iniciados antes de esta fecha.'),
  ('EVIDENCIA_INICIO', 'acompanamientos', '["EVIDENCIA"]'::jsonb,
   'Tipos de acompañamiento a los que se les mandan las fotos.'),
  ('EVIDENCIA_INICIO', 'fotos_por_proceso',
   '{"COMPOSTAJE_INDIVIDUAL":["cubiculo_1","cubiculo_2"]}'::jsonb,
   'Qué fotos de evidencia_inicio van a la familia, por tipo de proceso. Solo los procesos listados aquí reciben evidencia.'),
  ('EVIDENCIA_INICIO', 'planes_excluidos', '["COMPETS_PRESENCIAL"]'::jsonb,
   'Planes que nunca reciben la evidencia aunque el servicio diga acompañamiento EVIDENCIA.'),
  ('EVIDENCIA_INICIO', 'frase', '"Siempre en nuestro recuerdo"'::jsonb,
   'Frase por defecto del marco (se puede cambiar en cada envío).'),
  ('EVIDENCIA_INICIO', 'leyenda', '"Inicio de su proceso de compostaje"'::jsonb,
   'Línea del pie antes de la fecha (se puede cambiar o dejar vacía en cada envío).')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── GRANTs + RLS (patrón de la 149) ────────────────────────────────────────
GRANT ALL ON TABLE public.evidencias_familia TO postgres, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evidencias_familia TO orbit_backend;

ALTER TABLE public.evidencias_familia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidencias_familia_auth_sel ON public.evidencias_familia;
-- El personal la LEE (pestaña, conteo); toda escritura pasa por el backend.
CREATE POLICY evidencias_familia_auth_sel ON public.evidencias_familia
  FOR SELECT TO authenticated USING (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICAR:
--   SELECT * FROM public.config_operativa WHERE modulo = 'EVIDENCIA_INICIO';
--   SELECT estado, count(*) FROM public.evidencias_familia GROUP BY 1;
--
-- ROLLBACK:
--   BEGIN;
--     DROP TABLE IF EXISTS public.evidencias_familia;
--     DELETE FROM public.config_operativa WHERE modulo = 'EVIDENCIA_INICIO';
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
