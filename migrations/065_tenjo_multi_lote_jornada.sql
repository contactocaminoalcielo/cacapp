-- 065_tenjo_multi_lote_jornada.sql
-- Tenjo: permitir 2 o más lotes en la misma jornada.
--
-- CASO REAL: se cierra el lote de la jornada y en la noche llega otra mascota
-- que había que procesar ese mismo día. Antes NO se podía agregar: había que
-- esperar a la siguiente jornada.
--
-- CAUSA: el índice único `uq_lote_tenjo_jornada` permitía UN solo lote (no
-- cancelado) por `fecha_jornada`. Una vez confirmado/cerrado, no cabía otro.
--
-- CAMBIO: el índice único pasa a cubrir SOLO los lotes en estado planificable
-- (PROPUESTO / EN_REVISION). Así:
--   • Sigue garantizando un único lote "en planeación" por jornada — lo que
--     usan la generación automática (job propuesta) y "Generar propuesta" para
--     no duplicar el borrador (el .maybeSingle()/ON CONFLICT siguen siendo
--     seguros: como máximo una fila planificable por fecha).
--   • Una vez ese lote pasa a CONFIRMADO/EN_EJECUCION/CERRADO, deja de estar
--     cubierto por el índice → se puede crear un NUEVO lote (TJ-AAAAMMDD-2, -3…)
--     para la misma jornada. El lote viejo queda intacto.
--
-- El número de lote lo numera el backend/frontend con sufijo -N según cuántos
-- lotes no cancelados existan ya para esa fecha (no hay unique sobre
-- numero_lote, así que un choque cosmético en carrera no rompe nada).
--
-- Aditivo y re-ejecutable.

BEGIN;

DROP INDEX IF EXISTS public.uq_lote_tenjo_jornada;

-- Un solo lote EN PLANEACIÓN (borrador) por jornada; los confirmados/cerrados
-- ya no ocupan el cupo, de modo que caben lotes adicionales para el mismo día.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lote_tenjo_jornada
  ON public.lotes_tenjo (fecha_jornada)
  WHERE estado IN ('PROPUESTO', 'EN_REVISION');

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP INDEX IF EXISTS public.uq_lote_tenjo_jornada;
--   CREATE UNIQUE INDEX uq_lote_tenjo_jornada
--     ON public.lotes_tenjo (fecha_jornada) WHERE estado <> 'CANCELADO';
-- COMMIT;
