-- ============================================================================
-- 003 — Fase 1 Tenjo: modelo de datos de planificacion y operacion
-- Fecha: 2026-06-11
--
-- Crea (todo aditivo, re-ejecutable con IF NOT EXISTS):
--   1. config_operativa      — parametros editables (nada quemado en codigo)
--   2. lotes_tenjo           — jornadas operativas (mar/jue/sab)
--   3. lotes_tenjo_items     — decisiones por mascota (trazabilidad completa)
--   4. alertas_operativas    — alertas persistentes con responsable y gestion
--   5. contactos_cliente     — trazabilidad de contacto asistido
--   6. neveras.destino       — INDIVIDUALES | GRUPALES | MIXTA
--   7. v_candidatos_tenjo    — vista de candidatas (lee custodia, no la administra)
--   8. Indices unicos parciales contra duplicados + GRANTs transicionales
--
-- NOTA ARQUITECTURA: los GRANTs + policy auth_full son COMPATIBILIDAD
-- TRANSITORIA con el acceso actual via PostgREST. La autorizacion real de
-- operaciones criticas migrara al backend propio (orbit-backend, Fase 2).
--
-- Aplicar en VPS Contabo (archivo completo):
--   cat 003_fase1_modelo_tenjo.sql | docker compose exec -T db psql -U postgres -d postgres
-- ============================================================================

-- ─── 1. config_operativa ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.config_operativa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo          text NOT NULL,
  clave           text NOT NULL,
  valor           jsonb NOT NULL,
  descripcion     text,
  actualizado_por uuid REFERENCES public.personal(id),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (modulo, clave)
);

-- ─── 2. lotes_tenjo ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lotes_tenjo (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_lote          text NOT NULL,
  fecha_jornada        date NOT NULL,
  estado               varchar NOT NULL DEFAULT 'PROPUESTO'
    CHECK (estado IN ('PROPUESTO','EN_REVISION','CONFIRMADO','EN_EJECUCION','CERRADO','CANCELADO')),
  generado_por         varchar NOT NULL DEFAULT 'MANUAL'
    CHECK (generado_por IN ('SISTEMA','MANUAL')),
  creado_por           uuid REFERENCES public.personal(id),
  cerrado_por          uuid REFERENCES public.personal(id),
  fecha_cierre         timestamptz,
  observaciones_cierre text,
  novedades            jsonb DEFAULT '[]'::jsonb,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- Un solo lote (no cancelado) por jornada
CREATE UNIQUE INDEX IF NOT EXISTS uq_lote_tenjo_jornada
  ON public.lotes_tenjo (fecha_jornada)
  WHERE estado <> 'CANCELADO';

DROP TRIGGER IF EXISTS trg_lotes_tenjo_updated ON public.lotes_tenjo;
CREATE TRIGGER trg_lotes_tenjo_updated
  BEFORE UPDATE ON public.lotes_tenjo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. lotes_tenjo_items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lotes_tenjo_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id                uuid NOT NULL REFERENCES public.lotes_tenjo(id) ON DELETE CASCADE,
  servicio_id            uuid NOT NULL REFERENCES public.servicios(id),
  traslado_id            uuid REFERENCES public.traslados_tenjo(id),
  clasificacion          varchar NOT NULL DEFAULT 'APTA'
    CHECK (clasificacion IN ('APTA','REQUIERE_VALIDACION','BLOQUEADA','PRESENCIAL_PENDIENTE','EVIDENCIA_REQUERIDA')),
  estado                 varchar NOT NULL DEFAULT 'PROPUESTO'
    CHECK (estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA',
                      'EN_PROCESO','PROCESADO','NO_EJECUTADO','REPROGRAMADO','RETIRADO_DEL_LOTE')),
  bloqueos               jsonb DEFAULT '[]'::jsonb,   -- snapshot de reglas incumplidas
  validaciones           jsonb DEFAULT '[]'::jsonb,   -- pendientes de validar por coordinador
  motivo_reprogramacion  text,
  veces_reprogramada     integer DEFAULT 0,
  confirmacion_cliente   boolean,
  contacto_estado        varchar DEFAULT 'NO_REQUERIDO'
    CHECK (contacto_estado IN ('NO_REQUERIDO','PENDIENTE','CONTACTADO','CONFIRMADO','SIN_RESPUESTA')),
  checklist              jsonb DEFAULT '{}'::jsonb,   -- instancia del checklist por variante
  evidencia_urls         jsonb DEFAULT '[]'::jsonb,
  responsable_proceso_id uuid REFERENCES public.personal(id),
  fecha_inicio_proceso   timestamptz,
  fecha_fin_proceso      timestamptz,
  decidido_por           uuid REFERENCES public.personal(id),
  notas                  text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

