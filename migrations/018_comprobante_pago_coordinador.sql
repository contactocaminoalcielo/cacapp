-- ============================================================================
-- 018 — Comprobante de pago del coordinador (Finanzas)
-- Fecha: 2026-06-26
--
-- El coordinador registra pagos manuales en Finanzas (sin recibo de técnico) y
-- ahora puede adjuntar un comprobante. Para reutilizar la tabla existente
-- `recibo_comprobantes` (bucket `evidencias`, modal de visualización), se permite
-- que `recibo_id` sea NULL: el comprobante queda atado solo al `servicio_id`.
--
-- Backward-compatible: el flujo del técnico SIEMPRE setea recibo_id, no se afecta.
-- No hay índice único sobre recibo_id (la app maneja el "comprobante activo"),
-- así que permitir NULL no rompe constraints.
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

ALTER TABLE public.recibo_comprobantes ALTER COLUMN recibo_id DROP NOT NULL;
