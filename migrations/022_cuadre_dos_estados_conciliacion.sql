-- ============================================================================
-- 022 — Cuadre: simplificar estado_conciliacion a DOS estados
-- Fecha: 2026-07-01
--
-- David: los estados de cuadre confundían (VERIFICADO/CORRECTO/PARCIAL/
-- NO_RECOGIO/EXCEDENTE). Solo deben existir DOS:
--   · VERIFICADO          → saldado, no se debe nada; ese dinero cuenta en Finanzas.
--   · PENDIENTE_GESTIONAR → pago pendiente del cliente, comisión de veterinaria o
--                           facturación mensual → pasa a Conciliaciones.
--
-- El cuadre SIEMPRE se puede cerrar (queda a saldo con el técnico); un pago
-- pendiente NO bloquea. La app solo avisa (sin bloquear) cuando falta un
-- comprobante o el técnico de verdad debe efectivo.
--
-- Reasignación de los estados viejos (confirmada con David):
--   VERIFICADO, CORRECTO, EXCEDENTE  → VERIFICADO       (recogió bien o de más)
--   PARCIAL, NO_RECOGIO              → PENDIENTE_GESTIONAR (recogió de menos)
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

BEGIN;

-- ─── 1. Quitar el CHECK viejo (fue creado sin nombre explícito en 018) ──────
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.cuadre_items'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%estado_conciliacion%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cuadre_items DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- ─── 2. Reasignar los registros existentes a los dos estados ────────────────
UPDATE public.cuadre_items
   SET estado_conciliacion = 'VERIFICADO'
 WHERE estado_conciliacion IN ('CORRECTO','EXCEDENTE');

UPDATE public.cuadre_items
   SET estado_conciliacion = 'PENDIENTE_GESTIONAR'
 WHERE estado_conciliacion IN ('PARCIAL','NO_RECOGIO');

-- ─── 3. Nuevo CHECK con solo dos valores (+ NULL = sin revisar) ─────────────
ALTER TABLE public.cuadre_items
  ADD CONSTRAINT cuadre_items_estado_conciliacion_check
  CHECK (estado_conciliacion IN ('VERIFICADO','PENDIENTE_GESTIONAR'));

COMMENT ON COLUMN public.cuadre_items.estado_conciliacion
  IS 'Revisión por mascota. NULL = sin revisar. Dos estados: VERIFICADO (saldado, '
     'cuenta en Finanzas) | PENDIENTE_GESTIONAR (pago pendiente/comisión/fact. '
     'mensual → Conciliaciones). Editable solo en BORRADOR.';

COMMIT;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- SELECT estado_conciliacion, count(*) FROM public.cuadre_items GROUP BY 1;
