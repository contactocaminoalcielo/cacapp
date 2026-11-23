-- 214_aviso_tiempos_ingreso.sql
--
-- AVISO DE TIEMPOS al ingresar al cuarto frío (REPORTE ORBIT 2026-11-20,
-- módulo Bandeja WhatsApp): «en el momento que un servicio entre al cuarto frío
-- se haga envío automático de los tiempos de entrega para los certificados,
-- solicitud de imágenes y entrega de recordatorios».
--
-- Decidido con David el 2026-11-23:
--   · Sale APARTE y AUTOMÁTICO al registrarse `cuarto_frio.fecha_ingreso_real`
--     (job cada 10 min, 7:00 a 20:00; lo que entra de noche sale a las 7:00).
--   · Certificado a 3 días hábiles desde la recogida SOLO en eco-grupal, básico,
--     standard, desamparado, Ángel y básico sin recordatorios. Premium,
--     Exclusivo y Compets no lo llevan (es por solicitud).
--   · Recordatorios: días del plan +2, desde que llegan las fotos.
--   · Compostaje individual: 2 a 3 meses; los recordatorios antes si los pide.
--   · El texto por plan vive en orbit-backend/src/aviso-tiempos-reglas.js.
--
-- Y dos correcciones de catálogo que pidió David el mismo día, para que este
-- aviso y el aviso de plazo (al terminar el portal) digan lo mismo:
--   · Eco-grupal: sus recordatorios son de 8 a 10 días hábiles, no 20 a 22.
--     Solo cambia la fecha límite de lo que reciba fotos DESDE AHORA: el trigger
--     fn_calcular_fecha_entrega la fija una vez, al llegar las fotos.
--   · Memopet: 15 días (estaba en 8). Se ve en el catálogo público y en las
--     ofertas, y el aviso de plazo del Básico lo nombra aparte.
--
-- Arranca APAGADO y sin plantilla: sin plantilla aprobada en Meta no hay nada
-- que mandar. Al encender en /automatizaciones, `arranque_desde` pasa a ser hoy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.avisos_tiempos_ingreso (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id       uuid NOT NULL UNIQUE REFERENCES public.servicios(id) ON DELETE CASCADE,
  plan_codigo       text,
  fecha_ingreso     timestamptz,
  estado            text NOT NULL DEFAULT 'ENVIANDO'
                    CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'ERROR', 'EXCLUIDO')),
  motivo_exclusion  text,
  mensaje           text,
  whatsapp_destino  text,
  linea_wa          text,
  mensaje_id        text,
  fecha_envio       timestamptz,
  enviado_por       uuid REFERENCES public.personal(id),
  intentos          integer NOT NULL DEFAULT 0,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.avisos_tiempos_ingreso IS
  'Aviso a la familia con los tiempos (certificado, fotos, recordatorios) al ingresar al cuarto frío (migr. 214). Uno por servicio. Lo envía el job /jobs/aviso-tiempos; se ve en /automatizaciones.';
COMMENT ON COLUMN public.avisos_tiempos_ingreso.mensaje IS
  'El texto completo tal como lo recibió la familia (plantilla con sus dos variables resueltas).';

CREATE INDEX IF NOT EXISTS idx_avisos_tiempos_estado ON public.avisos_tiempos_ingreso (estado);
CREATE INDEX IF NOT EXISTS idx_avisos_tiempos_envio  ON public.avisos_tiempos_ingreso (fecha_envio);

