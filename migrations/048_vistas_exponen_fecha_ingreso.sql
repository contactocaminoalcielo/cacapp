-- 048_vistas_exponen_fecha_ingreso.sql
--
-- Corte de datos operativo (Orbit solo muestra servicios desde 2026-06-09).
-- El corte vive en el FRONTEND (constante FECHA_CORTE en src/lib/constants.js) y se
-- aplica como `.gte('fecha_ingreso', FECHA_CORTE)` en cada listado. Para que eso sea
-- posible, las vistas que alimentan Dashboard/Badges y Reportes deben exponer la
-- fecha de ingreso del servicio — hoy no la traen.
--
-- Cambio ADITIVO: se agrega `fecha_ingreso` como última columna. CREATE OR REPLACE
-- VIEW conserva owner y GRANTs; se reafirma security_invoker por si acaso.
-- No cambia ninguna fila ni ninguna semántica existente.

BEGIN;

-- ── v_alertas (Dashboard + BadgesContext) ─────────────────────────────────────
-- Deriva de v_kanban, que ya expone fecha_ingreso: basta con proyectarla.
CREATE OR REPLACE VIEW public.v_alertas
WITH (security_invoker = on) AS
SELECT
  k.servicio_id,
  k.mascota,
  k.cliente,
  k.cliente_wa,
  k.plan,
  k.tipo_proceso,
  k.estado,
  k.fecha_limite_entrega,
  k.dias_para_vencer,
  k.imagenes_solicitadas,
  k.total_items,
  k.items_listos,
  k.alerta_fotos_pendientes,
  CASE
    WHEN k.fecha_limite_entrega IS NULL THEN 'SIN_FECHA'::text
    WHEN k.dias_para_vencer < 0         THEN 'VENCIDO'::text
    WHEN k.dias_para_vencer = 0         THEN 'HOY'::text
    WHEN k.dias_para_vencer <= 3        THEN 'URGENTE'::text
    WHEN k.dias_para_vencer <= 7        THEN 'PROXIMO'::text
    ELSE 'OK'::text
  END AS nivel_alerta,
  k.fecha_ingreso                       -- ← nueva (última columna)
FROM v_kanban k
WHERE (k.estado)::text <> ALL (ARRAY['ENTREGADO'::text, 'CANCELADO'::text])
ORDER BY k.dias_para_vencer;

-- ── v_tiempo_promesa (Reportes) ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_tiempo_promesa
WITH (security_invoker = on) AS
SELECT
  s.id AS servicio_id,
  m.nombre AS mascota,
  (c.nombre::text || ' '::text) || c.apellido::text AS cliente,
  p.nombre AS plan,
  s.fecha_imagenes_recibidas,
  s.fecha_limite_entrega,
  s.fecha_entrega_real,
  CASE
    WHEN s.fecha_entrega_real IS NOT NULL THEN s.fecha_entrega_real - s.fecha_imagenes_recibidas
    ELSE CURRENT_DATE - s.fecha_imagenes_recibidas
  END AS dias_transcurridos,
  p.dias_entrega_prometidos,
  CASE
    WHEN s.fecha_entrega_real IS NOT NULL AND s.fecha_entrega_real <= s.fecha_limite_entrega THEN 'A_TIEMPO'::text
    WHEN s.fecha_entrega_real IS NOT NULL AND s.fecha_entrega_real >  s.fecha_limite_entrega THEN 'TARDE'::text
    WHEN s.fecha_entrega_real IS NULL AND CURRENT_DATE > s.fecha_limite_entrega              THEN 'VENCIDO'::text
    WHEN s.fecha_entrega_real IS NULL AND s.fecha_limite_entrega IS NOT NULL                 THEN 'EN_TIEMPO'::text
    ELSE 'SIN_FECHA'::text
  END AS cumplimiento_promesa,
  s.fecha_ingreso                       -- ← nueva (última columna)
FROM servicios s
JOIN mascotas m ON s.mascota_id = m.id_mascota
JOIN clientes c ON m.cliente_id = c.id_cliente
LEFT JOIN planes p ON s.plan_id = p.id
WHERE s.fecha_imagenes_recibidas IS NOT NULL
ORDER BY s.fecha_limite_entrega;

COMMIT;
