-- ============================================================================
-- 022 — Recordatorios que recolecta el técnico al recoger la mascota
-- Fecha: 2026-06-30
--
-- David: ítems como huella mechón, cápsula de recuerdos, huella amuleto y
-- evidencias de conservación los entrega/recoge el técnico en el momento de la
-- recogida. No deberían quedar como PENDIENTE en la cola de producción: al
-- confirmar la recogida pasan solos a EN_PROCESO (les falta el cierre en
-- Producción, pero ya no exigen el paso de "iniciar").
--
-- Implementación:
--   - Flag por recordatorio `recolecta_tecnico` (se marca/desmarca en
--     Configuración › Recordatorios).
--   - Al completar la recogida (TecnicoApp), los ítems de ese servicio cuyo
--     recordatorio tenga recolecta_tecnico=true y estén PENDIENTE pasan a
--     EN_PROCESO.
--   - Producción NO auto-avanza el servicio a EN_PRODUCCION solo porque estos
--     ítems estén EN_PROCESO (se excluyen del disparador en autoCorregirEstados).
--
-- El UPDATE de abajo es un DEFAULT de conveniencia para los 4 ítems que David
-- nombró; puede ajustarlos luego en Configuración.
--
-- Aplicar por SSH→psql en Contabo. Aditiva, idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.recordatorios
  ADD COLUMN IF NOT EXISTS recolecta_tecnico boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recordatorios.recolecta_tecnico IS
  'Ítem que el técnico entrega/recoge en la recogida. Al confirmar la recogida pasa solo a EN_PROCESO; no exige el paso de iniciar en Producción.';

-- Default de conveniencia para los ítems nombrados por David (ajustable en Config).
UPDATE public.recordatorios
   SET recolecta_tecnico = true
 WHERE recolecta_tecnico = false
   AND (
        nombre ILIKE '%mech%'        -- huella mechón
     OR nombre ILIKE '%amuleto%'     -- huella amuleto
     OR nombre ILIKE '%capsula%'     -- cápsula de recuerdos
     OR nombre ILIKE '%cápsula%'
     OR nombre ILIKE '%conservaci%'  -- evidencias de conservación
   );

COMMIT;
