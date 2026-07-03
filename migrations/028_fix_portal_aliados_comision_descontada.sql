-- 028 - Portal aliados: comision descontada para recibos de veterinaria
-- =====================================================================
-- Contexto:
-- Las solicitudes creadas desde /aliado llegan a solicitudes_servicio.origen='ALIADO'.
-- Antes del fix en Kanban, al convertirlas el servicio quedaba con:
--   - comision_aliado > 0
--   - comision_descontada = false
--   - valor_total = bruto
--   - valor_plan = bruto
--
-- En la app del tecnico eso hacia que el recibo VET mostrara la comision, pero
-- no la restara del total a cobrar.
--
-- Esta migracion corrige SOLO servicios del portal de aliado que aun no tienen
-- recibo ni pago registrado. Si ya existe recibo/pago, se deja intacto para
-- revision manual y no alterar auditoria financiera.
--
-- Ajuste 2026-07-03: SOLO recogida en la clinica (punto_recogida='CLINICA_ALIADA').
-- Ahi la vet cobra al cliente y retiene su comision (el tecnico recoge el neto).
-- A DOMICILIO el cliente le paga el valor completo al tecnico y la comision
-- queda PENDIENTE (pestana Comisiones) — marcarla descontada la daria por
-- saldada sin que la vet la reciba. Mismo criterio en Kanban.jsx.
-- =====================================================================

BEGIN;

WITH candidatos AS (
  SELECT
    s.id,
    COALESCE(s.valor_total, 0) AS valor_bruto,
    COALESCE(s.comision_aliado, 0) AS comision,
    GREATEST(0, COALESCE(s.valor_total, 0) - COALESCE(s.comision_aliado, 0)) AS valor_neto
  FROM public.servicios s
  JOIN public.solicitudes_servicio sol ON sol.servicio_id = s.id
  JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
  WHERE sol.origen = 'ALIADO'
    AND sol.estado = 'CONVERTIDO'
    AND s.estado <> 'CANCELADO'
    AND s.punto_recogida = 'CLINICA_ALIADA'
    AND s.aliado_origen_id IS NOT NULL
    AND COALESCE(s.comision_aliado, 0) > 0
    AND COALESCE(s.valor_total, 0) > COALESCE(s.comision_aliado, 0)
    AND COALESCE(s.comision_descontada, false) = false
    AND a.modalidad_comision IN ('DESCUENTO_INMEDIATO', 'FACTURACION_MENSUAL')
    AND COALESCE(s.valor_pagado, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.recibos_tecnico rt WHERE rt.servicio_id = s.id
    )
    -- Guarda anti doble-descuento: los servicios del bug quedaron con valor_plan
    -- igual al bruto. Si alguien ya corrigio valor_total a neto manualmente,
    -- valor_plan y valor_total ya no coinciden y este UPDATE no lo toca.
    AND (
      s.valor_plan IS NULL
      OR ABS(COALESCE(s.valor_plan, 0) - COALESCE(s.valor_total, 0)) <= 1
    )
)
UPDATE public.servicios s
   SET valor_total = c.valor_neto,
       comision_descontada = true,
       estado_pago = 'PENDIENTE',
       valor_plan = CASE
         WHEN COALESCE(s.valor_plan, 0) <= 0 THEN c.valor_bruto
         ELSE s.valor_plan
       END
  FROM candidatos c
 WHERE s.id = c.id;

COMMIT;

-- Previsualizar candidatos antes de aplicar, si quieres revisar manualmente:
-- SELECT s.id, s.valor_total AS bruto_actual,
--        s.valor_total - s.comision_aliado AS neto_corregido,
--        s.comision_aliado, a.nombre AS aliado, a.modalidad_comision
--   FROM public.servicios s
--   JOIN public.solicitudes_servicio sol ON sol.servicio_id = s.id
--   JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
--  WHERE sol.origen = 'ALIADO'
--    AND sol.estado = 'CONVERTIDO'
--    AND s.estado <> 'CANCELADO'
--    AND s.punto_recogida = 'CLINICA_ALIADA'
--    AND COALESCE(s.comision_aliado, 0) > 0
--    AND COALESCE(s.comision_descontada, false) = false
--    AND a.modalidad_comision IN ('DESCUENTO_INMEDIATO', 'FACTURACION_MENSUAL')
--    AND COALESCE(s.valor_pagado, 0) = 0
--    AND NOT EXISTS (SELECT 1 FROM public.recibos_tecnico rt WHERE rt.servicio_id = s.id)
--    AND (s.valor_plan IS NULL OR ABS(COALESCE(s.valor_plan, 0) - COALESCE(s.valor_total, 0)) <= 1);
--
-- Ver servicios del portal que ya tenian recibo/pago o no cumplen la guarda y
-- requieren revision manual:
-- SELECT s.id, s.valor_total, s.valor_plan, s.valor_pagado,
--        s.comision_aliado, s.comision_descontada,
--        a.nombre AS aliado, a.modalidad_comision, sol.id AS solicitud_id
--   FROM public.servicios s
--   JOIN public.solicitudes_servicio sol ON sol.servicio_id = s.id
--   JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
--  WHERE sol.origen = 'ALIADO'
--    AND sol.estado = 'CONVERTIDO'
--    AND COALESCE(s.comision_aliado, 0) > 0
--    AND COALESCE(s.comision_descontada, false) = false
--    AND a.modalidad_comision IN ('DESCUENTO_INMEDIATO', 'FACTURACION_MENSUAL')
--    AND (
--      COALESCE(s.valor_pagado, 0) > 0
--      OR EXISTS (SELECT 1 FROM public.recibos_tecnico rt WHERE rt.servicio_id = s.id)
--      OR (s.valor_plan IS NOT NULL AND ABS(COALESCE(s.valor_plan, 0) - COALESCE(s.valor_total, 0)) > 1)
--    );