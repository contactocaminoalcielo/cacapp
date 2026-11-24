-- 216 · La carta de preparación de entrega no lleva las instrucciones de la recogida
--
-- REPORTE ORBIT 23-nov-2026 (Producción y Diseño / Preparación de entrega): en la carta
-- aparecían instrucciones registradas al TOMAR el servicio ("Hora aprox. recogida: 14:49",
-- "Recoger en hospital veterinario Praga", "llámenme antes de venir"...).
--
-- Causa: el modal «Preparar entrega» llenaba `entregas.indicaciones` con
-- `servicios.indicaciones_recogida` en las entregas a DOMICILIO, y eso se guardaba y se
-- imprimía como «Instrucciones». El código ya no lo hace; esto limpia las entregas que
-- siguen ABIERTAS y quedaron con esa copia exacta. Las ENTREGADAS no se tocan (su carta ya
-- se firmó). Visto el 23-nov: 35 abiertas, todas DISPONIBLE, y las 35 eran copia exacta.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _limpiar ON COMMIT DROP AS
SELECT e.id, e.estado, left(e.indicaciones, 80) AS indicaciones
  FROM public.entregas e
  JOIN public.servicios s ON s.id = e.servicio_id
 WHERE e.estado <> 'ENTREGADA'
   AND e.indicaciones IS NOT NULL
   AND btrim(e.indicaciones) = btrim(s.indicaciones_recogida);

-- Traza (y respaldo para la reversa): id + texto que se borra.
SELECT * FROM _limpiar ORDER BY estado, id;

UPDATE public.entregas e
   SET indicaciones = NULL
  FROM _limpiar l
 WHERE e.id = l.id;

COMMIT;

-- Verificación: debe dar 0
-- SELECT count(*) FROM entregas e JOIN servicios s ON s.id = e.servicio_id
--  WHERE e.estado <> 'ENTREGADA' AND btrim(e.indicaciones) = btrim(s.indicaciones_recogida);
--
-- Reversa: volver a copiar la de la recogida en los ids que imprimió el SELECT:
-- UPDATE entregas e SET indicaciones = s.indicaciones_recogida FROM servicios s
--  WHERE s.id = e.servicio_id AND e.id IN (...);
