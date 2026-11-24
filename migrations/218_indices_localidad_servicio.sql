-- 218 · Índices por servicio_id en recogidas y solicitudes_servicio
--
-- INCIDENTE 24-nov-2026 (~10:00 Bogotá): "Orbit está caído, busco una mascota en Gestión y no
-- carga". No estaba caído: supabase-db al 240% de CPU (load 10 en 8 núcleos) con ~8 consultas
-- del Historial de Gestión corriendo a la vez, 5-7 s cada una.
--
-- Causa: la columna calculada `localidad_servicio(servicios)` (migr. 177) busca en `recogidas`
-- y DOS veces en `solicitudes_servicio` por `servicio_id`, y ninguna de las dos tenía índice en
-- esa columna → recorrido completo de ambas tablas POR CADA servicio. Calcularla para los 2182
-- servicios desde FECHA_CORTE tardaba 5,3 s (contarlos, 0,03 s). El buscador del Historial trae
-- TODO el histórico (dbTodo) → cada búsqueda la calcula para todos, y cada tecla (con debounce)
-- dispara otra sin cancelar la anterior.
--
-- CONCURRENTLY: no bloquea escrituras. No puede ir dentro de BEGIN/COMMIT (por eso no hay).
-- Reversa: DROP INDEX CONCURRENTLY IF EXISTS public.ix_recogidas_servicio_id;
--          DROP INDEX CONCURRENTLY IF EXISTS public.ix_solicitudes_servicio_servicio_id;

\set ON_ERROR_STOP on
\timing on

SELECT 'antes' AS momento, count(localidad_servicio(s)) FROM public.servicios s WHERE fecha_ingreso >= '2026-06-09';

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_recogidas_servicio_id
  ON public.recogidas (servicio_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_solicitudes_servicio_servicio_id
  ON public.solicitudes_servicio (servicio_id);

ANALYZE public.recogidas;
ANALYZE public.solicitudes_servicio;

SELECT 'despues' AS momento, count(localidad_servicio(s)) FROM public.servicios s WHERE fecha_ingreso >= '2026-06-09';
