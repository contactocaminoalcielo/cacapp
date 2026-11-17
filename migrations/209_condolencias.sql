-- 209_condolencias.sql
--
-- CONDOLENCIAS: un mensaje de acompañamiento a la familia al cumplirse un mes
-- del fallecimiento de su mascotica (REPORTE ORBIT 2026-11-17).
--
-- Reglas (decididas con David el 2026-11-17):
--   · Base = mascotas.fecha_fallecimiento + 30 días (`dias_desde_fallecimiento`).
--   · SOLO a quien ya se le entregó: servicios.estado = 'ENTREGADO'. Se mide por
--     el SERVICIO, no por los ítems: en prod muchos servicio_recordatorios se
--     quedan en PENDIENTE/LISTO aunque el servicio ya se entregó (en eco-grupal,
--     72 de 259 entregados tienen todos sus ítems en ENTREGADO).
--   · Nunca antes de `dias_tras_entrega` (3) días después de la entrega: así no
--     se pisa con la encuesta post-entrega, que sale al día siguiente.
--     fecha_programada = GREATEST(fallecimiento + 30, entrega + 3).
--   · ~30 % de los servicios se entrega DESPUÉS del día 30 (en Compets
--     individual, el 90 %; mediana 73 días). `incluir_entrega_tardia` decide si
--     esos reciben la condolencia al entregarse (true) o quedan EXCLUIDOS (false).
--   · Exclusiones automáticas: plan DESAMPARADO (no hay familia) y cliente sin
--     WhatsApp válido. Coordinación puede excluir/reincluir a mano.
--   · Solo de aquí en adelante: `arranque_desde` = hoy. Nada de atrasadas.
--
-- Un registro por servicio (UNIQUE): la condolencia no se repite.
-- Estados: PENDIENTE (programada) → ENVIANDO → ENVIADO | ERROR; EXCLUIDO.
-- Los nombres siguen a los demás flujos para que /automatizaciones los entienda.

BEGIN;

CREATE TABLE IF NOT EXISTS public.condolencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id         uuid NOT NULL UNIQUE REFERENCES public.servicios(id) ON DELETE CASCADE,
  fecha_fallecimiento date,
  fecha_entrega       date,
  fecha_programada    date NOT NULL,
  estado              text NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'ERROR', 'EXCLUIDO')),
  motivo_exclusion    text,
  excluido_por        uuid REFERENCES public.personal(id),
  excluido_en         timestamptz,
  whatsapp_destino    text,
  linea_wa            text,
  mensaje_id          text,
  fecha_envio         timestamptz,
  enviado_por         uuid REFERENCES public.personal(id),
  intentos            integer NOT NULL DEFAULT 0,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.condolencias IS
  'Mensaje de condolencias a la familia al mes del fallecimiento (migr. 209). Uno por servicio. Lo prepara y envía el job /jobs/condolencias; se ve en /condolencias.';
COMMENT ON COLUMN public.condolencias.fecha_programada IS
  'GREATEST(fallecimiento + dias_desde_fallecimiento, entrega + dias_tras_entrega). Sábado, domingo y festivo salen el siguiente día hábil.';
COMMENT ON COLUMN public.condolencias.motivo_exclusion IS
  'Por qué no se envía: automático (Desamparado, sin WhatsApp, entrega tardía, cancelado) o el que escribió coordinación.';

CREATE INDEX IF NOT EXISTS idx_condolencias_estado_fecha
  ON public.condolencias (estado, fecha_programada);
CREATE INDEX IF NOT EXISTS idx_condolencias_fecha
  ON public.condolencias (fecha_programada);

-- Configuración. Arranca APAGADO: sin plantilla aprobada en Meta no hay nada que mandar.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('CONDOLENCIAS', 'activo', 'false'::jsonb,
   'Interruptor de las condolencias. Encender en /automatizaciones cuando Meta apruebe la plantilla.'),
  ('CONDOLENCIAS', 'plantilla', 'null'::jsonb,
   'Plantilla aprobada en la WABA de familias. La siembra scripts/crear-plantilla-condolencias.mjs estado.'),
  ('CONDOLENCIAS', 'arranque_desde', to_jsonb(public.fn_hoy_bogota()::text),
   'Solo condolencias programadas desde esta fecha (anti-blast del histórico).'),
  ('CONDOLENCIAS', 'dias_desde_fallecimiento', '30'::jsonb,
   'Días entre el fallecimiento y la condolencia.'),
  ('CONDOLENCIAS', 'dias_tras_entrega', '3'::jsonb,
   'Mínimo de días después de la entrega (no pisar la encuesta post-entrega).'),
  ('CONDOLENCIAS', 'incluir_entrega_tardia', 'true'::jsonb,
   'true: si se entregó después del mes, sale dias_tras_entrega después de entregar. false: queda EXCLUIDA.'),
  ('CONDOLENCIAS', 'dias_max_desde_fallecimiento', '120'::jsonb,
   'Si la fecha programada cae más allá de estos días del fallecimiento, no se programa.'),
  ('CONDOLENCIAS', 'dias_max_atraso', '4'::jsonb,
   'Una condolencia programada hace más de estos días ya no se envía (cubre fin de semana + festivo).'),
  ('CONDOLENCIAS', 'max_envios_por_corrida', '60'::jsonb,
   'Tope de envíos por corrida del job.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- GRANTs + RLS. ⚠️ Sin el GRANT a orbit_backend el job falla MUDO.
GRANT ALL ON TABLE public.condolencias TO postgres, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.condolencias TO orbit_backend;

ALTER TABLE public.condolencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS condolencias_auth_all ON public.condolencias;
CREATE POLICY condolencias_auth_all ON public.condolencias
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (tras aplicar):
--   SELECT count(*) FROM condolencias;                                   -- 0
--   SELECT clave, valor FROM config_operativa WHERE modulo='CONDOLENCIAS' ORDER BY clave;  -- 9 filas
--   SELECT has_table_privilege('orbit_backend','public.condolencias','INSERT');           -- t
--
-- REVERSA:
--   BEGIN;
--     DROP TABLE IF EXISTS public.condolencias;
--     DELETE FROM public.config_operativa WHERE modulo = 'CONDOLENCIAS';
--   COMMIT;
-- ============================================================================
