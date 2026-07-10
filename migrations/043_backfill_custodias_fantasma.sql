-- ============================================================================
-- 043 — Backfill: custodias de cuarto frío abiertas cuya mascota ya salió
-- Fecha: 2026-07-10 (continúa la 042)
--
-- Tras cerrar las custodias de lotes COMPLETADOS (042), quedaron 110 abiertas.
-- Cruce con el estado del servicio (2026-07-10): 62 coherentes, 48 sospechosas:
--   A. 14 con servicio LISTO / EN_ENTREGA / ENTREGADO / CANCELADO → el estado
--      mismo es la evidencia de que el cuerpo no está (cenizas entregadas o
--      servicio cancelado). Se cierran todas.
--   B. 34 con servicio EN_PROCESO / EN_PRODUCCION → se cierran SOLO las que
--      tienen evidencia física de salida: traslado a Tenjo (EN_CAMINO o
--      COMPLETADO), ítem de jornada Tenjo ya en proceso, o lote grupal ENVIADO.
--      OJO: EN_PRODUCCION sin evidencia NO se toca — la producción de
--      recordatorios puede arrancar con la mascota aún en el cuarto frío.
--
-- Causa raíz (corregida en frontend el 2026-07-10): "confirmar cenizas" y el
-- inicio de proceso en jornada Tenjo no cerraban la custodia cuando el paso de
-- traslado se saltó. fecha_salida = mejor evidencia disponible (12:00 Bogotá),
-- nunca anterior al ingreso.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _cf_cerrar ON COMMIT DROP AS
SELECT cf.id AS cf_id,
       cf.estado AS estado_cf,
       cf.nevera_codigo,
       s.estado AS estado_svc,
       GREATEST(cf.fecha_ingreso, COALESCE(
         (tt.fecha_completado::timestamp + time '12:00') AT TIME ZONE 'America/Bogota',
         (lg.fecha_envio::timestamp      + time '12:00') AT TIME ZONE 'America/Bogota',
         (lg.fecha_completado::timestamp + time '12:00') AT TIME ZONE 'America/Bogota',
         s.fecha_listo,
         s.cancelado_en,
         now()
       )) AS fecha_salida_est,
       CASE WHEN tt.id IS NOT NULL THEN 'traslado Tenjo'
            WHEN lti.id IS NOT NULL THEN 'jornada Tenjo'
            WHEN lg.estado = 'ENVIADO' THEN 'lote ' || lg.numero_lote || ' ENVIADO'
            ELSE 'servicio ' || s.estado END AS evidencia
FROM public.cuarto_frio cf
JOIN public.servicios s ON s.id = cf.servicio_id
LEFT JOIN public.lotes_grupales lg ON lg.id = s.lote_id
LEFT JOIN LATERAL (
  SELECT id, fecha_completado FROM public.traslados_tenjo t
  WHERE t.servicio_id = s.id AND t.estado IN ('EN_CAMINO','COMPLETADO')
  ORDER BY t.fecha_completado NULLS LAST LIMIT 1
) tt ON true
LEFT JOIN LATERAL (
  SELECT id FROM public.lotes_tenjo_items l
  WHERE l.servicio_id = s.id
    AND l.estado NOT IN ('PROPUESTO','APROBADO','RETIRADO_DEL_LOTE')
  LIMIT 1
) lti ON true
WHERE cf.fecha_salida IS NULL
  AND (
    s.estado IN ('LISTO','EN_ENTREGA','ENTREGADO','CANCELADO')
    OR (s.estado IN ('EN_PROCESO','EN_PRODUCCION')
        AND (tt.id IS NOT NULL OR lti.id IS NOT NULL OR lg.estado = 'ENVIADO'))
  );

-- Pre-check: qué se va a cerrar y por qué
SELECT estado_svc, evidencia, COUNT(*) FROM _cf_cerrar GROUP BY 1, 2 ORDER BY 3 DESC;

-- Auditoría de la salida
INSERT INTO public.cuarto_frio_movimientos
  (cuarto_frio_id, personal_id, tipo, nevera_anterior, nevera_nueva,
   estado_anterior, estado_nuevo, notas)
SELECT cf_id, NULL, 'SALIDA_TENJO', nevera_codigo, NULL, estado_cf, 'TRASLADADO',
       'Backfill 043 (2026-07-10): custodia fantasma — evidencia: ' || evidencia
FROM _cf_cerrar;

-- Cierre de custodia
UPDATE public.cuarto_frio cf
SET estado = 'TRASLADADO', fecha_salida = c.fecha_salida_est
FROM _cf_cerrar c
WHERE cf.id = c.cf_id;

-- Post-check 1: no debe quedar custodia abierta con servicio terminal
SELECT COUNT(*) AS custodias_abiertas_estado_terminal
FROM public.cuarto_frio cf JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
  AND s.estado IN ('LISTO','EN_ENTREGA','ENTREGADO','CANCELADO');

-- Post-check 2: custodias abiertas restantes (esperado ≈ 62 coherentes
-- + EN_PROCESO/EN_PRODUCCION sin evidencia, que se revisan a mano)
SELECT s.estado, COUNT(*)
FROM public.cuarto_frio cf JOIN public.servicios s ON s.id = cf.servicio_id
WHERE cf.fecha_salida IS NULL
GROUP BY 1 ORDER BY 2 DESC;

COMMIT;
