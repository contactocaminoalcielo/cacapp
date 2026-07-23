-- ============================================================================
-- 074 — Corregir servicios corruptos por cambios de plan (valor_plan/valor_total)
-- ----------------------------------------------------------------------------
-- David (2026-07-23): un cambio de plan dejaba el "Precio del servicio" del
-- recibo inflado (caso COPITO: $982.800). Causa: `Kanban.cambiarPlan` recalculaba
-- `valor_total = precio del plan − comisión` IGNORANDO adicionales/transporte, y
-- NUNCA actualizaba `valor_plan`. El fix del código (Kanban.jsx) ya preserva los
-- extras y actualiza valor_plan en los cambios FUTUROS. Esta migración corrige
-- los 2 servicios YA corruptos (únicos con cambio de plan + extras).
--
-- Valores correctos (verificados con la tarifa por peso y el historial de pago):
--   COPITO (Exclusivo videollamada, DESCUENTO_INMEDIATO):
--     plan 819.000 + adic 65.000 + transp 11.000 = BRUTO 895.000; comisión
--     163.800 (20% del plan). El cliente pagó 894.900 (el bruto) por el técnico.
--   BRANDY (Eco-grupal 21-35kg, DESCUENTO_INMEDIATO):
--     plan 169.000 + transp 21.000 = BRUTO 190.000; comisión 16.900 (10% del
--     plan). El cliente pagó 237.750 cuando el plan era Básico (antes del cambio).
--
-- Se pone `comision_descontada = FALSE` (el cliente pagó el BRUTO por el técnico
-- → la comisión queda PENDIENTE con la veterinaria, no descontada) y valor_total
-- = BRUTO, para que cuadre con lo que el cliente pagó y el recibo muestre el
-- precio real. `valor_pagado` NO se toca.
--
-- OJO (decisión de David, NO resuelto aquí): quedan descuadres de pago reales:
--   · COPITO pagó 894.900 ≈ bruto 895.000 → ok (100 de redondeo).
--   · BRANDY pagó 237.750 por Básico y el plan bajó a Eco-grupal (bruto 190.000)
--     → el cliente pagó de más ~47.750; David decide devolución/crédito.
--
-- Aplicar por SSH→psql en Contabo. Idempotente (condiciona por los valores viejos).
-- ============================================================================

BEGIN;

-- COPITO
UPDATE public.servicios SET
  valor_plan = 819000, valor_total = 895000, comision_descontada = false
WHERE id = 'c3d50f52-5750-4cc2-a017-33dd525984d1'
  AND valor_plan = 109000 AND valor_total = 819000;

INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT 'c3d50f52-5750-4cc2-a017-33dd525984d1', 'NOTA',
  'Corrección (migración 074): tras 3 cambios de plan, valor_plan/valor_total '
  || 'quedaron mal. valor_plan 109.000→819.000, valor_total 819.000→895.000 (bruto '
  || '= plan 819.000 + adic 65.000 + transp 11.000), comision_descontada→false '
  || '(el cliente pagó el bruto; comisión 163.800 pendiente con la veterinaria).'
WHERE EXISTS (SELECT 1 FROM public.servicios WHERE id='c3d50f52-5750-4cc2-a017-33dd525984d1' AND valor_plan=819000);

-- BRANDY
UPDATE public.servicios SET
  valor_plan = 169000, valor_total = 190000, comision_descontada = false
WHERE id = '09b8dd2c-f6b8-4a39-8ac7-ed4d8f34f778'
  AND valor_plan = 289000 AND valor_total = 169000;

INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT '09b8dd2c-f6b8-4a39-8ac7-ed4d8f34f778', 'NOTA',
  'Corrección (migración 074): cambio de plan Básico→Eco-grupal dejó valor_plan/'
  || 'valor_total mal. valor_plan 289.000→169.000, valor_total 169.000→190.000 '
  || '(bruto = plan 169.000 + transp 21.000), comision_descontada→false. OJO: el '
  || 'cliente pagó 237.750 por Básico; con Eco-grupal el bruto es 190.000 → pagó '
  || 'de más ~47.750, pendiente de devolución/crédito (decisión de gerencia).'
WHERE EXISTS (SELECT 1 FROM public.servicios WHERE id='09b8dd2c-f6b8-4a39-8ac7-ed4d8f34f778' AND valor_plan=169000);

COMMIT;
