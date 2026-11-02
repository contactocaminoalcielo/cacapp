-- ============================================================================
-- 202 — Tenjo: una mascota que sigue en la nevera es candidata aunque el
--       servicio esté en LISTO
-- Fecha: 2026-11-02  ·  Ajusta el filtro de estado de 022_tenjo_candidatos_estado_fisico
--
-- Problema (reportado por David): María celeste (Compets presencial) seguía
-- REFRIGERADA en la nevera, sin fecha_salida, y no aparecía en Candidatas. Su
-- servicio estaba en LISTO porque Producción terminó todos sus recordatorios y
-- la autocorrección de Kanban/Producción (kanbanEstado.serviciosListosDesdeItems,
-- Produccion.autoCorregirEstados) lo pasa a LISTO apenas todos los ítems están
-- LISTOS. En Compets los recordatorios pueden terminarse antes del compostaje.
--
-- Devolver el servicio a EN_CUARTO_FRIO no sirve: la autocorrección lo regresa
-- a LISTO en el siguiente refresco del Tablero, y además esconde a Producción
-- que su trabajo ya está hecho.
--
-- Fix: mismo criterio que la 022 — manda lo FÍSICO (cf.fecha_salida IS NULL).
-- LISTO deja de excluirse. Diagnóstico en prod (2026-11-02): solo 1 mascota
-- individual en nevera con servicio LISTO/EN_ENTREGA (María celeste), así que
-- no entra basura vieja a Candidatas. El flujo de Tenjo no baja el estado del
-- servicio (tenjo.js avanza "sin downgrade"), así que un LISTO se queda LISTO.
--
-- CREATE OR REPLACE re-ejecutable; preserva GRANTs y security_invoker. Aplicar en VPS:
--   cat migrations/202_tenjo_candidatas_listo_en_nevera.sql | docker exec -i supabase-db psql -U postgres -d postgres
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
  AND s.estado NOT IN ('CANCELADO','ENTREGADO','EN_ENTREGA');

-- ============================================================================
-- ROLLBACK (volver al filtro de la 022):
--   reemplazar la última línea del WHERE por:
--     AND s.estado NOT IN ('CANCELADO','ENTREGADO','LISTO','EN_ENTREGA');
--   y re-ejecutar el CREATE OR REPLACE VIEW.
-- ============================================================================
