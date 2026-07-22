-- ============================================================================
-- 069 — Backfill: borrar el dinero fantasma de los recibos de FACTURACIÓN MENSUAL
-- ----------------------------------------------------------------------------
-- Complemento de la 068 (que arregla el problema de aquí en adelante). Aquí se
-- limpian los recibos YA guardados de vets de facturación mensual que quedaron
-- con el valor del servicio registrado como EFECTIVO sin que nadie lo recogiera
-- (el medio de pago venía prellenado en la app del técnico).
--
-- Medido en prod 2026-07-22: 24 recibos con ~$5,6M. Se limpian 19 y se
-- RESPETAN 5, con estas tres salvaguardas (decisión de David):
--   1. `pago_aplicado > 0` → el recibo movió `servicios.valor_pagado`. David
--      decidió NO tocar el estado de pago, así que el recibo tampoco se toca
--      (MISSI, NN-vet, RAMBO, MARTINA).
--   2. Tiene comprobante adjunto → hubo un pago real con soporte.
--   3. El coordinador corrigió esa fila en un cuadre y la dejó CON plata → era
--      un cobro de verdad (ALIKA $99.550 por Nequi, MARTINA $179.000).
--      OJO: las correcciones que dejaron la fila en CERO ("no se recibió
--      dinero", "no cobró servicio") NO protegen — confirman el problema.
--
-- Los cuadres CERRADOS no se tocan: guardan su propio snapshot en cuadre_items.
-- Los BORRADOR quedan bien al regenerarlos (la 068 ya fuerza recogido 0 en FM).
-- NO se toca servicios.valor_pagado ni estado_pago.
--
-- Idempotente: al dejar valor_cobrado en 0 las filas ya no vuelven a entrar.
-- Aplicar por SSH→psql en Contabo. Requiere 068 aplicada.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE tmp_recibos_fm ON COMMIT DROP AS
SELECT r.id, r.servicio_id, r.numero_recibo, r.valor_cobrado
FROM public.recibos_tecnico r
JOIN public.servicios s ON s.id = r.servicio_id
JOIN public.aliados   a ON a.id_aliado = s.aliado_origen_id
WHERE a.modalidad_comision = 'FACTURACION_MENSUAL'
  AND COALESCE(r.valor_cobrado, 0) > 0
  AND COALESCE(r.pago_aplicado, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.recibo_comprobantes rc WHERE rc.recibo_id = r.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cuadre_items ci
    WHERE ci.servicio_id = r.servicio_id
      AND (ci.medios_editado_en IS NOT NULL OR ci.valor_recogido_editado_en IS NOT NULL)
      AND COALESCE(ci.total_cobrado, 0) > 0
  );

DO $$
DECLARE v_n int; v_suma numeric;
BEGIN
  SELECT count(*), COALESCE(SUM(valor_cobrado),0) INTO v_n, v_suma FROM tmp_recibos_fm;
  RAISE NOTICE 'Recibos de facturación mensual a limpiar: % (% en total)', v_n, v_suma;
END $$;

-- 1) Medios formales (fuente de verdad del cuadre)
DELETE FROM public.recibo_medios_pago mp
USING tmp_recibos_fm t
WHERE mp.recibo_id = t.id;

-- 2) El recibo: sin dinero, y el snapshot del formulario también (el PDF cae a
--    datos_form.total_recibido cuando valor_cobrado es 0)
UPDATE public.recibos_tecnico r
   SET valor_cobrado = 0,
       medios_pago   = '[]'::jsonb,
       datos_form    = COALESCE(r.datos_form, '{}'::jsonb)
                       || jsonb_build_object(
                            'facturacion_mensual', true,
                            'total_recibido', 0,
                            'correccion_069', 'dinero prellenado que el técnico nunca recibió')
  FROM tmp_recibos_fm t
 WHERE r.id = t.id;

-- 3) Rastro por servicio
INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT t.servicio_id, 'NOTA',
       'Corrección automática (migración 069): el recibo ' || t.numero_recibo ||
       ' quedaba con ' || to_char(t.valor_cobrado, 'FM$999,999,999') ||
       ' cobrados en EFECTIVO por el prellenado de la app. La veterinaria es de' ||
       ' FACTURACIÓN MENSUAL: el técnico no recogió nada y el valor se cobra con' ||
       ' la factura del mes. No se modificó el estado de pago del servicio.'
FROM tmp_recibos_fm t;

COMMIT;
