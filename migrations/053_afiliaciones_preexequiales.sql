-- 053_afiliaciones_preexequiales.sql — Módulo de afiliaciones pre-exequiales.
-- Diseño cerrado con David 2026-07-16 (memoria afiliaciones_preexequiales_diseno):
--   · Dos modalidades: ANUAL (un pago por año, renovable, cláusula semestral el
--     primer año: fallece meses 0-6 → cobra 5× la afiliación, meses 7-12 → 3×)
--     y VITALICIO (un solo pago, cubierta de por vida, sin cláusula).
--   · 4 niveles: BRONCE→BASICO, PLATA→STANDARD, ORO→(elige EXCLUSIVO_*/COMPETS_*),
--     DIAMANTE→PREMIUM. El mapeo vive en config_operativa, no en código.
--   · Cada año/renovación = un contrato con su número (ABR1124SR10-BR1), su valor
--     congelado, su pago y sus comprobantes. Vencida +15 días de gracia → CANCELADA
--     (reactivar = afiliación nueva desde contrato 0 con cláusulas reactivadas).
-- Reemplaza a `planes_presequiales` (vacía en prod y rota: la UI escribía plan_id
-- en vez de plan_equivalente_id y sus modalidades violaban el CHECK).

BEGIN;

-- ── 1. Afiliación: la membresía viva de una mascota ──────────────────────────
CREATE TABLE IF NOT EXISTS public.afiliaciones (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               integer GENERATED ALWAYS AS IDENTITY,   -- consecutivo interno
  tipo                 text NOT NULL CHECK (tipo IN ('ANUAL','VITALICIO')),
  nivel                text NOT NULL CHECK (nivel IN ('BRONCE','PLATA','ORO','DIAMANTE')),
  cliente_id           uuid NOT NULL REFERENCES public.clientes(id_cliente),
  mascota_id           uuid NOT NULL REFERENCES public.mascotas(id_mascota),
  estado               text NOT NULL DEFAULT 'VIGENTE'
                         CHECK (estado IN ('VIGENTE','VENCIDA','CANCELADA','ACTIVADA')),
  servicio_activado_id uuid REFERENCES public.servicios(id),   -- write-back desde Registro
  fecha_activacion     date,
  notas                text,
  creado_por           uuid REFERENCES public.personal(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Una mascota no puede tener dos afiliaciones "vivas" a la vez (sí puede tener
-- una CANCELADA vieja y una nueva — la reactivación crea fila nueva).
CREATE UNIQUE INDEX IF NOT EXISTS uq_afiliaciones_mascota_viva
  ON public.afiliaciones (mascota_id) WHERE estado IN ('VIGENTE','VENCIDA');

CREATE INDEX IF NOT EXISTS idx_afiliaciones_estado  ON public.afiliaciones (estado);
CREATE INDEX IF NOT EXISTS idx_afiliaciones_cliente ON public.afiliaciones (cliente_id);

CREATE TRIGGER trg_afiliaciones_updated BEFORE UPDATE ON public.afiliaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.afiliaciones IS
  'Afiliaciones pre-exequiales por mascota (ANUAL renovable o VITALICIO). El contrato vigente y su historial viven en afiliacion_contratos.';

-- ── 2. Contratos: uno por año (el vitalicio tiene exactamente uno) ───────────
CREATE TABLE IF NOT EXISTS public.afiliacion_contratos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  afiliacion_id     uuid NOT NULL REFERENCES public.afiliaciones(id) ON DELETE CASCADE,
  numero            smallint NOT NULL DEFAULT 0 CHECK (numero >= 0),  -- 0=nuevo, 1+=renovaciones
  numero_contrato   text NOT NULL,            -- código completo, ej. ABR1124SR10-BR1 / ...-BRVIT
  fecha_inicio      date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Bogota')::date,
  fecha_vencimiento date,                     -- inicio + 1 año; NULL en VITALICIO
  valor             numeric(12,2) NOT NULL CHECK (valor >= 0),  -- congelado al firmar
  metodo_pago       text,
  fecha_pago        date,
  -- Comprobantes en UNA sola fuente: [{bucket, storage_path, mime_type, uploaded_at}]
  comprobantes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_path          text,                     -- contrato generado/escaneado en storage
  creado_por        uuid REFERENCES public.personal(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (afiliacion_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_afil_contratos_afiliacion ON public.afiliacion_contratos (afiliacion_id);
-- El cron de vencimientos barre por fecha (solo contratos con vencimiento = anuales).
CREATE INDEX IF NOT EXISTS idx_afil_contratos_vencimiento
  ON public.afiliacion_contratos (fecha_vencimiento) WHERE fecha_vencimiento IS NOT NULL;

COMMENT ON TABLE public.afiliacion_contratos IS
  'Un contrato por año de afiliación (numero 0 = nuevo, 1+ = renovaciones; VITALICIO solo el 0). Valor congelado al firmar; el precio vigente vive en config_operativa AFILIACIONES.';

-- ── 3. GRANTs + RLS (patrón del proyecto: PostgREST + policy auth_full) ─────
GRANT ALL ON TABLE public.afiliaciones        TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.afiliacion_contratos TO postgres, anon, authenticated, service_role;

ALTER TABLE public.afiliaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afiliacion_contratos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON public.afiliaciones;
CREATE POLICY auth_full ON public.afiliaciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS auth_full ON public.afiliacion_contratos;
CREATE POLICY auth_full ON public.afiliacion_contratos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 4. Configuración del módulo (la lee el frontend y el cron) ──────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('AFILIACIONES', 'precios', jsonb_build_object(
     'ANUAL',     jsonb_build_object('BRONCE',0,'PLATA',0,'ORO',0,'DIAMANTE',0),
     'VITALICIO', jsonb_build_object('BRONCE',0,'PLATA',0,'ORO',0,'DIAMANTE',0)
   ), 'Precio fijo por nivel (NO varía por peso). Se congela en el contrato al firmar; la renovación toma el vigente.'),
  ('AFILIACIONES', 'plan_equivalente', jsonb_build_object(
     'BRONCE','BASICO', 'PLATA','STANDARD', 'ORO', null, 'DIAMANTE','PREMIUM'
   ), 'Código del plan de servicio al activar (falleció). ORO es null: se elige entre oro_opciones.'),
  ('AFILIACIONES', 'oro_opciones',
   '["EXCLUSIVO_PRESENCIAL","EXCLUSIVO_VIDEOLLAMADA","COMPETS_EVIDENCIA","COMPETS_PRESENCIAL"]'::jsonb,
   'Planes entre los que elige el cliente ORO al activar.'),
  ('AFILIACIONES', 'dias_gracia', '15'::jsonb,
   'Días tras el vencimiento antes de pasar a CANCELADA (reactivar = afiliación nueva desde 0).'),
  ('AFILIACIONES', 'dias_aviso_renovacion', '30'::jsonb,
   'Con cuántos días de anticipación aparece en la pestaña Por vencer.'),
  ('AFILIACIONES', 'multiplicador_semestre_1', '5'::jsonb,
   'Cláusula: fallece en meses 0-6 del PRIMER contrato anual → cobra este × el valor de la afiliación.'),
  ('AFILIACIONES', 'multiplicador_semestre_2', '3'::jsonb,
   'Cláusula: fallece en meses 7-12 del PRIMER contrato anual → cobra este × el valor de la afiliación.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ── 5. Limpieza del modelo viejo ─────────────────────────────────────────────
-- Guard: solo se elimina si sigue vacía (verificado 2026-07-16: 0 filas).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.planes_presequiales;
  IF n > 0 THEN
    RAISE EXCEPTION 'planes_presequiales tiene % filas — migrar a mano antes de eliminar', n;
  END IF;
  DROP TABLE public.planes_presequiales;
END $$;

-- Los niveles dejaron de ser filas de `planes` (una afiliación no es un plan de
-- servicio). Se desactivan, no se borran: servicios históricos podrían referenciarlas.
UPDATE public.planes SET activo = false
WHERE codigo IN ('BRONCE','PLATA','ORO_EXCLUSIVO');

COMMIT;