-- El job busca por ingreso reciente: sin índice recorre los 2.190 del cuarto frío cada 10 min.
CREATE INDEX IF NOT EXISTS idx_cuarto_frio_ingreso_real ON public.cuarto_frio (fecha_ingreso_real);

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('AVISO_TIEMPOS', 'activo', 'false'::jsonb,
   'Interruptor del aviso de tiempos al ingresar al cuarto frío. Encender en /automatizaciones cuando Meta apruebe la plantilla.'),
  ('AVISO_TIEMPOS', 'plantilla', 'null'::jsonb,
   'Plantilla aprobada en la WABA de familias. La siembra scripts/crear-plantilla-aviso-tiempos.mjs estado.'),
  ('AVISO_TIEMPOS', 'arranque_desde', 'null'::jsonb,
   'Solo ingresos desde esta fecha. Se fija sola al encender en /automatizaciones.'),
  ('AVISO_TIEMPOS', 'planes',
   '["ECO_GRUPAL","BASICO","STANDARD","DESAMPARADO","ANGEL","BASICO_SIN_REC","PREMIUM","EXCLUSIVO_VIDEOLLAMADA","EXCLUSIVO_PRESENCIAL","COMPETS_EVIDENCIA","COMPETS_PRESENCIAL","COMPETS_SIN_REC"]'::jsonb,
   'Planes que reciben el aviso. Quitar uno aquí lo saca sin tocar código.'),
  ('AVISO_TIEMPOS', 'planes_certificado',
   '["ECO_GRUPAL","BASICO","STANDARD","DESAMPARADO","ANGEL","BASICO_SIN_REC"]'::jsonb,
   'Planes cuyo aviso dice el tiempo del certificado. En los individuales el certificado es por solicitud.'),
  ('AVISO_TIEMPOS', 'planes_sin_recordatorios',
   '["DESAMPARADO","ANGEL","BASICO_SIN_REC","COMPETS_SIN_REC"]'::jsonb,
   'Planes sin recordatorios: su aviso no habla de fotos ni de recordatorios.'),
  ('AVISO_TIEMPOS', 'dias_certificado', '3'::jsonb,
   'Días hábiles del certificado desde la recogida.'),
  ('AVISO_TIEMPOS', 'meses_compostaje', '"2 a 3"'::jsonb,
   'Lo que dura el compostaje individual, tal como se le dice a la familia.'),
  ('AVISO_TIEMPOS', 'horas_max_atraso', '48'::jsonb,
   'Un ingreso registrado hace más de estas horas ya no recibe el aviso.'),
  ('AVISO_TIEMPOS', 'max_envios_por_corrida', '30'::jsonb,
   'Tope de envíos por corrida del job (corre cada 10 minutos).')
ON CONFLICT (modulo, clave) DO NOTHING;

-- Catálogo (pedido de David, 2026-11-23).
UPDATE public.planes SET dias_entrega_prometidos = 8
 WHERE codigo = 'ECO_GRUPAL' AND dias_entrega_prometidos = 20;
UPDATE public.recordatorios SET tiempo_produccion_dias = 15
 WHERE nombre ILIKE 'memopet%' AND tiempo_produccion_dias = 8;

-- GRANTs + RLS. ⚠️ Sin el GRANT a orbit_backend el job falla MUDO.
GRANT ALL ON TABLE public.avisos_tiempos_ingreso TO postgres, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.avisos_tiempos_ingreso TO orbit_backend;

ALTER TABLE public.avisos_tiempos_ingreso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS avisos_tiempos_auth_all ON public.avisos_tiempos_ingreso;
CREATE POLICY avisos_tiempos_auth_all ON public.avisos_tiempos_ingreso
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (tras aplicar):
--   SELECT count(*) FROM avisos_tiempos_ingreso;                                         -- 0
--   SELECT clave, valor FROM config_operativa WHERE modulo='AVISO_TIEMPOS' ORDER BY clave; -- 10 filas
--   SELECT has_table_privilege('orbit_backend','public.avisos_tiempos_ingreso','INSERT'); -- t
--   SELECT codigo, dias_entrega_prometidos FROM planes WHERE codigo='ECO_GRUPAL';         -- 8
--   SELECT nombre, tiempo_produccion_dias FROM recordatorios WHERE nombre ILIKE 'memopet%'; -- 15, 15
--
-- REVERSA:
--   BEGIN;
--     DROP TABLE IF EXISTS public.avisos_tiempos_ingreso;
--     DELETE FROM public.config_operativa WHERE modulo = 'AVISO_TIEMPOS';
--     UPDATE public.planes SET dias_entrega_prometidos = 20 WHERE codigo = 'ECO_GRUPAL';
--     UPDATE public.recordatorios SET tiempo_produccion_dias = 8 WHERE nombre ILIKE 'memopet%';
--   COMMIT;
-- ============================================================================
