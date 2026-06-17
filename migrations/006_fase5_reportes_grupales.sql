-- ============================================================================
-- 006 — Fase 5: modelo formal de Reportes Grupales (Eco-grupal / Cremación grupal)
-- Fecha: 2026-06-17
--
-- Objetivo (frase rectora): "Ningún reporte grupal debe emitirse fuera del flujo
-- correcto, duplicado, vencido sin alerta, enviado sin validación o sin
-- trazabilidad de responsable, lote y evidencia."
--
-- Decisiones aprobadas por David (2026-06-17):
--   - SLA: 3 días hábiles desde servicios.fecha_ingreso (inmutable, estricto).
--   - Canal: Zolutium/GHL (Edge Function send-whatsapp) — persistir message_id+contact_id.
--   - Unidad: por destinatario/cliente (evidencia y vencimiento por ítem).
--   - Cambio de plan tras lote: permitir + sacar del lote + alerta (ver migr. frontend).
--
-- NOTA DESPLIEGUE: migración MANUAL por SSH→psql en Contabo (Supabase Cloud está
-- muerto). Aditiva y reversible. No pisa datos. Mirror del patrón Tenjo (003/004).
-- orbit_backend (BYPASSRLS) ya tiene DML por ALTER DEFAULT PRIVILEGES (004).
-- ============================================================================

-- ─── 0. Calendario de días hábiles (festivos Colombia) ──────────────────────
-- ⚠️ VERIFICAR/COMPLETAR con el calendario oficial antes de confiar el SLA.
-- La función degrada con gracia: si falta un festivo, solo cuenta fines de semana
-- (nunca falla). Mantener esta tabla al día cada año.
CREATE TABLE IF NOT EXISTS public.festivos (
  fecha   date PRIMARY KEY,
  nombre  text NOT NULL,
  pais    varchar NOT NULL DEFAULT 'CO'
);

-- Festivos Colombia 2026 (Ley Emiliani + Semana Santa con Pascua = 2026-04-05).
-- Revisar contra fuente oficial; corregir/ampliar libremente.
INSERT INTO public.festivos (fecha, nombre) VALUES
 ('2026-01-01','Año Nuevo'),
 ('2026-01-12','Reyes Magos'),
 ('2026-03-23','San José'),
 ('2026-04-02','Jueves Santo'),
 ('2026-04-03','Viernes Santo'),
 ('2026-05-01','Día del Trabajo'),
 ('2026-05-18','Ascensión del Señor'),
 ('2026-06-08','Corpus Christi'),
 ('2026-06-15','Sagrado Corazón'),
 ('2026-06-29','San Pedro y San Pablo'),
 ('2026-07-20','Independencia'),
 ('2026-08-07','Batalla de Boyacá'),
 ('2026-08-17','Asunción de la Virgen'),
 ('2026-10-12','Día de la Raza'),
 ('2026-11-02','Todos los Santos'),
 ('2026-11-16','Independencia de Cartagena'),
 ('2026-12-08','Inmaculada Concepción'),
 ('2026-12-25','Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- ¿La fecha es día hábil? (lun-vie y no festivo)
CREATE OR REPLACE FUNCTION public.fn_es_dia_habil(p_fecha date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT extract(isodow FROM p_fecha) < 6
     AND NOT EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = p_fecha);
$$;

-- Suma N días hábiles a una fecha (saltando fines de semana y festivos).
-- Equivalente server-side de addDiasHabiles() del front, pero CON festivos.
CREATE OR REPLACE FUNCTION public.fn_sumar_dias_habiles(p_fecha date, p_dias int)
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE d date := p_fecha; n int := 0;
BEGIN
  IF p_fecha IS NULL THEN RETURN NULL; END IF;
  WHILE n < p_dias LOOP
    d := d + 1;
    IF public.fn_es_dia_habil(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END;
$$;

-- ─── 1. reportes_grupales — entidad formal (1:1 con un lote grupal) ──────────
CREATE TABLE IF NOT EXISTS public.reportes_grupales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id          uuid NOT NULL UNIQUE REFERENCES public.lotes_grupales(id),
  tipo_proceso     varchar NOT NULL
    CHECK (tipo_proceso IN ('CREMACION_GRUPAL','COMPOSTAJE_GRUPAL')),
  estado           varchar NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','GENERADO','ENVIANDO','ENVIADO_PARCIAL','ENVIADO','VENCIDO','ERROR')),
  -- PDF del reporte técnico (1 documento por lote). Storage PRIVADO + URL firmada.
  storage_bucket   varchar DEFAULT 'reportes-grupales',
  storage_path     text,
  pdf_generado_en  timestamptz,
  -- SLA: ancla = MIN(fecha_ingreso de los ítems); el vencimiento real vive por ítem.
  fecha_base       date,
  fecha_vencimiento date,
  total_items      int NOT NULL DEFAULT 0,
  enviados         int NOT NULL DEFAULT 0,
  con_error        int NOT NULL DEFAULT 0,
  generado_por     uuid REFERENCES public.personal(id),
  idempotency_key  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  observaciones    text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_reportes_grupales_updated ON public.reportes_grupales;
CREATE TRIGGER trg_reportes_grupales_updated
  BEFORE UPDATE ON public.reportes_grupales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reportes_grupales_estado
  ON public.reportes_grupales (estado, tipo_proceso);

-- ─── 2. reportes_grupales_items — un destinatario/servicio por fila ─────────
CREATE TABLE IF NOT EXISTS public.reportes_grupales_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id       uuid NOT NULL REFERENCES public.reportes_grupales(id) ON DELETE CASCADE,
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id),
  -- Snapshots para auditoría (independientes de cambios posteriores del servicio)
  mascota_nombre   text,
  propietario_nombre text,
  canal_destino    text,            -- número/WhatsApp del propietario al momento
  plan_codigo      text,
  peso_kg          numeric,
  -- SLA por destinatario
  fecha_base       date,            -- = servicios.fecha_ingreso
  fecha_vencimiento date,           -- = fn_sumar_dias_habiles(fecha_base, sla_dias)
  estado           varchar NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','VALIDADO','ENVIADO','ERROR','REENVIADO','VENCIDO','EXCLUIDO')),
  -- Validaciones obligatorias antes de enviar (jsonb: {nombre_mascota,propietario,telefono,plan,...})
  validacion       jsonb DEFAULT '{}'::jsonb,
  datos_completos  boolean NOT NULL DEFAULT false,
  motivo_exclusion text,            -- p.ej. cambio de plan, cancelado, pasó a individual
  enviado_en       timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT uq_item_reporte_servicio UNIQUE (reporte_id, servicio_id)
);

