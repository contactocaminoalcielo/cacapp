-- 215 · Cantidad de los recordatorios adicionales agregados desde el Kanban
--
-- REPORTE ORBIT 23-nov-2026 (Producción / Diseño): a Violeta le vendieron 5 llaveros y el
-- tablero de Producción y el certificado de entrega decían solo «Llavero». El modal
-- «Agregar adicional» del Kanban cobraba precio × cantidad pero NO guardaba `cantidad`
-- (quedaba en 1). El código ya lo guarda; esto corrige lo que quedó atrás.
--
-- Solo toca ADICIONAL con cantidad 1 cuyo precio cobrado es un múltiplo EXACTO (≥2) del
-- precio del catálogo: esas filas son, sin ambigüedad, N unidades. No cambia ningún valor
-- en dinero (nada multiplica `precio_cobrado` por `cantidad`: precio_cobrado ya es el total).
-- Lo que no es múltiplo exacto (p. ej. Princesa: $20.000 con llavero a $7.000) se deja.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _corregir ON COMMIT DROP AS
SELECT sr.id, (sr.precio_cobrado / r.precio_base)::int AS unidades
  FROM public.servicio_recordatorios sr
  JOIN public.recordatorios r ON r.id = sr.recordatorio_id
 WHERE sr.origen = 'ADICIONAL'
   AND COALESCE(sr.cantidad, 1) = 1
   AND r.precio_base > 0
   AND sr.precio_cobrado >= 2 * r.precio_base
   AND sr.precio_cobrado % r.precio_base = 0
   AND sr.precio_cobrado / r.precio_base <= 50;

-- Qué se va a cambiar (queda en la salida de psql como traza).
SELECT c.id, m.nombre AS mascota, r.nombre AS item, c.unidades, sr.estado, s.estado AS estado_servicio
  FROM _corregir c
  JOIN public.servicio_recordatorios sr ON sr.id = c.id
  JOIN public.recordatorios r ON r.id = sr.recordatorio_id
  JOIN public.servicios s ON s.id = sr.servicio_id
  JOIN public.mascotas m ON m.id_mascota = s.mascota_id
 ORDER BY sr.created_at DESC;

UPDATE public.servicio_recordatorios sr
   SET cantidad = c.unidades
  FROM _corregir c
 WHERE sr.id = c.id;

COMMIT;

-- Verificación: debe dar 0
-- SELECT count(*) FROM servicio_recordatorios sr JOIN recordatorios r ON r.id = sr.recordatorio_id
--  WHERE sr.origen='ADICIONAL' AND COALESCE(sr.cantidad,1)=1 AND r.precio_base>0
--    AND sr.precio_cobrado >= 2*r.precio_base AND sr.precio_cobrado % r.precio_base = 0;
--
-- Reversa (por id, con la lista que imprimió el SELECT de arriba):
-- UPDATE servicio_recordatorios SET cantidad = 1 WHERE id IN (...);
