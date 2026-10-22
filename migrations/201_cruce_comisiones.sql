-- ============================================================================
-- 201 — Cruce de comisiones al registrar un servicio nuevo
-- ----------------------------------------------------------------------------
-- Cuando el coordinador registra un servicio de una veterinaria aliada, puede
-- autorizar que las comisiones pendientes de servicios anteriores de esa misma
-- veterinaria se descuenten del valor que el técnico cobrará al cliente:
--
--   • El técnico cobra MENOS en la puerta (valor_total se reduce en el cruce).
--   • Los servicios anteriores quedan "saldados" en cuanto a comisión.
--   • En el recibo de la veterinaria aparece qué mascotas se saldaron.
--
-- La tabla registra CADA cruce individual (servicio nuevo ↔ servicio saldado).
-- El monto cruzado puede ser parcial (el coordinador puede ajustar el importe
-- de cada comisión pendiente antes de confirmar).
--
-- Aditiva, idempotente. Revertir:
--   DROP TABLE IF EXISTS public.cruce_comisiones;
-- Aplicar en VPS (Contabo):
--   cat migrations/201_cruce_comisiones.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cruce_comisiones (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- El servicio NUEVO que absorbe la deuda de comisión
  servicio_nuevo_id     uuid        NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  -- El servicio ANTERIOR cuya comisión quedó pendiente y se está saldando
  servicio_saldado_id   uuid        NOT NULL REFERENCES public.servicios(id),
  -- Monto cruzado (puede ser menor que la comisión original — cruce parcial)
  monto                 numeric(12,2) NOT NULL CHECK (monto > 0),
  -- Quién autorizó el cruce en pantalla
  autorizado_por        uuid        NOT NULL REFERENCES public.personal(id),
  -- Un par (nuevo, saldado) solo puede cruzarse una vez
  UNIQUE (servicio_nuevo_id, servicio_saldado_id)
);

COMMENT ON TABLE  public.cruce_comisiones IS
  'Cruces de comisiones: la comisión pendiente de un servicio anterior se salda al cobrar un servicio nuevo.';
COMMENT ON COLUMN public.cruce_comisiones.monto IS
  'Monto cruzado. Puede ser menor que la comisión original (cruce parcial autorizado).';

CREATE INDEX IF NOT EXISTS idx_cruce_nuevo
  ON public.cruce_comisiones (servicio_nuevo_id);
CREATE INDEX IF NOT EXISTS idx_cruce_saldado
  ON public.cruce_comisiones (servicio_saldado_id);

-- ── GRANTs ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON TABLE public.cruce_comisiones TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cruce_comisiones TO orbit_backend;
GRANT ALL ON TABLE public.cruce_comisiones TO postgres, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.cruce_comisiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select" ON public.cruce_comisiones;
CREATE POLICY "auth_select" ON public.cruce_comisiones
  FOR SELECT TO authenticated USING (true);

-- Solo COORDINADOR (1) o ADMIN (6) pueden insertar
DROP POLICY IF EXISTS "coordinador_insert" ON public.cruce_comisiones;
CREATE POLICY "coordinador_insert" ON public.cruce_comisiones
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.personal p
      WHERE p.auth_id = auth.uid()
        AND p.rol_principal_id IN (1, 6)
    )
  );

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificar:
--   SELECT table_name, column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'cruce_comisiones'
--    ORDER BY ordinal_position;
