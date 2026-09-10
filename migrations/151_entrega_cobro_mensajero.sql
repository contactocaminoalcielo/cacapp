-- 151_entrega_cobro_mensajero.sql
-- Cobro en la puerta: el mensajero registra el dinero al completar la entrega.
--
-- Contexto (migración 083): cuando se abrió el pool de entregas se decidió que
-- el MENSAJERO solo ve el tab Entregas y por eso "no tiene dónde registrar" el
-- saldo que el cliente le paga en la puerta — ese dinero lo registraba
-- coordinación a mano. Esto le da el lugar, sin devolverle Recibos ni tocar el
-- recibo del técnico.
--
-- Decisión (David, 2026-09-10): el dinero se registra SOBRE EL SERVICIO
-- (valor_pagado / estado_pago + novedad PAGO_RECIBIDO + comprobante en
-- recibo_comprobantes, igual que el adicional pagado del Kanban) y NO entra al
-- cuadre de técnicos. Motivo medido: la RPC del cuadre arma los ítems desde
-- `recibos_tecnico` filtrando por `servicios.fecha_ingreso` dentro del período;
-- una entrega ocurre semanas después del ingreso, así que un recibo emitido
-- ahora caería en un período viejo — posiblemente ya CERRADO. La conciliación
-- del efectivo con el mensajero la sigue haciendo coordinación.
--
-- Estas columnas guardan la traza del cobro EN LA ENTREGA (quién, cuánto, cómo
-- y con qué soporte) para que mañana se pueda armar un cuadre de mensajeros
-- sin rehacer la pantalla ni adivinar de dónde salió la plata.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS cobro_monto               numeric(12,2),
  ADD COLUMN IF NOT EXISTS cobro_metodo              text,
  ADD COLUMN IF NOT EXISTS cobro_comprobante_path    text,
  ADD COLUMN IF NOT EXISTS cobro_registrado_en       timestamptz,
  ADD COLUMN IF NOT EXISTS cobro_registrado_por      uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS cobro_no_realizado_motivo text;

COMMENT ON COLUMN public.entregas.cobro_monto
  IS 'Dinero que el mensajero recibió en la puerta. Es el saldo del servicio releído en el momento de completar, no el snapshot que traía la app.';
COMMENT ON COLUMN public.entregas.cobro_metodo
  IS 'EFECTIVO | TRANSFERENCIA | NEQUI | DAVIPLATA | TARJETA | OTRO. Mismo listado del recibo del técnico.';
COMMENT ON COLUMN public.entregas.cobro_comprobante_path
  IS 'storage_path en el bucket `evidencias` del soporte del pago. Obligatorio cuando el medio NO es efectivo. La fila formal queda en recibo_comprobantes.';
COMMENT ON COLUMN public.entregas.cobro_registrado_en
  IS 'Cuándo se registró el cobro (= momento de completar la entrega).';
COMMENT ON COLUMN public.entregas.cobro_registrado_por
  IS 'Mensajero/técnico que recibió el dinero. Sirve para conciliarle el efectivo.';
COMMENT ON COLUMN public.entregas.cobro_no_realizado_motivo
  IS 'Por qué se entregó SIN cobrar habiendo saldo. Excluyente con cobro_monto: o cobró, o dijo por qué no.';

-- O cobró, o explicó por qué no: nunca las dos cosas, y un cobro siempre trae
-- monto + medio + quién lo recibió (si falta alguno, la fila no dice nada útil).
ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_cobro_coherente_check;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_cobro_coherente_check CHECK (
  (cobro_monto IS NULL AND cobro_metodo IS NULL AND cobro_registrado_por IS NULL)
  OR (
    cobro_monto > 0 AND cobro_metodo IS NOT NULL AND cobro_registrado_por IS NOT NULL
    AND cobro_no_realizado_motivo IS NULL
  )
);

ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_cobro_metodo_check;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_cobro_metodo_check CHECK (
  cobro_metodo IS NULL OR cobro_metodo = ANY (ARRAY[
    'EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO'
  ])
);

-- Un pago digital sin soporte es exactamente el hueco que llenó la pestaña
-- Comprobantes del técnico: no se repite acá.
ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_cobro_digital_con_soporte_check;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_cobro_digital_con_soporte_check CHECK (
  cobro_metodo IS NULL
  OR cobro_metodo IN ('EFECTIVO', 'OTRO')
  OR cobro_comprobante_path IS NOT NULL
);

-- Lo que va a preguntar coordinación: qué entregas trajeron plata y cuáles se
-- fueron sin cobrar. Ambas son minoría dentro de la tabla → índices parciales.
CREATE INDEX IF NOT EXISTS idx_entregas_con_cobro
  ON public.entregas (cobro_registrado_en DESC)
  WHERE cobro_monto IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entregas_sin_cobrar
  ON public.entregas (fecha_realizada DESC)
  WHERE cobro_no_realizado_motivo IS NOT NULL;

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'entregas' AND column_name LIKE 'cobro%' ORDER BY column_name;
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.entregas'::regclass AND conname LIKE '%cobro%';
