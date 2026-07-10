-- ============================================================================
-- 042 — Backfill: servicios represados EN_CUARTO_FRIO con lote grupal COMPLETADO
-- Fecha: 2026-07-10
--
-- Causa raíz: el flujo "Control grupal" del orbit-backend
-- (agregarServicioAReporteGrupal) vincula servicios a lotes que YA están
-- COMPLETADOS (o crea el lote directamente como COMPLETADO) escribiendo solo
-- lote_id — nunca avanzaba servicios.estado ni cerraba cuarto_frio. Como el
-- botón "Completar lote" no vuelve a correr para un lote ya completado, esos
-- servicios quedaban EN_CUARTO_FRIO para siempre (124 al 2026-07-10; 121 con
-- certificado ya ENVIADO al cliente).
--
-- El backend quedó corregido el 2026-07-10 (avanza estado + cierra custodia
-- al vincular). Esta migración corrige el represamiento histórico:
--   A. servicios.estado → EN_PRODUCCION (mismo efecto del botón Completar lote)
--   B. cuarto_frio: cierre de custodia con fecha_salida = fecha_completado del
--      lote (12:00 Bogotá — aproximación a la salida real) + movimiento de
--      auditoría con nota de backfill.
-- ============================================================================

BEGIN;

-- Pre-check (esperado 2026-07-10: 124)
SELECT COUNT(*) AS servicios_a_corregir
FROM public.servicios s
JOIN public.lotes_grupales lg ON lg.id = s.lote_id AND lg.estado = 'COMPLETADO'
WHERE s.estado = 'EN_CUARTO_FRIO';

-- A. Avanzar estado del servicio
UPDATE public.servicios s
SET estado = 'EN_PRODUCCION'
FROM public.lotes_grupales lg
WHERE lg.id = s.lote_id
  AND lg.estado = 'COMPLETADO'
  AND s.estado = 'EN_CUARTO_FRIO';

-- B. Cierre de custodia para TODA custodia abierta cuyo lote esté COMPLETADO
-- (dry-run 2026-07-10: 309 = los 124 + 62 ya EN_PRODUCCION + 123 en
-- LISTO/EN_ENTREGA/ENTREGADO — el cuerpo salió en el proceso grupal, la fila
-- del cuarto frío quedó abierta por el mismo hueco).

-- B1. Auditoría de la salida (antes del update para capturar estado_anterior)
INSERT INTO public.cuarto_frio_movimientos
  (cuarto_frio_id, personal_id, tipo, nevera_anterior, nevera_nueva,
   estado_anterior, estado_nuevo, notas)
SELECT cf.id, NULL, 'SALIDA_TENJO', cf.nevera_codigo, NULL,
       cf.estado, 'TRASLADADO',
       'Backfill 042 (2026-07-10): lote ' || lg.numero_lote ||
       ' COMPLETADO el ' || lg.fecha_completado ||
       ' vía Control grupal sin registrar la salida'
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
JOIN public.lotes_grupales lg ON lg.id = s.lote_id AND lg.estado = 'COMPLETADO'
WHERE cf.fecha_salida IS NULL;

-- B2. Cierre de custodia: salida = fecha_completado del lote a mediodía Bogotá
UPDATE public.cuarto_frio cf
SET estado = 'TRASLADADO',
    fecha_salida = (COALESCE(lg.fecha_completado,
                             (now() AT TIME ZONE 'America/Bogota')::date)::timestamp
                    + time '12:00') AT TIME ZONE 'America/Bogota'
FROM public.servicios s
JOIN public.lotes_grupales lg ON lg.id = s.lote_id AND lg.estado = 'COMPLETADO'
WHERE s.id = cf.servicio_id
  AND cf.fecha_salida IS NULL;

-- Post-check: ambos deben dar 0
SELECT COUNT(*) AS aun_represados
FROM public.servicios s
JOIN public.lotes_grupales lg ON lg.id = s.lote_id AND lg.estado = 'COMPLETADO'
WHERE s.estado = 'EN_CUARTO_FRIO';

SELECT COUNT(*) AS custodia_abierta_con_lote_completado
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
JOIN public.lotes_grupales lg ON lg.id = s.lote_id AND lg.estado = 'COMPLETADO'
WHERE cf.fecha_salida IS NULL;

COMMIT;
