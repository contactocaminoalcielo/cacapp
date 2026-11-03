-- ============================================================================
-- 203 — Tenjo: Candidatas dice QUÉ lote o traslado tiene ocupada a la mascota
-- Fecha: 2026-11-03  ·  Agrega columnas al final de v_candidatos_tenjo (202)
--
-- Problema (David, 2026-11-02): Katty Díaz y ORUS seguían PROPUESTO en el
-- borrador TJ-20261001 (un mes vencido) y María celeste tenía un traslado
-- PROGRAMADO sin lote. Candidatas solo decía "En el lote" / "Traslado activo",
-- sin decir cuál ni de cuándo, y "Agregar al lote" las descartaba sin error
-- (índice único). Hubo que liberarlas por SQL.
--
-- Fix: la vista expone el lote/traslado que la ocupa. La pestaña Candidatas lo
-- muestra y ofrece "Liberar" cuando está vencido u huérfano; el job nocturno
-- /jobs/generar-propuesta limpia lo vencido (orbit-backend/src/jobs/limpieza-tenjo.js).
--
-- Columnas nuevas (al final: CREATE OR REPLACE VIEW solo permite agregar ahí):
--   item_activo_lote, item_activo_fecha, item_activo_lote_estado, item_activo_estado
--   traslado_activo_id, traslado_activo_fecha, traslado_activo_estado,
--   traslado_huerfano  — ningún item activo de lote lo referencia
--
-- CREATE OR REPLACE re-ejecutable; preserva GRANTs y security_invoker. Aplicar en VPS:
--   cat migrations/203_tenjo_candidatas_que_la_bloquea.sql | docker exec -i supabase-db psql -U postgres -d postgres
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
  (tr.id IS NOT NULL)                     AS traslado_activo,
  ia.id                                   AS item_activo_id,
  (
    SELECT count(*)::int FROM public.lotes_tenjo_items li2
    WHERE li2.servicio_id = cf.servicio_id AND li2.estado = 'REPROGRAMADO'
  )                                       AS veces_reprogramada,
  -- ── 203: qué la ocupa ──
  ia.numero_lote                          AS item_activo_lote,
  ia.fecha_jornada                        AS item_activo_fecha,
  ia.estado_lote                          AS item_activo_lote_estado,
  ia.estado                               AS item_activo_estado,
  tr.id                                   AS traslado_activo_id,
  tr.fecha_traslado                       AS traslado_activo_fecha,
  tr.estado                               AS traslado_activo_estado,
  (tr.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.lotes_tenjo_items lt
    WHERE lt.traslado_id = tr.id
      AND lt.estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')
  ))                                      AS traslado_huerfano
FROM public.cuarto_frio cf
JOIN public.servicios s   ON s.id = cf.servicio_id
JOIN public.planes p      ON p.id = s.plan_id
JOIN public.mascotas m    ON m.id_mascota = s.mascota_id
LEFT JOIN public.especies esp ON esp.id = m.especie_id
LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
LEFT JOIN public.neveras n    ON n.codigo = cf.nevera_codigo
-- Índices únicos: a lo sumo un item activo (003) y un traslado activo (001) por servicio
LEFT JOIN LATERAL (
  SELECT li.id, li.estado, l.numero_lote, l.fecha_jornada, l.estado AS estado_lote
  FROM public.lotes_tenjo_items li
  JOIN public.lotes_tenjo l ON l.id = li.lote_id
  WHERE li.servicio_id = cf.servicio_id
    AND li.estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')
  LIMIT 1
) ia ON true
LEFT JOIN LATERAL (
  SELECT t.id, t.estado, t.fecha_traslado
  FROM public.traslados_tenjo t
  WHERE t.servicio_id = cf.servicio_id AND t.estado IN ('PROGRAMADO','EN_CAMINO')
  LIMIT 1
) tr ON true
WHERE cf.fecha_salida IS NULL
  AND p.tipo_proceso IN ('CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL')
  AND s.estado NOT IN ('CANCELADO','ENTREGADO','EN_ENTREGA');

-- ============================================================================
-- ROLLBACK: re-ejecutar migrations/202_tenjo_candidatas_listo_en_nevera.sql
--   (DROP VIEW primero: CREATE OR REPLACE no deja quitar columnas)
--   DROP VIEW public.v_candidatos_tenjo;  + GRANTs de supabase/security/
-- ============================================================================
