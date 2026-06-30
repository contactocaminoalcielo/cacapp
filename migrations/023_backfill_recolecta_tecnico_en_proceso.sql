-- ============================================================================
-- 023 — Backfill: ítems del técnico ya recogidos → EN_PROCESO
-- Fecha: 2026-06-30
--
-- Complemento de la 022. El hook de TecnicoApp solo marca EN_PROCESO los ítems
-- recolecta_tecnico al confirmar la recogida (hacia adelante). Este backfill
-- arregla los servicios que YA fueron recogidos y siguen con esos ítems en
-- PENDIENTE.
--
-- Alcance: solo servicios ya recogidos pero no terminados
--   (EN_CUARTO_FRIO, EN_PROCESO, EN_PRODUCCION).
--   - INGRESADO / EN_RECOGIDA: aún sin recoger → NO se tocan (igual que el hook).
--   - LISTO / EN_ENTREGA / ENTREGADO / CANCELADO: ya cerrados → NO se tocan.
--   - origen REMOVIDO: excluido.
--
-- ⚠️ Aplicar SOLO DESPUÉS de desplegar el frontend con el fix de
-- autoCorregirEstados (Producción), si no los servicios EN_CUARTO_FRIO se
-- adelantarían solos a EN_PRODUCCION.
--
-- Aplicar por SSH→psql en Contabo. Idempotente (solo PENDIENTE → EN_PROCESO).
-- ============================================================================

BEGIN;

UPDATE public.servicio_recordatorios sr
   SET estado = 'EN_PROCESO'
  FROM public.recordatorios r,
       public.servicios s
 WHERE sr.recordatorio_id = r.id
   AND sr.servicio_id     = s.id
   AND r.recolecta_tecnico = true
   AND sr.estado           = 'PENDIENTE'
   AND sr.origen <> 'REMOVIDO'
   AND s.estado IN ('EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION');

COMMIT;
