-- ============================================================================
-- Eutanasia compasiva — modelo de servicio independiente (Fase 1)
-- Fecha: 2026-06-17
--
-- Objetivo: dejar de tratar la eutanasia como "recordatorio adicional" y
-- modelarla como un SERVICIO PROPIO con flujo, estado, veterinario, agenda,
-- pago, evidencia y trazabilidad. Vinculable OPCIONALMENTE a un servicio
-- funerario (plan), sin mezclarse con él.
--
-- 100% ADITIVO: tablas nuevas + 1 columna nullable en `servicios` para el
-- vínculo inverso. NO toca el pipeline funerario (Kanban, Cuarto Frío, Tenjo,
-- certificados, producción, reportes grupales) — ninguna query existente lee
-- estas tablas, así que no hay contaminación posible.
--
-- Forward-compatible con un futuro modelo de "caso/orden" (Opción 3): se
-- reserva `eutanasias.caso_id` (uuid nullable, sin FK aún) para agrupar líneas.
--
-- Aplicar por SSH en Contabo (producción):
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < este_archivo
--
-- Idempotente: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS.
-- Se puede correr más de una vez sin error.
-- ============================================================================

BEGIN;

-- ─── 1. veterinarios (proveedores que EJECUTAN la eutanasia) ────────────────
-- Distinto de `aliados` (clínicas que REFIEREN). Un veterinario puede o no
-- pertenecer a una clínica aliada (aliado_id nullable).
CREATE TABLE IF NOT EXISTS public.veterinarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  telefono   text,
  whatsapp   text,
  email      text,
  zonas      text[],                                   -- cobertura geográfica (opcional)
  aliado_id  uuid REFERENCES public.aliados(id_aliado),-- clínica a la que pertenece, si aplica
  activo     boolean NOT NULL DEFAULT true,
  notas      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS veterinarios_activo_idx   ON public.veterinarios (activo);
CREATE INDEX IF NOT EXISTS veterinarios_aliado_id_idx ON public.veterinarios (aliado_id);

-- ─── 2. eutanasia_tarifas (precio por peso, editable desde Configuración) ───
-- Lookup: primera tarifa activa cuyo peso_max_kg cubre el peso (NULL = "o más").
--   SELECT precio FROM eutanasia_tarifas
--    WHERE activo AND (peso_max_kg IS NULL OR :peso_kg <= peso_max_kg)
--    ORDER BY peso_max_kg NULLS LAST LIMIT 1;
-- peso_min_kg es informativo (para mostrar el rango); el lookup usa peso_max_kg.
CREATE TABLE IF NOT EXISTS public.eutanasia_tarifas (
  id            serial PRIMARY KEY,
  peso_min_kg   numeric NOT NULL,
  peso_max_kg   numeric,                 -- NULL = sin tope (último rango)
  precio        numeric NOT NULL CHECK (precio >= 0),
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  activo        boolean NOT NULL DEFAULT true
);

-- Seed de tarifas vigentes (confirmadas por David 2026-06-17): 180/200/230/280k
-- 0-10kg=$180.000 · 11-20kg=$200.000 · 21-30kg=$230.000 · 31kg+=$280.000
INSERT INTO public.eutanasia_tarifas (peso_min_kg, peso_max_kg, precio)
SELECT * FROM (VALUES
  (0::numeric,  10::numeric,   180000::numeric),
  (11::numeric, 20::numeric,   200000::numeric),
  (21::numeric, 30::numeric,   230000::numeric),
  (31::numeric, NULL::numeric, 280000::numeric)
) AS v(peso_min_kg, peso_max_kg, precio)
WHERE NOT EXISTS (SELECT 1 FROM public.eutanasia_tarifas);

