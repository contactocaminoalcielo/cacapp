-- 039 — Comisiones de los planes SIN recordatorios (2026-07-09)
--
-- Problema: COMPETS_SIN_REC, EXCLUSIVO_VIDEOLLAMADA_SIN_REC y
-- EXCLUSIVO_PRESENCIAL_SIN_REC nunca descontaron comisión de veterinaria:
--   * El seed del 2026-05-22 no incluyó esos planes en config_comisiones.
--   * Las reglas capturadas a mano el 2026-07-03 quedaron con los PORCENTAJES
--     en los campos de rango ("de 20 a 27 servicios/mes") → jamás hacen match
--     y la comisión sale 0.
-- Decisión David 2026-07-09: los SIN_REC comisionan IGUAL que su plan base
-- (mismo patrón que ya sigue BASICO_SIN_REC ≡ BASICO).

BEGIN;

-- 1) Eliminar las reglas mal capturadas de esos tres planes
DELETE FROM public.config_comisiones
WHERE plan_id IN (
  SELECT id FROM public.planes
  WHERE codigo IN ('COMPETS_SIN_REC','EXCLUSIVO_VIDEOLLAMADA_SIN_REC','EXCLUSIVO_PRESENCIAL_SIN_REC')
);

-- 2) Copiar las reglas del plan base a cada plan SIN_REC
INSERT INTO public.config_comisiones (plan_id, es_vip, rango_min, rango_max, porcentaje, notas)
SELECT sr.id, cc.es_vip, cc.rango_min, cc.rango_max, cc.porcentaje,
       'Espejo de ' || base.codigo || ' (migración 039)'
FROM (VALUES
  ('COMPETS_SIN_REC',                'COMPETS_EVIDENCIA'),
  ('EXCLUSIVO_VIDEOLLAMADA_SIN_REC', 'EXCLUSIVO_VIDEOLLAMADA'),
  ('EXCLUSIVO_PRESENCIAL_SIN_REC',   'EXCLUSIVO_PRESENCIAL')
) pares(codigo_sin_rec, codigo_base)
JOIN public.planes sr   ON sr.codigo   = pares.codigo_sin_rec
JOIN public.planes base ON base.codigo = pares.codigo_base
JOIN public.config_comisiones cc ON cc.plan_id = base.id;

-- 3) Backfill: servicios activos de veterinarias con esos planes y comisión 0.
--    comision_aliado = % de la regla × precio de tarifa (igual que la app:
--    el % se aplica sobre el precio base del rango de peso, no sobre valor_total).
--    El tramo se elige contando los servicios previos del aliado en el mes del
--    ingreso (sin DESAMPARADO), como hace Registro al crear el servicio.
--    comision_descontada NO se toca (el cobro en veterinaria se marca a mano).
WITH afectados AS (
  SELECT s.id, s.plan_id, s.fecha_ingreso, s.created_at, s.aliado_origen_id,
         m.peso_kg, m.especie_id, a.vip,
         ROUND(m.peso_kg * 1000)::int AS peso_g
  FROM public.servicios s
  JOIN public.planes p    ON p.id = s.plan_id
       AND p.codigo IN ('COMPETS_SIN_REC','EXCLUSIVO_VIDEOLLAMADA_SIN_REC','EXCLUSIVO_PRESENCIAL_SIN_REC')
  JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
  JOIN public.aliados a   ON a.id_aliado = s.aliado_origen_id
  WHERE s.estado NOT IN ('CANCELADO','ENTREGADO')
    AND COALESCE(s.comision_aliado, 0) = 0
), tarifa AS (
  SELECT af.*, pp.precio
  FROM afectados af
  JOIN public.planes_precios pp ON pp.plan_id = af.plan_id AND (
       (af.peso_g <  1000 AND pp.rango_nombre = 'PETIT') OR
       (af.peso_g >= 1000 AND COALESCE(af.especie_id,0) IN (2,3) AND pp.rango_nombre = 'FELINO') OR
       (af.peso_g >= 1000 AND COALESCE(af.especie_id,0) NOT IN (2,3) AND pp.rango_nombre <> 'FELINO'
          AND pp.peso_min_gr <= af.peso_g AND pp.peso_max_gr >= af.peso_g)
  )
), con_pct AS (
  SELECT t.id, t.precio,
    (SELECT cc.porcentaje
     FROM public.config_comisiones cc
     WHERE (cc.plan_id = t.plan_id OR cc.plan_id IS NULL)
       AND cc.es_vip = COALESCE(t.vip, false)
       AND cc.rango_min <= (
             SELECT count(*) FROM public.servicios s2
             JOIN public.planes p2 ON p2.id = s2.plan_id
             WHERE s2.aliado_origen_id = t.aliado_origen_id
               AND date_trunc('month', s2.fecha_ingreso) = date_trunc('month', t.fecha_ingreso)
               AND s2.created_at < t.created_at
               AND p2.codigo <> 'DESAMPARADO')
       AND (cc.rango_max IS NULL OR cc.rango_max >= (
             SELECT count(*) FROM public.servicios s2
             JOIN public.planes p2 ON p2.id = s2.plan_id
             WHERE s2.aliado_origen_id = t.aliado_origen_id
               AND date_trunc('month', s2.fecha_ingreso) = date_trunc('month', t.fecha_ingreso)
               AND s2.created_at < t.created_at
               AND p2.codigo <> 'DESAMPARADO'))
     ORDER BY (cc.plan_id IS NOT NULL) DESC, cc.rango_min DESC
     LIMIT 1) AS pct
  FROM tarifa t
)
UPDATE public.servicios s
SET comision_aliado = ROUND(cp.pct / 100.0 * cp.precio)
FROM con_pct cp
WHERE s.id = cp.id AND cp.pct IS NOT NULL;

COMMIT;
