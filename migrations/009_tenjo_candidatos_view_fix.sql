-- ============================================================================
-- 009 — Tenjo: v_candidatos_tenjo no debe reproponer servicios ya procesados
-- Fecha: 2026-06-24
--
-- Problema: la vista solo excluia s.estado IN ('CANCELADO','ENTREGADO'), asi que
-- un servicio ya procesado (EN_PRODUCCION/LISTO/...) cuyo cuarto_frio quedo sin
-- fecha_salida seguia apareciendo como candidato y se reproponia en lotes nuevos.
--
-- Fix: ademas de fecha_salida IS NULL, exigir que el servicio NO haya pasado por
-- el proceso (excluir los estados post-Tenjo). Un candidato real esta en custodia
-- y aun no procesado.
--
-- CREATE OR REPLACE re-ejecutable. Aplicar en VPS Contabo:
--   cat 009_tenjo_candidatos_view_fix.sql | docker compose exec -T db psql -U postgres -d postgres
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
  AND s.estado NOT IN ('CANCELADO','ENTREGADO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA');

-- ============================================================================
-- ROLLBACK (volver a la version 003 — sin excluir estados post-Tenjo):
--   reemplazar la ultima linea del WHERE por:
--     AND s.estado NOT IN ('CANCELADO','ENTREGADO');
--   y re-ejecutar el CREATE OR REPLACE VIEW.
-- ============================================================================