-- ─── 3. eutanasias (entidad central del servicio) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.eutanasias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cliente y mascota (la mascota SIEMPRE se registra en `mascotas`,
  -- decisión de David 2026-06-17 — consistencia con el resto del sistema).
  cliente_id          uuid NOT NULL REFERENCES public.clientes(id_cliente),
  mascota_id          uuid NOT NULL REFERENCES public.mascotas(id_mascota),
  peso_kg             numeric,                 -- redundante con mascota, fijado al cotizar

  -- Logística
  direccion           text,
  ciudad              text,
  fecha_solicitada    date,
  hora_solicitada     time,
  veterinario_id      uuid REFERENCES public.veterinarios(id),

  -- Estado operativo PROPIO (no hereda los de `servicios`).
  estado              text NOT NULL DEFAULT 'SOLICITADA'
                      CHECK (estado IN (
                        'SOLICITADA','PENDIENTE_CONFIRMACION','PROGRAMADA',
                        'VETERINARIO_ASIGNADO','EN_CAMINO','REALIZADA',
                        'CANCELADA','NO_EFECTIVA','CERRADA')),

  -- Pago PROPIO (independiente del pago del plan funerario).
  estado_pago         text NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado_pago IN ('PENDIENTE','PARCIAL','COMPLETO')),
  valor               numeric,                 -- autocalculado por peso, editable
  valor_pagado        numeric NOT NULL DEFAULT 0,
  metodo_pago         text,
  cobro_conjunto      boolean NOT NULL DEFAULT false,  -- true = se cobra junto con el plan

  -- Vínculo OPCIONAL con plan funerario (relacionado, NO fundido).
  servicio_id         uuid REFERENCES public.servicios(id),
  requiere_recoleccion boolean NOT NULL DEFAULT false,

  -- Responsable y trazabilidad
  responsable_id      uuid REFERENCES public.personal(id),
  observaciones       text,
  motivo_cancelacion  text,
  motivo_no_efectiva  text,
  accion_siguiente    text,

  -- Reservado para futuro modelo de caso/orden (Opción 3). Sin FK todavía.
  caso_id             uuid,

  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.personal(id),
  realizada_at        timestamptz,
  cerrada_at          timestamptz
);

CREATE INDEX IF NOT EXISTS eutanasias_cliente_id_idx     ON public.eutanasias (cliente_id);
CREATE INDEX IF NOT EXISTS eutanasias_mascota_id_idx     ON public.eutanasias (mascota_id);
CREATE INDEX IF NOT EXISTS eutanasias_veterinario_id_idx ON public.eutanasias (veterinario_id);
CREATE INDEX IF NOT EXISTS eutanasias_servicio_id_idx    ON public.eutanasias (servicio_id);
CREATE INDEX IF NOT EXISTS eutanasias_estado_idx         ON public.eutanasias (estado);
CREATE INDEX IF NOT EXISTS eutanasias_fecha_idx          ON public.eutanasias (fecha_solicitada);

-- Una eutanasia se vincula a lo sumo a UN servicio funerario.
CREATE UNIQUE INDEX IF NOT EXISTS eutanasias_servicio_id_uidx
  ON public.eutanasias (servicio_id) WHERE servicio_id IS NOT NULL;

