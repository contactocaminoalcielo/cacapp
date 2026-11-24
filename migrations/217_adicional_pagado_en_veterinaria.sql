-- 217 · «El propietario ya pagó este adicional en la veterinaria»
--
-- REPORTES ORBIT 23-nov-2026 (urgencia ALTA): Producción y Diseño / Preparación de
-- entrega / Reporte de entrega del mensajero. En los servicios referidos por una
-- veterinaria el propietario a veces le paga a la clínica el servicio Y los adicionales,
-- y la clínica queda debiéndole eso a Camino. Orbit veía el saldo y lo cobraba otra vez
-- en la puerta.
--
-- El estado de pago de cada adicional se DERIVA de la plata real
-- (src/lib/pagoAdicionalesCalculo.js): lo abonado atado al ítem (migr. 174) y el saldo
-- del servicio. Lo único que la plata no puede decir es que el propietario le pagó a la
-- VETERINARIA (a Camino no le llegó nada). Eso lo dice esta marca, que pone coordinación
-- (Producción / Preparar entrega / Tablero al agregar el adicional). Con la marca, el
-- adicional se ve PAGADO para el propietario y su valor pasa al saldo de la veterinaria.
--
-- No toca `valor_total`, `valor_pagado`, `estado_pago` ni el cuadre: solo explica a quién
-- le corresponde el saldo que ya existe.

\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE public.servicio_recordatorios
  -- true = lo pagó en la veterinaria · false = coordinación dijo que NO (anula la regla
  -- «ya estaba en el recibo de la veterinaria») · NULL = sin dato (lo normal).
  ADD COLUMN IF NOT EXISTS pago_en_veterinaria     boolean,
  ADD COLUMN IF NOT EXISTS pago_en_veterinaria_en  timestamptz,
  ADD COLUMN IF NOT EXISTS pago_en_veterinaria_por uuid REFERENCES public.personal(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.servicio_recordatorios.pago_en_veterinaria IS
  'El propietario pagó este adicional en la veterinaria: no se le cobra; lo debe la veterinaria (migr. 217).';

-- Solo tiene sentido en adicionales (los del plan se pagan con el plan).
ALTER TABLE public.servicio_recordatorios
  DROP CONSTRAINT IF EXISTS servicio_recordatorios_pago_vet_solo_adicional;
ALTER TABLE public.servicio_recordatorios
  ADD CONSTRAINT servicio_recordatorios_pago_vet_solo_adicional
  CHECK (pago_en_veterinaria IS NOT TRUE OR origen IN ('ADICIONAL', 'REMOVIDO'));

COMMIT;

-- Verificación
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'servicio_recordatorios' AND column_name LIKE 'pago_en_veterinaria%';
--
-- Reversa
-- ALTER TABLE servicio_recordatorios DROP CONSTRAINT servicio_recordatorios_pago_vet_solo_adicional,
--   DROP COLUMN pago_en_veterinaria_por, DROP COLUMN pago_en_veterinaria_en, DROP COLUMN pago_en_veterinaria;
