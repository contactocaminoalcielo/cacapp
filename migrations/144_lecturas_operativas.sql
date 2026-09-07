-- Lecturas pequeñas para el menú y Kanban. No modifica estados ni importes.
-- SECURITY INVOKER conserva las mismas políticas RLS de las tablas/vistas.
BEGIN;

CREATE OR REPLACE FUNCTION public.orbit_contadores(p_desde date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS MATERIALIZED (
    -- Mismos INNER JOIN y exclusiones que v_alertas/v_kanban. Los LEFT JOIN
    -- de la vista solo aportan detalle, no eliminan servicios.
    SELECT s.id, s.fecha_limite_entrega
    FROM public.servicios s
    JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    JOIN public.clientes c ON c.id_cliente = m.cliente_id
    WHERE s.fecha_ingreso >= p_desde
      AND s.estado NOT IN ('ENTREGADO', 'CANCELADO')
  ), fechas AS MATERIALIZED (
    SELECT DISTINCT fecha_limite_entrega FROM base
    WHERE fecha_limite_entrega IS NOT NULL
  ), dias AS MATERIALIZED (
    -- Se conserva la función autoritativa (Bogotá y festivos), una vez por
    -- fecha distinta en vez de repetirse por servicio y rama del CASE.
    SELECT fecha_limite_entrega,
      public.fn_dias_habiles_hasta(fecha_limite_entrega) AS restantes
    FROM fechas
  )
  SELECT jsonb_build_object(
    'kanban', (SELECT count(*) FROM base b JOIN dias d USING (fecha_limite_entrega) WHERE d.restantes <= 3),
    'produccion', (SELECT count(*) FROM public.servicio_recordatorios sr
      JOIN public.servicios s ON s.id = sr.servicio_id
      WHERE sr.estado = 'PENDIENTE' AND sr.origen <> 'REMOVIDO' AND s.fecha_ingreso >= p_desde),
    'imagenes', (SELECT count(*) FROM public.solicitudes_imagenes WHERE estado = 'POR_VALIDAR'),
    'nps', (SELECT count(*) FROM public.nps_seguimiento WHERE estado = 'PENDIENTE')
  );
$$;

CREATE OR REPLACE FUNCTION public.kanban_items_resumen(p_desde date)
RETURNS TABLE(servicio_id uuid, items jsonb)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  -- El tablero usa existencia/estado/tipo, no cantidades: duplicados idénticos
  -- no cambian el filtro ni la decisión todos-listos. NA se conserva para el
  -- badge de adicionales, que históricamente sí lo tiene en cuenta.
  SELECT sr.servicio_id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'recordatorio_id', sr.recordatorio_id, 'estado', sr.estado, 'origen', sr.origen
    )) AS items
  FROM public.servicio_recordatorios sr
  JOIN public.servicios s ON s.id = sr.servicio_id
  WHERE s.fecha_ingreso >= p_desde AND sr.origen <> 'REMOVIDO'
  GROUP BY sr.servicio_id;
$$;

REVOKE ALL ON FUNCTION public.orbit_contadores(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kanban_items_resumen(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orbit_contadores(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kanban_items_resumen(date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
