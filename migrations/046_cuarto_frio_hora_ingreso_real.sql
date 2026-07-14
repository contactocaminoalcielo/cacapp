-- 046_cuarto_frio_hora_ingreso_real.sql
-- Hora REAL de ingreso de la mascota al cuarto frío + quién la ingresó.
--
-- Problema: `cuarto_frio.fecha_ingreso` NO es la hora de ingreso a la nevera.
-- Es `now()` por DEFAULT, y la fila la crea un trigger al REGISTRAR EL SERVICIO
-- (verificado en prod: fecha_ingreso == created_at en las 498 filas). Es decir,
-- marca cuando coordinación creó el servicio — horas antes de que el técnico
-- recoja la mascota y la meta a la nevera.
-- Además `registrado_por` existía pero nadie lo escribía (498/498 en NULL) y no
-- había movimiento de INGRESO en la bitácora (solo SALIDA_*, CAMBIO_*).
--
-- Ojo: NO se cambia el significado de `fecha_ingreso` porque la vista
-- `v_candidatos_tenjo` calcula `dias_custodia` con ella. Se agrega columna nueva.
--
-- El marcador de "ya ingresó" es tener `nevera_codigo` (el estado NO sirve: el
-- trigger crea la fila directamente como REFRIGERADO; no hay ni una fila
-- PENDIENTE_INGRESO en toda la tabla).

ALTER TABLE public.cuarto_frio
  ADD COLUMN IF NOT EXISTS fecha_ingreso_real timestamptz;

COMMENT ON COLUMN public.cuarto_frio.fecha_ingreso_real IS
  'Hora REAL en que la mascota entró a la nevera (la sella el técnico al registrar nevera/peso). Distinta de fecha_ingreso, que es cuando se creó el servicio.';
COMMENT ON COLUMN public.cuarto_frio.fecha_ingreso IS
  'Creación de la fila (= registro del servicio). NO es la hora de ingreso físico a la nevera: para eso está fecha_ingreso_real. La usa v_candidatos_tenjo para dias_custodia.';
COMMENT ON COLUMN public.cuarto_frio.registrado_por IS
  'Quién ingresó la mascota a la nevera (se escribe junto con fecha_ingreso_real).';

-- Bitácora: el movimiento 'INGRESO' se registra en cuarto_frio_movimientos
-- (tipo es text sin CHECK, no hace falta migrar nada para el tipo nuevo).
--
-- Backfill: imposible. Las 471 filas con nevera ya puesta no tienen forma de
-- saber a qué hora entraron — quedan en NULL y la UI las muestra como "—".
--
-- Verificación:
--   select nevera_codigo, fecha_ingreso, fecha_ingreso_real, registrado_por
--     from cuarto_frio where fecha_ingreso_real is not null order by fecha_ingreso_real desc limit 10;
