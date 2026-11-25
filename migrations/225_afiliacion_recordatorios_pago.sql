-- ─────────────────────────────────────────────────────────────────────────────
-- 225 · Constancia de cada recordatorio de pago enviado (Pre-exequiales)
-- REPORTE ORBIT 2026-11-25 (mejora, urgencia alta): «cuando se envíe el
-- recordatorio quede en Orbit un chulito o notificación de que ya se envió el
-- recordatorio de pago».
--
-- Los dos botones que recuerdan un pago abren wa.me y no dejaban rastro:
--   · CUOTA       — «Cobrar cuota» / «Recordar cuota» (contratos diferidos, migr. 183)
--   · RENOVACION  — «Recordar» (anual por vencer o vencida)
-- Cada clic queda aquí. La pantalla muestra ✓ «Recordado el …» mientras siga
-- pendiente LO MISMO que se recordó: la misma cuota del mismo contrato, o la
-- renovación del mismo contrato. Al abonar la cuota (pasa a la siguiente) o al
-- renovar (nace otro contrato) la marca desaparece sola.
--
-- Es historial (una fila por envío), no una marca encima del contrato: un
-- contrato diferido que además está por renovar tiene los dos recordatorios a
-- la vez, y saber cuántas veces se le recordó a un cliente también sirve.
--
-- 🪤 «Enviado» = el coordinador abrió el WhatsApp con el mensaje armado; wa.me
--    no confirma que lo haya mandado. La marca lo dice así («recordado»).
--
-- Patrón del módulo (053/183): PostgREST + RLS para authenticated. La pantalla
-- lo lee en una consulta APARTE (no embebido): si esta migración no está
-- aplicada, Pre-exequiales sigue cargando y solo falta la marca.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.afiliacion_recordatorios_pago (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  afiliacion_id      uuid NOT NULL REFERENCES public.afiliaciones(id) ON DELETE CASCADE,
  contrato_id        uuid NOT NULL REFERENCES public.afiliacion_contratos(id) ON DELETE CASCADE,
  tipo               text NOT NULL CHECK (tipo IN ('CUOTA', 'RENOVACION')),
  -- Solo CUOTA: qué cuota se recordó y por cuánto (el monto se deriva y cambia
  -- con cada abono; aquí queda el que decía el mensaje).
  cuota_numero       int,
  monto              numeric(12,2),
  canal              text NOT NULL DEFAULT 'WA_ME',
  enviado_por        uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  enviado_por_nombre text,
  enviado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT afil_rec_pago_cuota_numero CHECK (
    (tipo = 'CUOTA' AND cuota_numero IS NOT NULL AND cuota_numero > 0)
    OR (tipo = 'RENOVACION' AND cuota_numero IS NULL)
  )
);

COMMENT ON TABLE public.afiliacion_recordatorios_pago IS
  'Cada recordatorio de pago de un contrato pre-exequial abierto por WhatsApp desde Orbit (migr. 225): cuota o renovación, quién y cuándo.';

CREATE INDEX IF NOT EXISTS idx_afil_rec_pago_contrato
  ON public.afiliacion_recordatorios_pago (contrato_id, tipo, enviado_en DESC);

ALTER TABLE public.afiliacion_recordatorios_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_full ON public.afiliacion_recordatorios_pago;
CREATE POLICY auth_full ON public.afiliacion_recordatorios_pago
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.afiliacion_recordatorios_pago FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.afiliacion_recordatorios_pago TO authenticated;
GRANT ALL ON public.afiliacion_recordatorios_pago TO postgres, service_role;
GRANT SELECT ON public.afiliacion_recordatorios_pago TO orbit_backend;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
SELECT has_table_privilege('authenticated', 'public.afiliacion_recordatorios_pago', 'INSERT') AS auth_inserta,
       has_table_privilege('anon',          'public.afiliacion_recordatorios_pago', 'SELECT') AS anon_lee,   -- debe ser false
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.afiliacion_recordatorios_pago'::regclass) AS rls;

-- Reversa (solo si no hay historial que conservar):
--   BEGIN; DROP TABLE IF EXISTS public.afiliacion_recordatorios_pago; NOTIFY pgrst, 'reload schema'; COMMIT;
