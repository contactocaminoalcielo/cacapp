-- La confirmación explícita de entrega en el recibo cierra solo estos básicos.
-- Funciona tanto con guardar_recibo_tecnico como con el guardado legacy.
-- No modifica recibos históricos ni crea ítems ausentes del servicio.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_recibo_entrega_basicos()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM 'GUARDADO'
     OR NEW.datos_form->'entrega_rec_basicos' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Editar un comprobante u otro dato no vuelve a disparar la entrega.
    IF OLD.estado = 'GUARDADO' AND OLD.datos_form->'entrega_rec_basicos' = 'true'::jsonb THEN RETURN NEW; END IF;
  END IF;

  UPDATE public.servicio_recordatorios sr
  SET estado = 'ENTREGADO'
  FROM public.recordatorios r, public.servicios s
  WHERE sr.servicio_id = NEW.servicio_id
    AND s.id = sr.servicio_id AND s.estado <> 'CANCELADO'
    AND r.id = sr.recordatorio_id
    AND sr.estado IN ('PENDIENTE', 'EN_PROCESO', 'LISTO')
    AND sr.origen IN ('PLAN', 'VIP')
    AND lower(translate(btrim(r.nombre), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) IN (
      'huella y mechon', 'capsula de recuerdos', 'evidencias de conservacion',
      'soporte lazos de amor', 'huella corazon'
    );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recibo_entrega_basicos() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_recibo_entrega_basicos ON public.recibos_tecnico;
CREATE TRIGGER trg_recibo_entrega_basicos
AFTER INSERT OR UPDATE OF datos_form, estado ON public.recibos_tecnico
FOR EACH ROW EXECUTE FUNCTION public.fn_recibo_entrega_basicos();

COMMIT;
