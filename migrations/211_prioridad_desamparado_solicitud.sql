-- ════════════════════════════════════════════════════════════════════════════
-- 211 — Prioridad del plan Desamparado en la solicitud — reporte Orbit, 18-nov-2026
-- ════════════════════════════════════════════════════════════════════════════
-- «Cuando soliciten servicios desde veterinaria por medio del enlace en plan
-- Desamparado, les dé la opción de sumar la prioridad y que efectivamente quede
-- sumado al monto del servicio.»
--
-- La prioridad (recogida dentro de las primeras 24 h; +$16.000, $20.000 en
-- domingo o festivo) solo se podía marcar en Registro. En el enlace de la
-- veterinaria no se preguntaba, y el agente de WhatsApp la dejaba escrita en las
-- notas: al aceptar la solicitud en el Kanban nadie la sumaba al valor.
--
-- Columna:
--   solicitudes_servicio.prioridad → lo que pidió la vet (enlace o agente).
--                                    NULL = no aplica / no se preguntó.
--
-- El MONTO no se guarda aquí: lo fija el coordinador al aceptar la solicitud
-- (depende del día en que se recoge) y viaja dentro de servicios.valor_total,
-- igual que hace Registro. No hay columna de desglose para este recargo.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migración → backend → frontend (git push).
--    El backend nuevo inserta la columna (enlace Y agente): sin ella, las
--    solicitudes de las veterinarias fallan.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.solicitudes_servicio
  ADD COLUMN IF NOT EXISTS prioridad boolean;

COMMIT;

-- VERIFICAR:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'solicitudes_servicio' AND column_name = 'prioridad';
--
-- ROLLBACK:
--   ALTER TABLE public.solicitudes_servicio DROP COLUMN prioridad;
