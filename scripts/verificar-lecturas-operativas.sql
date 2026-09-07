-- Ejecutar dentro de la misma transacción que la migración 144, antes de
-- COMMIT. Solo lee datos y aborta si no coincide exactamente con la operación.
DO $$
DECLARE nuevos jsonb; anteriores jsonb; diferencias integer;
BEGIN
  nuevos := public.orbit_contadores('2026-06-09');
  SELECT jsonb_build_object(
    'kanban', (SELECT count(*) FROM public.v_alertas WHERE fecha_ingreso >= '2026-06-09' AND nivel_alerta IN ('VENCIDO','HOY','URGENTE')),
    'produccion', (SELECT count(*) FROM public.servicio_recordatorios sr JOIN public.servicios s ON s.id=sr.servicio_id WHERE sr.estado='PENDIENTE' AND sr.origen<>'REMOVIDO' AND s.fecha_ingreso>='2026-06-09'),
    'imagenes', (SELECT count(*) FROM public.solicitudes_imagenes WHERE estado='POR_VALIDAR'),
    'nps', (SELECT count(*) FROM public.nps_seguimiento WHERE estado='PENDIENTE')
  ) INTO anteriores;
  IF nuevos IS DISTINCT FROM anteriores THEN RAISE EXCEPTION 'Contadores diferentes'; END IF;

  WITH original AS (
    SELECT DISTINCT sr.servicio_id, sr.recordatorio_id::text AS recordatorio_id, sr.estado::text, sr.origen::text
    FROM public.servicio_recordatorios sr JOIN public.servicios s ON s.id=sr.servicio_id
    WHERE s.fecha_ingreso>='2026-06-09' AND sr.origen<>'REMOVIDO'
  ), resumen AS (
    SELECT r.servicio_id, i->>'recordatorio_id' AS recordatorio_id, i->>'estado' AS estado, i->>'origen' AS origen
    FROM public.kanban_items_resumen('2026-06-09') r CROSS JOIN LATERAL jsonb_array_elements(r.items) i
  ), diff AS (
    (SELECT * FROM original EXCEPT SELECT * FROM resumen)
    UNION ALL
    (SELECT * FROM resumen EXCEPT SELECT * FROM original)
  ) SELECT count(*) INTO diferencias FROM diff;
  IF diferencias <> 0 THEN RAISE EXCEPTION 'El resumen de Kanban perdió o añadió estados/ítems'; END IF;

  IF has_function_privilege('anon','public.orbit_contadores(date)','EXECUTE')
     OR has_function_privilege('anon','public.kanban_items_resumen(date)','EXECUTE') THEN
    RAISE EXCEPTION 'Las lecturas no deben ser públicas';
  END IF;
  RAISE NOTICE 'OK: contadores e items equivalentes, sin acceso anon';
END $$;
