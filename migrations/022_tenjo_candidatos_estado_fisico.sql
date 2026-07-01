-- ============================================================================
-- 022 — Tenjo: candidatas por estado FÍSICO, no por estado del servicio
-- Fecha: 2026-07-01  ·  Reemplaza el filtro de estado de 009_tenjo_candidatos_view_fix
--
-- Problema (reportado por David): mascotas que siguen FÍSICAMENTE en la nevera
-- (cuarto_frio.fecha_salida IS NULL) esperando traslado a Tenjo —a veces aplazado—
-- no aparecían como candidatas ni se podían agregar a un lote, porque la vista las
-- excluía por s.estado IN ('EN_PROCESO','EN_PRODUCCION'). Pero el estado del
-- servicio NO es indicador de "ya se procesó/trasladó": una mascota pasa a
-- EN_PROCESO/EN_PRODUCCION por otros flujos (p.ej. el cliente sube las fotos →
-- EN_CUARTO_FRIO→EN_PROCESO, o avance manual) sin haber salido de la nevera.
--
-- Diagnóstico en prod (2026-07-01): 18 mascotas individuales EN_PRODUCCION seguían
-- en la nevera (12 con traslado PROGRAMADO aplazado, 6 sin traslado); NINGUNA con
-- traslado COMPLETADO → todas esperan traslado, ninguna es "procesada mal marcada".
--
-- Fix: el gate correcto de "aún en custodia, pendiente de traslado" es el FÍSICO
-- (cf.fecha_salida IS NULL). Se dejan de excluir EN_PROCESO/EN_PRODUCCION; se
-- siguen excluyendo solo los terminales/post-retorno (CANCELADO/ENTREGADO/LISTO/
-- EN_ENTREGA) que no deben re-trasladarse. Las ya procesadas de verdad tienen
-- fecha_salida registrada (el finalizar de la Jornada la pone) → siguen fuera.
--
-- CREATE OR REPLACE re-ejecutable; preserva GRANTs y security_invoker. Aplicar en VPS:
--   cat migrations/022_tenjo_candidatos_estado_fisico.sql | docker exec -i supabase-db psql -U postgres -d postgres
-- ============================================================================

CREATE OR REPLACE VIEW public.v_candidatos_tenjo
WITH (security_invoker = true) AS
SELECT
  cf.id                                   AS cuarto_frio_id,
  cf.servicio_id,
  s.estado                                AS estado_servicio,
  s.estado_pago,
  s.tipo_acompanamiento,
  m.nombre                                AS mascota,
  esp.nombre                              AS especie,
  COALESCE(cf.peso_kg, m.peso_kg)         AS peso_kg,
  c.id_cliente                            AS cliente_id,
  TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS cliente,
  c.whatsapp                              AS cliente_whatsapp,
  p.nombre                                AS plan,
  p.codigo                                AS codigo_plan,
  p.tipo_proceso,
  cf.nevera_codigo,
  n.destino                               AS nevera_destino,
  cf.estado                               AS estado_cf,
  cf.fecha_ingreso,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - cf.fecha_ingreso)) / 86400)::int AS dias_custodia,
  EXISTS (
    SELECT 1 FROM public.traslados_tenjo t
    WHERE t.servicio_id = cf.servicio_id AND t.estado IN ('PROGRAMADO','EN_CAMINO')
  )                                       AS traslado_activo,
  (
    SELECT li.id FROM public.lotes_tenjo_items li
    WHERE li.servicio_id = cf.servicio_id
      AND li.estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')
    LIMIT 1
  )                                       AS item_activo_id,
  (
    SELECT count(*)::int FROM public.lotes_tenjo_items li2
    WHERE li2.servicio_id = cf.servicio_id AND li2.estado = 'REPROGRAMADO'
  )                                       AS veces_reprogramada
FROM public.cuarto_frio cf
JOIN public.servicios s   ON s.id = cf.servicio_id
JOIN public.planes p      ON p.id = s.plan_id
JOIN public.mascotas m    ON m.id_mascota = s.mascota_id
LEFT JOIN public.especies esp ON esp.id = m.especie_id
LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
LEFT JOIN public.neveras n    ON n.codigo = cf.nevera_codigo
WHERE cf.fecha_salida IS NULL
  AND p.tipo_proceso IN ('CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL')
  AND s.estado NOT IN ('CANCELADO','ENTREGADO','LISTO','EN_ENTREGA');

-- ============================================================================
-- ROLLBACK (volver a excluir por estado como en 009):
--   reemplazar la última línea del WHERE por:
--     AND s.estado NOT IN ('CANCELADO','ENTREGADO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA');
--   y re-ejecutar el CREATE OR REPLACE VIEW.
-- ============================================================================
