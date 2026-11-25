-- 222 · Recargo de prioridad del Desamparado con columna propia
--
-- REPORTE ORBIT (25-nov, urgencia alta): al asignar un servicio Plan
-- Desamparado desde el Tablero no había cómo marcar que lleva prioridad y sumar
-- su valor. La prioridad solo existía al registrar (Registro) o al aceptar una
-- solicitud (migr. 211), y en los dos casos iba DENTRO de `valor_total` y
-- explicada en `notas`, sin columna.
--
-- Sin columna pasaban dos cosas, medidas el 25-nov:
--  · No se sabe si un servicio ya la tiene cobrada: sumarla desde la ficha
--    podía cobrarla dos veces.
--  · `cambiarPlan` (Kanban) rehace `valor_total` desde plan + adicionales +
--    transporte + recargo nocturno − descuento: la prioridad se PERDÍA en
--    silencio. De los 40 servicios con la nota «Recogida prioritaria», 8 tienen
--    un total que no la incluye.
--
-- `recargo_prioridad` sigue DENTRO de `valor_total` (no cambia ninguna cuenta:
-- recibo, cuadre y Finanzas leen el total como siempre); la columna es el
-- desglose, como `valor_transporte` o `recargo_nocturno`.
--
-- NO se rellenan los 40 viejos: sus totales no son consistentes (ver arriba) y
-- 38 ya están entregados o cancelados. Arrancan en 0.

BEGIN;

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS recargo_prioridad numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.servicios
  DROP CONSTRAINT IF EXISTS servicios_recargo_prioridad_chk;
ALTER TABLE public.servicios
  ADD CONSTRAINT servicios_recargo_prioridad_chk CHECK (recargo_prioridad >= 0);

COMMENT ON COLUMN public.servicios.recargo_prioridad IS
  'Recargo por recogida prioritaria del Desamparado (migr. 222). Va INCLUIDO en valor_total; esta columna es su desglose.';

-- La traza del valor (migr. 089) dice POR QUÉ cambió el total.
ALTER TABLE public.novedades_servicio
  DROP CONSTRAINT IF EXISTS novedades_servicio_motivo_valor_check;
ALTER TABLE public.novedades_servicio
  ADD CONSTRAINT novedades_servicio_motivo_valor_check CHECK (
    motivo_valor IS NULL OR motivo_valor = ANY (ARRAY[
      'PESO', 'PLAN', 'ADICIONAL', 'ITEM_QUITADO', 'COMISION', 'CORRECCION', 'PRIORIDAD'
    ]::text[])
  );

COMMIT;
