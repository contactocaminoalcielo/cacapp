-- ============================================================================
-- 174 — El abono de cartera dice A QUÉ CONCEPTO corresponde
-- ----------------------------------------------------------------------------
-- Reporte de Finanzas (25-sep-2026): el cliente debe $150.000 entre varios
-- conceptos, paga los $26.000 del Memopet adicional, y Orbit descuenta los
-- $26.000 del saldo general sin dejar dicho que eran del Memopet.
--
-- La novedad PAGO_RECIBIDO gana dos columnas:
--   · servicio_recordatorio_id → el ítem adicional que se pagó (si fue uno).
--     Es lo que permite mostrar después "Memopet · abonado $26.000" sin leer
--     texto libre (la lección de la 089).
--   · concepto_pago → el nombre legible del concepto, también para lo que no
--     es un ítem ("Transporte", "Eutanasia"…). NULL = saldo general.
--
-- Lo abonado a un ítem NO se guarda en el ítem: se DERIVA sumando estas
-- novedades. Una marca guardada se queda vieja (ver estado_pago, migr. del
-- 27-jul); una suma no.
--
-- ON DELETE SET NULL: borrar un ítem no tumba la constancia del pago, y no
-- cambia el orden del borrado manual de un servicio (cadena FK).
--
-- Aditiva, idempotente. Revertir:
--   ALTER TABLE public.novedades_servicio
--     DROP COLUMN servicio_recordatorio_id, DROP COLUMN concepto_pago;
-- Aplicar en VPS (Contabo) ANTES de subir el frontend:
--   cat migrations/174_abono_concepto_pago.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================
BEGIN;

ALTER TABLE public.novedades_servicio
  ADD COLUMN IF NOT EXISTS servicio_recordatorio_id uuid
    REFERENCES public.servicio_recordatorios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concepto_pago text;

COMMENT ON COLUMN public.novedades_servicio.servicio_recordatorio_id IS
  'Ítem (servicio_recordatorios) al que corresponde este pago. NULL = no es de un ítem.';
COMMENT ON COLUMN public.novedades_servicio.concepto_pago IS
  'Concepto legible del pago (p. ej. "Memopet", "Transporte"). NULL = saldo general.';

-- Se consulta "cuánto se ha abonado a estos ítems": pocas filas lo tienen.
CREATE INDEX IF NOT EXISTS idx_novedades_pago_item
  ON public.novedades_servicio (servicio_recordatorio_id)
  WHERE servicio_recordatorio_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
-- Verificar:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'novedades_servicio'
--      AND column_name IN ('servicio_recordatorio_id', 'concepto_pago');