DROP TRIGGER IF EXISTS trg_reportes_grupales_items_updated ON public.reportes_grupales_items;
CREATE TRIGGER trg_reportes_grupales_items_updated
  BEFORE UPDATE ON public.reportes_grupales_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CRITERIO #8: un servicio NO puede estar en dos reportes activos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_servicio_activo
  ON public.reportes_grupales_items (servicio_id)
  WHERE estado IN ('PENDIENTE','VALIDADO','ENVIADO','REENVIADO','VENCIDO');

CREATE INDEX IF NOT EXISTS idx_items_reporte ON public.reportes_grupales_items (reporte_id, estado);
CREATE INDEX IF NOT EXISTS idx_items_vencimiento ON public.reportes_grupales_items (fecha_vencimiento)
  WHERE estado IN ('PENDIENTE','VALIDADO');

-- ─── 3. reportes_grupales_envios — trazabilidad por intento de envío ────────
CREATE TABLE IF NOT EXISTS public.reportes_grupales_envios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          uuid NOT NULL REFERENCES public.reportes_grupales_items(id) ON DELETE CASCADE,
  reporte_id       uuid NOT NULL REFERENCES public.reportes_grupales(id) ON DELETE CASCADE,
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id),
  canal            varchar NOT NULL DEFAULT 'WHATSAPP_ZOLUTIUM',
  destino          text,
  pdf_url          text,            -- URL (firmada) realmente enviada
  message_id       text,            -- de GHL/Zolutium (evidencia)
  contact_id       text,            -- de GHL/Zolutium (evidencia)
  estado           varchar NOT NULL DEFAULT 'ENVIADO'
    CHECK (estado IN ('ENVIADO','ERROR')),
  error            text,
  es_reenvio       boolean NOT NULL DEFAULT false,
  motivo_reenvio   text,            -- CRITERIO #7: reenvío exige motivo
  idempotency_key  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  enviado_por      uuid REFERENCES public.personal(id),
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envios_item ON public.reportes_grupales_envios (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_envios_reporte ON public.reportes_grupales_envios (reporte_id);

-- ─── 4. reportes_grupales_eventos — auditoría append-only ───────────────────
CREATE TABLE IF NOT EXISTS public.reportes_grupales_eventos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id       uuid REFERENCES public.reportes_grupales(id) ON DELETE CASCADE,
  item_id          uuid REFERENCES public.reportes_grupales_items(id) ON DELETE CASCADE,
  servicio_id      uuid REFERENCES public.servicios(id),
  tipo_evento      varchar NOT NULL,  -- CREADO|GENERADO|VALIDADO|ENVIADO|ERROR|REENVIO|VENCIDO|EXCLUIDO_CAMBIO_PLAN|ALERTA
  detalle          jsonb DEFAULT '{}'::jsonb,
  actor            uuid REFERENCES public.personal(id),  -- NULL = SISTEMA/IA
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_reporte ON public.reportes_grupales_eventos (reporte_id, created_at DESC);

-- ─── 5. GRANTs + RLS (compatibilidad transitoria con PostgREST) ─────────────
-- Mismo criterio que 003: hardening por rol se hará en supabase/security/ aparte.
GRANT ALL ON TABLE public.festivos                     TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reportes_grupales            TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reportes_grupales_items      TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reportes_grupales_envios     TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reportes_grupales_eventos    TO postgres, anon, authenticated, service_role;

ALTER TABLE public.festivos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_grupales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_grupales_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_grupales_envios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_grupales_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON public.festivos;
DROP POLICY IF EXISTS "auth_full" ON public.reportes_grupales;
DROP POLICY IF EXISTS "auth_full" ON public.reportes_grupales_items;
DROP POLICY IF EXISTS "auth_full" ON public.reportes_grupales_envios;
DROP POLICY IF EXISTS "auth_full" ON public.reportes_grupales_eventos;
CREATE POLICY "auth_full" ON public.festivos                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.reportes_grupales         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.reportes_grupales_items   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.reportes_grupales_envios  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.reportes_grupales_eventos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 6. Seeds de configuración (no pisa valores ya editados) ────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
 ('REPORTES_GRUPALES','sla_dias_habiles','3','Días hábiles desde fecha_ingreso para enviar el reporte grupal'),
 ('REPORTES_GRUPALES','dias_aviso_previo','1','Días hábiles antes del vencimiento para alertar "próximo a vencer"'),
 ('REPORTES_GRUPALES','fecha_base','"fecha_ingreso"','Columna ancla del SLA (decisión David 2026-06-17)'),
 ('REPORTES_GRUPALES','clasificacion_por','"tipo_proceso"','Clasificación eco/cremación por planes.tipo_proceso'),
 ('REPORTES_GRUPALES','override_cremacion_codigos','[]','Códigos de plan que SIEMPRE son cremación grupal aunque su tipo_proceso difiera (ej. presequiales). Verificar Bronce/Plata/Básico/Ángel/Desamparado/Standard'),
 ('REPORTES_GRUPALES','override_compostaje_codigos','[]','Códigos de plan que SIEMPRE son eco-grupal'),
 ('REPORTES_GRUPALES','canal_envio','"WHATSAPP_ZOLUTIUM"','Canal de envío del reporte al cliente'),
 ('REPORTES_GRUPALES','usar_plantilla','false','Enviar como plantilla HSM aprobada (true cuando el reporte sale fuera de la ventana de 24h)'),
 ('REPORTES_GRUPALES','plantilla_nombre','""','Nombre exacto de la plantilla aprobada en Zolutium/GHL (ej. reporte_grupal)'),
 ('REPORTES_GRUPALES','plantilla_idioma','"es"','Código de idioma de la plantilla (es / es_CO)')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ============================================================================
-- ROLLBACK completo (orden inverso por las FKs):
--   DELETE FROM public.config_operativa WHERE modulo = 'REPORTES_GRUPALES';
--   DROP TABLE IF EXISTS public.reportes_grupales_eventos;
--   DROP TABLE IF EXISTS public.reportes_grupales_envios;
--   DROP TABLE IF EXISTS public.reportes_grupales_items;
--   DROP TABLE IF EXISTS public.reportes_grupales;
--   DROP FUNCTION IF EXISTS public.fn_sumar_dias_habiles(date, int);
--   DROP FUNCTION IF EXISTS public.fn_es_dia_habil(date);
--   DROP TABLE IF EXISTS public.festivos;
-- ============================================================================