-- ─── 4. eutanasia_evidencias (soporte/evidencia del procedimiento) ──────────
-- Reutiliza el bucket de Storage existente `evidencias` (NO se crea infra de
-- almacenamiento nueva — alineado con la arquitectura objetivo).
CREATE TABLE IF NOT EXISTS public.eutanasia_evidencias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eutanasia_id uuid NOT NULL REFERENCES public.eutanasias(id) ON DELETE CASCADE,
  bucket       text NOT NULL DEFAULT 'evidencias',
  storage_path text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  estado       text NOT NULL DEFAULT 'SUBIDO'
               CHECK (estado IN ('PENDIENTE','SUBIDO','APROBADO','RECHAZADO','ERROR')),
  uploaded_by  uuid REFERENCES public.personal(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eutanasia_evidencias_eutanasia_id_idx
  ON public.eutanasia_evidencias (eutanasia_id);

-- ─── 5. servicios.eutanasia_id (vínculo inverso, navegación bidireccional) ──
-- Columna nullable aditiva: permite ir del servicio funerario → su eutanasia.
-- NO cambia ningún flujo existente; queda NULL en todos los servicios actuales.
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS eutanasia_id uuid REFERENCES public.eutanasias(id);

CREATE INDEX IF NOT EXISTS servicios_eutanasia_id_idx ON public.servicios (eutanasia_id);

-- ─── 6. GRANTs + RLS (patrón establecido del proyecto) ──────────────────────
-- Tablas internas: solo `authenticated` opera (policy baseline auth_full, igual
-- que las 43 tablas). anon NO necesita acceso (no hay flujo público de eutanasia).
GRANT ALL ON TABLE public.veterinarios         TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.eutanasia_tarifas    TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.eutanasias           TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.eutanasia_evidencias TO postgres, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.eutanasia_tarifas_id_seq TO postgres, authenticated, service_role;

ALTER TABLE public.veterinarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eutanasia_tarifas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eutanasias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eutanasia_evidencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON public.veterinarios;
DROP POLICY IF EXISTS "auth_full" ON public.eutanasia_tarifas;
DROP POLICY IF EXISTS "auth_full" ON public.eutanasias;
DROP POLICY IF EXISTS "auth_full" ON public.eutanasia_evidencias;

CREATE POLICY "auth_full" ON public.veterinarios         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.eutanasia_tarifas    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.eutanasias           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.eutanasia_evidencias FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 7. Vista de agenda (security_invoker, patrón de vistas del proyecto) ────
-- Une eutanasia + veterinario + mascota/cliente + servicio funerario vinculado.
DROP VIEW IF EXISTS public.v_eutanasias_agenda;
CREATE VIEW public.v_eutanasias_agenda
WITH (security_invoker = on) AS
SELECT
  e.id, e.estado, e.estado_pago, e.fecha_solicitada, e.hora_solicitada,
  e.ciudad, e.direccion, e.peso_kg, e.valor, e.valor_pagado,
  e.cobro_conjunto, e.requiere_recoleccion, e.servicio_id,
  e.created_at, e.realizada_at, e.cerrada_at,
  c.nombre   AS cliente_nombre,
  c.apellido AS cliente_apellido,
  m.nombre   AS mascota_nombre,
  m.especie_id,
  v.id       AS veterinario_id,
  v.nombre   AS veterinario_nombre,
  v.telefono AS veterinario_telefono,
  r.nombre   AS responsable_nombre,
  s.estado   AS servicio_estado,
  s.plan_id  AS servicio_plan_id
FROM public.eutanasias e
LEFT JOIN public.clientes     c ON c.id_cliente  = e.cliente_id
LEFT JOIN public.mascotas     m ON m.id_mascota  = e.mascota_id
LEFT JOIN public.veterinarios v ON v.id          = e.veterinario_id
LEFT JOIN public.personal     r ON r.id          = e.responsable_id
LEFT JOIN public.servicios    s ON s.id          = e.servicio_id;

REVOKE ALL ON public.v_eutanasias_agenda FROM anon;
GRANT SELECT ON public.v_eutanasias_agenda TO authenticated;

COMMIT;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- \d+ public.eutanasias
-- SELECT * FROM public.eutanasia_tarifas ORDER BY peso_min_kg;
-- SELECT precio FROM public.eutanasia_tarifas
--   WHERE activo AND (peso_max_kg IS NULL OR 23 <= peso_max_kg)
--   ORDER BY peso_max_kg NULLS LAST LIMIT 1;   -- => 230000

-- ============================================================================
-- ROLLBACK (ejecutar manualmente solo si hay que revertir; destruye datos):
-- ----------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.servicios DROP COLUMN IF EXISTS eutanasia_id;
-- DROP VIEW  IF EXISTS public.v_eutanasias_agenda;
-- DROP TABLE IF EXISTS public.eutanasia_evidencias;
-- DROP TABLE IF EXISTS public.eutanasias;
-- DROP TABLE IF EXISTS public.eutanasia_tarifas;
-- DROP TABLE IF EXISTS public.veterinarios;
-- COMMIT;
-- ============================================================================
