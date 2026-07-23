-- ============================================================================
-- 073 — Sincronizar valor_plan tras recálculo por peso (dato de display)
-- ----------------------------------------------------------------------------
-- David (2026-07-23): la recategorización de precio por cambio de peso dejaba
-- `valor_plan` viejo (solo se actualizaba `valor_total`) → el "Valor del plan"
-- del cuadre no cuadraba con el "Total a recaudar" (caso TATA GAMBOA: plan
-- 109.000 vs total 139.000 sin nada que explique la brecha).
--
-- El fix del código (lib/precios.js) ya actualiza `valor_plan` a la par en los
-- recálculos futuros. Esta migración corrige los servicios YA descuadrados.
--
-- `valor_plan` es un dato de SOLO DISPLAY (ficha, modal del cuadre): NO entra en
-- el cálculo de dinero del cuadre (eso usa valor_total→valor_a_cobrar). Aquí NO
-- se mueve plata: valor_total y valor_pagado quedan intactos. Las diferencias de
-- pago (cobró de más/de menos por el reweigh) siguen visibles como "Diferencia"
-- en el cuadre para que el coordinador las gestione.
--
-- SELECCIÓN PRECISA — solo los casos LIMPIOS, donde valor_total == el precio
-- correcto para el peso actual (firma del recálculo-stale). Se EXCLUYEN:
--   · eutanasia (valor_total incluye la eutanasia; valor_plan ya es correcto)
--   · DESAMPARADO (precio por fórmula, no por rango)
--   · anomalías donde el valor_total NO coincide con la tarifa (ej. MICHI:
--     valor_plan ya correcto, el anómalo es valor_total → se revisa aparte)
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE tmp_sync_073 ON COMMIT DROP AS
WITH svc AS (
  SELECT s.id, pl.codigo, m.especie_id, s.valor_plan, s.valor_total,
         (SELECT round(peso_kg * 1000) FROM public.cuarto_frio cf
           WHERE cf.servicio_id = s.id ORDER BY created_at DESC LIMIT 1) AS pesog
  FROM public.servicios s
  JOIN public.mascotas m ON m.id_mascota = s.mascota_id
  LEFT JOIN public.planes pl ON pl.id = s.plan_id
  WHERE s.fecha_ingreso >= '2026-06-09' AND s.estado <> 'CANCELADO'
    AND COALESCE(s.valor_adicionales,0)=0 AND COALESCE(s.valor_transporte,0)=0
    AND COALESCE(s.descuento_adicional,0)=0 AND COALESCE(s.comision_aliado,0)=0
    AND COALESCE(s.recargo_nocturno,0)=0
    AND s.eutanasia_id IS NULL
    AND s.valor_plan IS NOT NULL AND s.valor_total <> s.valor_plan
    AND COALESCE(pl.codigo,'') <> 'DESAMPARADO'
)
SELECT svc.id, svc.valor_plan AS plan_viejo, svc.valor_total AS plan_nuevo
FROM svc
WHERE svc.pesog IS NOT NULL
  AND svc.valor_total = COALESCE(
    -- Tarifa de planes_precios por rango (Eco-grupal, Compets, Exclusivo, …)
    (SELECT pp.precio FROM public.planes_precios pp
      JOIN public.planes p2 ON p2.id = pp.plan_id
      WHERE p2.codigo = svc.codigo AND (
        (svc.pesog < 1000 AND pp.rango_nombre = 'PETIT') OR
        (svc.pesog >= 1000 AND svc.especie_id IN (2,3) AND pp.rango_nombre = 'FELINO') OR
        (svc.pesog >= 1000 AND svc.especie_id NOT IN (2,3) AND pp.rango_nombre NOT IN ('FELINO','PETIT')
          AND pp.peso_min_gr <= svc.pesog AND pp.peso_max_gr >= svc.pesog)
      ) LIMIT 1),
    -- Fallback ANGEL (no vive en planes_precios; misma lógica que precios.js)
    CASE WHEN svc.codigo = 'ANGEL' THEN
      CASE WHEN svc.pesog < 1000 THEN 69000
           WHEN svc.especie_id IN (2,3) THEN 79000
           WHEN svc.pesog < 11000 THEN 89000
           WHEN svc.pesog < 21000 THEN 119000
           WHEN svc.pesog < 36000 THEN 139000
           ELSE 189000 END
    END
  );

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM tmp_sync_073;
  RAISE NOTICE 'Servicios con valor_plan a sincronizar: %', v_n;
END $$;

-- Auditoría por servicio
INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT id, 'NOTA',
  'Corrección de display (migración 073): valor_plan '
  || to_char(plan_viejo, 'FM$999,999,999') || '→' || to_char(plan_nuevo, 'FM$999,999,999')
  || ' para reflejar el precio del peso actual (la recategorización solo había '
  || 'movido el total). No cambia el dinero cobrado ni la diferencia del cuadre.'
FROM tmp_sync_073;

-- Servicio (fuente)
UPDATE public.servicios s SET valor_plan = t.plan_nuevo
FROM tmp_sync_073 t WHERE s.id = t.id;

-- Snapshot del cuadre en BORRADOR (para que el modal lo refleje sin regenerar).
-- Los CERRADOS conservan su snapshot congelado.
UPDATE public.cuadre_items ci SET valor_plan = t.plan_nuevo
FROM tmp_sync_073 t, public.cuadres_tecnico c2
WHERE ci.servicio_id = t.id
  AND ci.cuadre_id = c2.id AND c2.estado = 'BORRADOR';

COMMIT;
