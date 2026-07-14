-- 047_servicios_tecnico_asignado_en.sql
-- Hora en que se le asignó el técnico al servicio.
--
-- No se guardaba en ninguna parte: `servicios.tecnico_id` se escribe desde varios
-- sitios (Registro al crear, Kanban al reasignar, conversión de solicitud) y ninguno
-- dejaba marca de CUÁNDO. Por eso el sello va por TRIGGER y no en el frontend: así
-- queda registrado sin importar por qué camino se asigne, hoy y en el futuro.
--
-- Si se REASIGNA el técnico, el sello se actualiza: la hora corresponde siempre al
-- técnico que figura hoy en el servicio (que es lo que se quiere medir).
--
-- Completa la línea de tiempo de la recogida junto con:
--   recogidas.hora_programada     → estimada que promete el técnico al iniciar ruta
--   recogidas.hora_llegada        → llegada real al sitio (migración 045)
--   recogidas.hora_realizada      → cierre de la recogida
--   cuarto_frio.fecha_ingreso_real→ ingreso a la nevera (migración 046)
--   novedades_servicio            → 'Estado: INGRESADO → EN_RECOGIDA' = salió a ruta

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS tecnico_asignado_en timestamptz;

COMMENT ON COLUMN public.servicios.tecnico_asignado_en IS
  'Cuándo se asignó el técnico actual (lo sella un trigger; se actualiza si se reasigna).';

CREATE OR REPLACE FUNCTION public.fn_stamp_tecnico_asignado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo al asignar o cambiar de técnico. Quitar el técnico (NULL) no borra el sello
  -- anterior: el historial de novedades ya cuenta esa parte.
  IF NEW.tecnico_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.tecnico_id IS DISTINCT FROM OLD.tecnico_id) THEN
    NEW.tecnico_asignado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_tecnico_asignado ON public.servicios;
CREATE TRIGGER trg_stamp_tecnico_asignado
  BEFORE INSERT OR UPDATE OF tecnico_id ON public.servicios
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_stamp_tecnico_asignado();

-- Backfill: NO se hace. Los servicios existentes no tienen forma de saber cuándo se
-- asignó el técnico (no quedó rastro), y ponerles created_at sería inventar un dato:
-- la mayoría se asignó al registrar, pero los reasignados no. Quedan en NULL → "—".

-- Verificación:
--   select id, tecnico_id, tecnico_asignado_en from servicios
--    where tecnico_asignado_en is not null order by tecnico_asignado_en desc limit 5;
