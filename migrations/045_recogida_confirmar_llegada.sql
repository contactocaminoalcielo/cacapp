-- 045_recogida_confirmar_llegada.sql
-- Paso "Confirmar llegada" en el flujo del técnico.
--
-- Problema: hoy solo se registran dos horas — la ESTIMADA que el técnico
-- confirma al iniciar ruta (recogidas.hora_programada) y la de CIERRE de la
-- recogida (recogidas.hora_realizada, que se escribe al completar, después de
-- la foto y el recibo: hasta 30 minutos después de haber llegado). No queda
-- rastro de la hora real de llegada al sitio, así que no se puede medir ni el
-- cumplimiento de la cita ni el tiempo en sitio.
--
-- Solución: el técnico marca "Confirmar llegada" al llegar y se sella la hora
-- exacta. Columnas nuevas y NULLABLE: las recogidas ya en curso (y cualquier
-- flujo que no pase por el paso nuevo) siguen funcionando igual.
--
-- Tiempo en sitio = (fecha_realizada + hora_realizada) - (fecha_llegada + hora_llegada)
--
-- Fechas/horas en hora local de Bogotá (mismo criterio que fecha_realizada /
-- hora_realizada: las escribe el frontend con hoyLocalISO, nunca CURRENT_DATE).

ALTER TABLE public.recogidas
  ADD COLUMN IF NOT EXISTS fecha_llegada           date,
  ADD COLUMN IF NOT EXISTS hora_llegada            time without time zone,
  ADD COLUMN IF NOT EXISTS llegada_registrada_por  uuid REFERENCES public.personal(id);

COMMENT ON COLUMN public.recogidas.fecha_llegada IS
  'Fecha local (Bogotá) en que el técnico confirmó su llegada al sitio.';
COMMENT ON COLUMN public.recogidas.hora_llegada IS
  'Hora real de llegada al sitio, sellada al tocar "Confirmar llegada". No es la estimada (hora_programada) ni la de cierre (hora_realizada).';
COMMENT ON COLUMN public.recogidas.llegada_registrada_por IS
  'Técnico que confirmó la llegada.';

-- GRANTs: recogidas tiene los privilegios a nivel de TABLA
-- (relacl: anon/authenticated/service_role = arwdDxt), no por columna, así que
-- las columnas nuevas quedan cubiertas automáticamente. RLS ya activo con la
-- policy auth_full (ALL, authenticated). No hace falta tocar permisos.

-- Verificación:
--   select id, hora_programada, hora_llegada, hora_realizada
--     from recogidas where hora_llegada is not null order by fecha_llegada desc limit 10;