-- Una mascota no puede estar en dos lotes activos al mismo tiempo
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_tenjo_activo
  ON public.lotes_tenjo_items (servicio_id)
  WHERE estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO');

CREATE INDEX IF NOT EXISTS idx_lotes_tenjo_items_lote ON public.lotes_tenjo_items (lote_id);

DROP TRIGGER IF EXISTS trg_lotes_tenjo_items_updated ON public.lotes_tenjo_items;
CREATE TRIGGER trg_lotes_tenjo_items_updated
  BEFORE UPDATE ON public.lotes_tenjo_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 4. alertas_operativas (transversal: TENJO, CUARTO_FRIO, ...) ──────────
CREATE TABLE IF NOT EXISTS public.alertas_operativas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id      uuid REFERENCES public.servicios(id),
  lote_id          uuid REFERENCES public.lotes_tenjo(id),
  modulo_origen    varchar NOT NULL DEFAULT 'TENJO',
  tipo_alerta      varchar NOT NULL,
  prioridad        varchar NOT NULL DEFAULT 'MEDIA'
    CHECK (prioridad IN ('INFO','MEDIA','ALTA','CRITICA')),
  mensaje          text NOT NULL,
  accion_recomendada text,
  responsable_id   uuid REFERENCES public.personal(id),
  estado           varchar NOT NULL DEFAULT 'ABIERTA'
    CHECK (estado IN ('ABIERTA','EN_GESTION','RESUELTA','DESCARTADA')),
  clave_dedupe     text,
  metadata         jsonb DEFAULT '{}'::jsonb,
  usuario_resolvio uuid REFERENCES public.personal(id),
  fecha_resolucion timestamptz,
  created_at       timestamptz DEFAULT now()
);

-- El motor de alertas no duplica una alerta abierta del mismo origen
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_abierta
  ON public.alertas_operativas (clave_dedupe)
  WHERE estado IN ('ABIERTA','EN_GESTION') AND clave_dedupe IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alertas_estado ON public.alertas_operativas (estado, modulo_origen);

-- ─── 5. contactos_cliente ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contactos_cliente (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id      uuid REFERENCES public.servicios(id),
  lote_item_id     uuid REFERENCES public.lotes_tenjo_items(id),
  cliente_id       uuid REFERENCES public.clientes(id_cliente),
  canal            varchar NOT NULL DEFAULT 'WHATSAPP_MANUAL'
    CHECK (canal IN ('WHATSAPP_GHL','WHATSAPP_MANUAL','LLAMADA','OTRO')),
  proposito        varchar NOT NULL DEFAULT 'OTRO'
    CHECK (proposito IN ('CONFIRMAR_PRESENCIAL','REPROGRAMACION','NOVEDAD_PAGO','OTRO')),
  mensaje_sugerido text,
  mensaje_enviado  text,
  respuesta_cliente text,
  estado           varchar NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','CONTACTADO','CONFIRMADO','SIN_RESPUESTA','REPROGRAMADO')),
  enviado_por      uuid REFERENCES public.personal(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_contactos_cliente_updated ON public.contactos_cliente;
CREATE TRIGGER trg_contactos_cliente_updated
  BEFORE UPDATE ON public.contactos_cliente
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6. neveras.destino ─────────────────────────────────────────────────────
ALTER TABLE public.neveras
  ADD COLUMN IF NOT EXISTS destino varchar NOT NULL DEFAULT 'MIXTA'
  CHECK (destino IN ('INDIVIDUALES','GRUPALES','MIXTA'));

-- ─── 7. v_candidatos_tenjo ──────────────────────────────────────────────────
-- Solo LEE la custodia (cuarto_frio); no la administra. security_invoker es
-- una opcion nativa de Postgres para que la vista respete los permisos del
-- que consulta mientras el acceso sea via PostgREST.
CREATE OR REPLACE VIEW public.v_candidatos_tenjo
WITH (security_invoker = true) AS
SELECT
  cf.id                                   AS cuarto_frio_id,
  cf.servicio_id,
  s.estado                                AS estado_servicio,
  s.estado_pago,
  s.tipo_acompanamiento,
  m.nombre                                AS mascota,
  esp.nombre                              AS especie,
  COALESCE(cf.peso_kg, m.peso_kg)         AS peso_kg,
  c.id_cliente                            AS cliente_id,
  TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS cliente,
  c.whatsapp                              AS cliente_whatsapp,
  p.nombre                                AS plan,
  p.codigo                                AS codigo_plan,
  p.tipo_proceso,
  cf.nevera_codigo,
  n.destino                               AS nevera_destino,
  cf.estado                               AS estado_cf,
  cf.fecha_ingreso,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - cf.fecha_ingreso)) / 86400)::int AS dias_custodia,
  EXISTS (
    SELECT 1 FROM public.traslados_tenjo t
    WHERE t.servicio_id = cf.servicio_id AND t.estado IN ('PROGRAMADO','EN_CAMINO')
  )                                       AS traslado_activo,
  (
    SELECT li.id FROM public.lotes_tenjo_items li
    WHERE li.servicio_id = cf.servicio_id
      AND li.estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')
    LIMIT 1
  )                                       AS item_activo_id,
  (
    SELECT count(*)::int FROM public.lotes_tenjo_items li2
    WHERE li2.servicio_id = cf.servicio_id AND li2.estado = 'REPROGRAMADO'
  )                                       AS veces_reprogramada
