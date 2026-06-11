-- ============================================================================
-- 001 — Fase 0 Tenjo: índice único contra traslados duplicados
-- Fecha: 2026-06-11
-- Verificado en producción antes de crear este archivo:
--   0 servicios con más de un traslado activo (PROGRAMADO/EN_CAMINO)
--
-- Aplicar en VPS Contabo:
--   cd /opt/supabase/docker && docker compose exec db psql -U postgres -d postgres --pset pager=off \
--     -c "CREATE UNIQUE INDEX IF NOT EXISTS uq_traslados_tenjo_activo ON public.traslados_tenjo (servicio_id) WHERE estado IN ('PROGRAMADO','EN_CAMINO');"
-- ============================================================================

-- Un servicio no puede tener dos traslados Tenjo activos al mismo tiempo.
-- Protege a nivel de base de datos, sin depender del frontend.
CREATE UNIQUE INDEX IF NOT EXISTS uq_traslados_tenjo_activo
  ON public.traslados_tenjo (servicio_id)
  WHERE estado IN ('PROGRAMADO', 'EN_CAMINO');

-- Nota: cuarto_frio_movimientos.tipo es TEXT sin check constraint, por lo que
-- los nuevos tipos de movimiento 'SALIDA_TENJO' y 'SALIDA_LOTE_GRUPAL' que
-- registra el frontend NO requieren cambio de esquema.

-- ROLLBACK:
--   DROP INDEX IF EXISTS public.uq_traslados_tenjo_activo;
