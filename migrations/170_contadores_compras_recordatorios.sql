-- ============================================================================
-- 170 — El badge de Producción cuenta también las compras de recordatorios
-- ----------------------------------------------------------------------------
-- Desde la 168 hay líneas por producir que no cuelgan de un servicio
-- (`compra_recordatorio_items`). El contador del menú (`orbit_contadores`,
-- migr. 144) solo sumaba `servicio_recordatorios`, así que una cédula pendiente
-- no se veía en el sidebar aunque sí en el tablero. Se redefine la función
-- ENTERA (es `CREATE OR REPLACE`; el resto de las llaves queda igual que en la
-- 144). Las compras anuladas no cuentan.
--
-- Aditiva, idempotente, reversible (volver a correr la 144).
-- Aplicar en VPS (Contabo):
--   cat migrations/170_contadores_compras_recordatorios.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.orbit_contadores(p_desde date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS MATERIALIZED (
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
    SELECT fecha_limite_entrega,
      public.fn_dias_habiles_hasta(fecha_limite_entrega) AS restantes
    FROM fechas
  )
  SELECT jsonb_build_object(
    'kanban', (SELECT count(*) FROM base b JOIN dias d USING (fecha_limite_entrega) WHERE d.restantes <= 3),
    'produccion',
      (SELECT count(*) FROM public.servicio_recordatorios sr
        JOIN public.servicios s ON s.id = sr.servicio_id
        WHERE sr.estado = 'PENDIENTE' AND sr.origen <> 'REMOVIDO' AND s.fecha_ingreso >= p_desde)
      + (SELECT count(*) FROM public.compra_recordatorio_items ci
        JOIN public.compras_recordatorios c ON c.id = ci.compra_id
        WHERE ci.estado = 'PENDIENTE' AND c.anulada_en IS NULL),
    'imagenes', (SELECT count(*) FROM public.solicitudes_imagenes WHERE estado = 'POR_VALIDAR'),
    'nps', (SELECT count(*) FROM public.nps_seguimiento WHERE estado = 'PENDIENTE')
  );
$$;

-- Realtime: el tablero de Producción se suscribe a las líneas de compra para
-- que un cambio de otro usuario se vea sin recargar (mismo patrón que
-- `entregas`, migr. 083). Idempotente: solo se agrega si no está.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'compra_recordatorio_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.compra_recordatorio_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'compras_recordatorios') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.compras_recordatorios;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.orbit_contadores(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orbit_contadores(date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- Verificar: select public.orbit_contadores('2026-06-09');