FROM public.cuarto_frio cf
JOIN public.servicios s   ON s.id = cf.servicio_id
JOIN public.planes p      ON p.id = s.plan_id
JOIN public.mascotas m    ON m.id_mascota = s.mascota_id
LEFT JOIN public.especies esp ON esp.id = m.especie_id
LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
LEFT JOIN public.neveras n    ON n.codigo = cf.nevera_codigo
WHERE cf.fecha_salida IS NULL
  AND p.tipo_proceso IN ('CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL')
  AND s.estado NOT IN ('CANCELADO','ENTREGADO');

-- ─── 8. GRANTs + RLS (compatibilidad transitoria con PostgREST) ─────────────
GRANT ALL ON TABLE public.config_operativa    TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.lotes_tenjo         TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.lotes_tenjo_items   TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.alertas_operativas  TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.contactos_cliente   TO postgres, anon, authenticated, service_role;
GRANT SELECT ON public.v_candidatos_tenjo     TO authenticated, service_role;

ALTER TABLE public.config_operativa   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_tenjo        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_tenjo_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_operativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_cliente  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON public.config_operativa;
DROP POLICY IF EXISTS "auth_full" ON public.lotes_tenjo;
DROP POLICY IF EXISTS "auth_full" ON public.lotes_tenjo_items;
DROP POLICY IF EXISTS "auth_full" ON public.alertas_operativas;
DROP POLICY IF EXISTS "auth_full" ON public.contactos_cliente;
CREATE POLICY "auth_full" ON public.config_operativa   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.lotes_tenjo        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.lotes_tenjo_items  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.alertas_operativas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.contactos_cliente  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 9. Seeds de configuracion (no pisa valores ya editados) ────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
 ('TENJO','dias_operacion','[2,4,6]','Dias de jornada Tenjo (0=dom ... 6=sab): martes, jueves, sabado'),
 ('TENJO','dias_planificacion','[1,3,5]','Dias en que se genera la propuesta: lunes, miercoles, viernes'),
 ('TENJO','hora_generacion_propuesta','"06:00"','Hora sugerida para el job de generacion automatica'),
 ('TENJO','dias_custodia_alerta','5','Dias en custodia antes de alerta'),
 ('TENJO','dias_custodia_critica','8','Dias en custodia antes de alerta critica'),
 ('TENJO','max_reprogramaciones','2','Reprogramaciones antes de bloquear y exigir revision'),
 ('TENJO','min_procesos_jornada','4','Minimo sugerido de procesos para jornada eficiente'),
 ('TENJO','hora_limite_cierre_lote','"20:00"','Hora limite para cerrar el lote de la jornada'),
 ('TENJO','hora_limite_confirmar_presencial','"17:00"','Hora limite del dia anterior para confirmar presenciales'),
 ('TENJO','horas_max_cargar_evidencia','24','Horas maximas para cargar evidencias tras finalizar proceso'),
 ('TENJO','planes_evidencia_obligatoria','["COMPETS_EVIDENCIA","COMPETS_PRESENCIAL"]','Codigos de plan con evidencia obligatoria'),
 ('TENJO','planes_confirmacion_cliente','["EXCLUSIVO_PRESENCIAL","EXCLUSIVO_VIDEOLLAMADA","COMPETS_PRESENCIAL"]','Codigos de plan que requieren confirmacion del cliente')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ============================================================================
-- ROLLBACK completo (orden inverso por las FKs):
--   DROP VIEW IF EXISTS public.v_candidatos_tenjo;
--   ALTER TABLE public.neveras DROP COLUMN IF EXISTS destino;
--   DROP TABLE IF EXISTS public.contactos_cliente;
--   DROP TABLE IF EXISTS public.alertas_operativas;
--   DROP TABLE IF EXISTS public.lotes_tenjo_items;
--   DROP TABLE IF EXISTS public.lotes_tenjo;
--   DROP TABLE IF EXISTS public.config_operativa;
-- ============================================================================
