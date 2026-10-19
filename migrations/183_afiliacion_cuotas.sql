-- ============================================================================
-- 183 — Plan pre-exequial pagado en CUOTAS (abonos, saldo y próximo cobro)
-- ----------------------------------------------------------------------------
-- Reporte de operación (6-oct-2026, Pre-exequiales): «cargar el abono al plan
-- vitalicio cuando es diferido a 4 cuotas, el saldo y un recordatorio del
-- próximo cobro». Hasta hoy el contrato solo sabía de UN pago (metodo_pago +
-- fecha_pago + comprobantes): el vitalicio de Mercedes Romero, diferido, quedó
-- cargado como pagado entero el 5-oct.
--
-- Modelo (una sola fuente por cifra, como el resto del módulo):
--   · `afiliacion_contratos.cuotas` = en cuántas cuotas MENSUALES se pactó el
--     total. 1 = de contado (todo lo que ya existe): el contrato se da por
--     pagado completo, como hasta hoy, y NO lleva filas en afiliacion_pagos.
--   · cuotas > 1 = diferido: lo pagado es la SUMA de `afiliacion_pagos` de ese
--     contrato. Saldo, cuota que sigue y su fecha se DERIVAN en la pantalla
--     (cuota k vence en fecha_inicio + (k-1) meses); no se guardan.
--   · El total sigue siendo valor × nº de mascotas (no se guarda, migr. 054).
--
-- Aditiva e idempotente: los 151 contratos quedan en cuotas = 1 y nada cambia
-- para ellos.
--   cat migrations/183_afiliacion_cuotas.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.afiliacion_contratos
  ADD COLUMN IF NOT EXISTS cuotas smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afil_contratos_cuotas_rango') THEN
    ALTER TABLE public.afiliacion_contratos
      ADD CONSTRAINT afil_contratos_cuotas_rango CHECK (cuotas BETWEEN 1 AND 12);
  END IF;
END $$;

COMMENT ON COLUMN public.afiliacion_contratos.cuotas IS
  'Cuotas mensuales en que se pactó el total (1 = de contado: pagado completo, sin filas en afiliacion_pagos). Con más de 1, lo pagado es la suma de afiliacion_pagos.';

CREATE TABLE IF NOT EXISTS public.afiliacion_pagos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id  uuid NOT NULL REFERENCES public.afiliacion_contratos(id) ON DELETE CASCADE,
  fecha        date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Bogota')::date,
  monto        numeric(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago  text NOT NULL DEFAULT 'EFECTIVO'
               CHECK (metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO')),
  -- Mismo formato que afiliacion_contratos.comprobantes: [{bucket, storage_path, mime_type, uploaded_at}]
  comprobantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  notas        text,
  creado_por   uuid REFERENCES public.personal(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_afil_pagos_contrato ON public.afiliacion_pagos (contrato_id, fecha);

COMMENT ON TABLE public.afiliacion_pagos IS
  'Abonos de un contrato pre-exequial pactado en cuotas (afiliacion_contratos.cuotas > 1). Lo pagado = suma de monto; saldo y próximo cobro se derivan.';

-- Patrón del módulo (053): PostgREST + policy auth_full.
GRANT ALL ON TABLE public.afiliacion_pagos TO postgres, authenticated, service_role;
GRANT SELECT ON TABLE public.afiliacion_pagos TO orbit_backend;
ALTER TABLE public.afiliacion_pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_full ON public.afiliacion_pagos;
CREATE POLICY auth_full ON public.afiliacion_pagos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PostgREST cachea el esquema: sin esto el embed `afiliacion_pagos(*)` de la
-- pantalla falla y Pre-exequiales entera no carga.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- 🪤 ORDEN: esta migración ANTES del frontend. La pantalla pide
-- `afiliacion_contratos(*, afiliacion_pagos(*))`: sin la tabla, la lista no carga.
--
-- Reversa (solo si no hay abonos que conservar):
--   BEGIN;
--     DROP TABLE IF EXISTS public.afiliacion_pagos;
--     ALTER TABLE public.afiliacion_contratos DROP CONSTRAINT IF EXISTS afil_contratos_cuotas_rango,
--       DROP COLUMN IF EXISTS cuotas;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
