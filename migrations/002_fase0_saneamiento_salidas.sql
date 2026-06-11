-- ============================================================================
-- 002 — Fase 0 Tenjo: saneamiento de salidas no registradas en cuarto_frio
-- Fecha: 2026-06-11
--
-- Problema detectado (verificado en producción el 2026-06-11):
--   6 registros de cuarto_frio en estado REFRIGERADO con fecha_salida NULL
--   cuyo servicio ya avanzó (3 EN_PRODUCCION, 2 EN_PROCESO, 1 LISTO).
--   La mascota ya NO está físicamente en el cuarto frío, pero sigue contando
--   como ocupación y podría reaparecer como candidata a traslado.
--
-- EJECUTAR POR PASOS. El PASO 1 es solo lectura: revisar su salida antes
-- de continuar con los pasos 2 y 3.
-- ============================================================================

-- ─── PASO 1 — VISTA PREVIA (solo lectura, revisar antes de continuar) ──────
SELECT cf.id, cf.servicio_id, cf.estado AS estado_cf, s.estado AS estado_servicio,
       cf.nevera_codigo, cf.fecha_ingreso,
       (SELECT MAX(t.fecha_completado) FROM public.traslados_tenjo t
         WHERE t.servicio_id = cf.servicio_id AND t.estado = 'COMPLETADO') AS traslado_completado,
       (SELECT lg.fecha_envio FROM public.servicios s2
         JOIN public.lotes_grupales lg ON lg.id = s2.lote_id
         WHERE s2.id = cf.servicio_id) AS lote_enviado
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
  AND s.estado IN ('EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO');

-- ─── PASO 2 — BACKUP de las filas afectadas ────────────────────────────────
-- (tabla solo para respaldo; no la usa la app, no necesita GRANTs ni RLS)
CREATE TABLE IF NOT EXISTS public._backup_fase0_cuarto_frio AS
SELECT cf.*
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
  AND s.estado IN ('EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO');

-- ─── PASO 3 — AUDITORÍA + CORRECCIÓN (transacción única) ──────────────────
BEGIN;

-- 3a. Dejar rastro en cuarto_frio_movimientos de cada corrección
INSERT INTO public.cuarto_frio_movimientos
  (cuarto_frio_id, personal_id, tipo, nevera_anterior, nevera_nueva, estado_anterior, estado_nuevo, notas)
SELECT cf.id, NULL, 'CAMBIO_ESTADO', cf.nevera_codigo, cf.nevera_codigo, cf.estado, 'TRASLADADO',
       'Saneamiento Fase 0 Tenjo (2026-06-11): salida fisica no registrada en su momento; el servicio ya estaba en ' || s.estado
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
  AND s.estado IN ('EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO');

-- 3b. Marcar salida: fecha real del traslado/lote si existe; si no, now()
UPDATE public.cuarto_frio cf
SET estado = 'TRASLADADO',
    fecha_salida = COALESCE(
      (SELECT MAX(t.fecha_completado)::timestamptz FROM public.traslados_tenjo t
        WHERE t.servicio_id = cf.servicio_id AND t.estado = 'COMPLETADO'),
      (SELECT lg.fecha_envio::timestamptz FROM public.servicios s2
        JOIN public.lotes_grupales lg ON lg.id = s2.lote_id
        WHERE s2.id = cf.servicio_id),
      now()
    )
FROM public.servicios s
WHERE s.id = cf.servicio_id
  AND cf.fecha_salida IS NULL
  AND s.estado IN ('EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO');

COMMIT;

-- ─── PASO 4 — VERIFICACIÓN (debe devolver 0 filas) ─────────────────────────
SELECT count(*) AS inconsistencias_restantes
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
  AND s.estado IN ('EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO');

-- ============================================================================
-- ROLLBACK (restaura desde el backup del PASO 2):
--   UPDATE public.cuarto_frio cf SET estado = b.estado, fecha_salida = b.fecha_salida
--   FROM public._backup_fase0_cuarto_frio b WHERE b.id = cf.id;
--   DELETE FROM public.cuarto_frio_movimientos WHERE notas LIKE 'Saneamiento Fase 0 Tenjo%';
-- Limpieza del backup cuando todo esté validado (opcional, semanas después):
--   DROP TABLE IF EXISTS public._backup_fase0_cuarto_frio;
-- ============================================================================

-- NOTA APARTE (no se toca en este saneamiento — revisar con David):
-- Existen 11 registros REFRIGERADO cuyo servicio sigue en INGRESADO (7) o
-- EN_RECOGIDA (4). Es una anomalía distinta: refrigerados antes de completar
-- la recogida. Posibles causas: flujo del tecnico fuera de orden o datos de
-- prueba. Pendiente de revision manual, no afecta la salida fisica.
