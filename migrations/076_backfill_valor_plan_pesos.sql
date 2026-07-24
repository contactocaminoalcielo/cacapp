-- ============================================================================
-- 076 — Backfill de valor_plan por peso (display) — APLICADA en prod 2026-07-24
-- ----------------------------------------------------------------------------
-- David (2026-07-24): "actualiza todo lo de pesos". Extiende la migración 073,
-- que solo corrigió los casos LIMPIOS (valor_total == tarifa). Aquí se pone
-- `valor_plan = la tarifa del plan para el peso actual` en TODOS los servicios
-- donde está NULL o desactualizado, independientemente de adicionales/transporte/
-- descuento/comisión.
--
-- `valor_plan` es SOLO DISPLAY (ficha, modal del cuadre): NO entra en el cálculo
-- de dinero (eso usa valor_total→valor_a_cobrar). NO se mueve plata: valor_total,
-- valor_pagado y estado_pago quedan intactos. Las inconsistencias reales (adicional
-- o transporte no sumado al total) siguen visibles como descuadre/⚠ en el modal.
--
-- EXCLUYE: DESAMPARADO (precio por fórmula), eutanasia (valor por eutanasia_id),
-- activaciones de plan (descuento con motivo 'activ%', se dejan quietas por
-- decisión de David), y los servicios sin peso registrado o cuyo plan no vive en
-- planes_precios (Básico/Exclusivo "sin recordatorios" = ×80%, no rango) — esos 5
-- quedan sin tocar. Emparejamiento de tarifa idéntico a 073 (PETIT/FELINO/rango +
-- fallback ANGEL).
--
-- Efecto en prod: 193 servicios actualizados + 48 snapshots de cuadre en BORRADOR
-- + 193 novedades de auditoría. Tras aplicar, 43 servicios aún no reconcilian
-- (3 adicionales pendientes de cobro, 22 viejos pre-23jun, 17 recientes con
-- transporte no sumado / anomalías tipo ZEUS/MAX/MICHI) → revisión manual aparte.
--
-- Aplicar por SSH→psql en Contabo. Idempotente (vuelve a poner la misma tarifa).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE tmp076 ON COMMIT DROP AS
WITH t AS (
  SELECT s.id, pl.codigo, m.especie_id, s.valor_plan,
         s.descuento_adicional, s.descuento_adicional_motivo, s.eutanasia_id,
         (SELECT round(peso_kg*1000) FROM public.cuarto_frio cf
           WHERE cf.servicio_id=s.id ORDER BY created_at DESC LIMIT 1) AS pesog
  FROM public.servicios s
  JOIN public.mascotas m ON m.id_mascota=s.mascota_id
  LEFT JOIN public.planes pl ON pl.id=s.plan_id
  WHERE s.estado<>'CANCELADO'
),
m AS (
  SELECT t.*, COALESCE(
    (SELECT pp.precio FROM public.planes_precios pp
       JOIN public.planes p2 ON p2.id=pp.plan_id
      WHERE p2.codigo=t.codigo AND (
        (t.pesog < 1000 AND pp.rango_nombre='PETIT') OR
        (t.pesog >= 1000 AND t.especie_id IN (2,3) AND pp.rango_nombre='FELINO') OR
        (t.pesog >= 1000 AND t.especie_id NOT IN (2,3) AND pp.rango_nombre NOT IN ('FELINO','PETIT')
          AND pp.peso_min_gr <= t.pesog AND pp.peso_max_gr >= t.pesog)
      ) LIMIT 1),
    CASE WHEN t.codigo='ANGEL' THEN
      CASE WHEN t.pesog<1000 THEN 69000 WHEN t.especie_id IN (2,3) THEN 79000
           WHEN t.pesog<11000 THEN 89000 WHEN t.pesog<21000 THEN 119000
           WHEN t.pesog<36000 THEN 139000 ELSE 189000 END
    END
  ) AS tarifa
  FROM t
)
SELECT id, valor_plan AS viejo, tarifa AS nuevo
FROM m
WHERE pesog IS NOT NULL AND tarifa IS NOT NULL
  AND COALESCE(codigo,'')<>'DESAMPARADO' AND eutanasia_id IS NULL
  AND NOT (descuento_adicional>0 AND descuento_adicional_motivo ILIKE '%activ%')
  AND (valor_plan IS NULL OR valor_plan <> tarifa);

INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT id, 'NOTA',
  'Corrección de display (finanzas, pesos): valor_plan '
  || COALESCE(to_char(viejo,'FM$999,999,999'),'(vacío)') || ' -> ' || to_char(nuevo,'FM$999,999,999')
  || ' = precio del plan para el peso actual. No cambia lo cobrado ni el dinero del cuadre. Autorizado por David.'
FROM tmp076;

UPDATE public.servicios s SET valor_plan = t.nuevo FROM tmp076 t WHERE s.id=t.id;

-- Snapshot del cuadre en BORRADOR para que el modal lo refleje sin regenerar.
UPDATE public.cuadre_items ci SET valor_plan = t.nuevo
FROM tmp076 t JOIN public.cuadres_tecnico c2 ON true
WHERE ci.servicio_id=t.id AND ci.cuadre_id=c2.id AND c2.estado='BORRADOR';

COMMIT;

NOTIFY pgrst, 'reload schema';
