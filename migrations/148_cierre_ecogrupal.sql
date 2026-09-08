-- Cierre sin ruta física SOLO para ECO_GRUPAL, con evidencia de ambos envíos
-- y todos sus ítems aplicables entregados (incluidos adicionales).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_cerrar_ecogrupal(p_servicio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Serializa envíos simultáneos de certificado y digitales. El estado final
  -- del segundo envío debe ver lo que confirmó el primero.
  PERFORM s.id FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
    WHERE s.id=p_servicio_id AND p.codigo='ECO_GRUPAL'
      AND s.estado NOT IN ('ENTREGADO','CANCELADO') FOR UPDATE OF s;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.digitales_envios
                 WHERE servicio_id=p_servicio_id AND estado='ENVIADO')
     OR NOT EXISTS (SELECT 1 FROM public.reportes_grupales_envios
                    WHERE servicio_id=p_servicio_id AND estado='ENVIADO') THEN RETURN; END IF;

  -- No interpretar ausencia de ítems como un servicio completo.
  IF NOT EXISTS (SELECT 1 FROM public.servicio_recordatorios
                 WHERE servicio_id=p_servicio_id AND COALESCE(origen,'')<>'REMOVIDO' AND estado<>'NA')
     OR EXISTS (SELECT 1 FROM public.servicio_recordatorios
                 WHERE servicio_id=p_servicio_id AND COALESCE(origen,'')<>'REMOVIDO'
                   AND estado IS DISTINCT FROM 'NA' AND estado IS DISTINCT FROM 'ENTREGADO') THEN RETURN; END IF;

  -- Una ruta física ya asignada requiere cierre por quien la realiza.
  PERFORM servicio_id FROM public.entregas WHERE servicio_id=p_servicio_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.entregas WHERE servicio_id=p_servicio_id
    AND estado<>'ENTREGADA' AND (mensajero_id IS NOT NULL OR estado NOT IN ('PENDIENTE','DISPONIBLE'))) THEN RETURN; END IF;

  UPDATE public.entregas SET estado='ENTREGADA',
    notas=concat_ws(E'\n',NULLIF(notas,''),'Cierre automático ECO_GRUPAL: certificado y digitales enviados, todos los ítems entregados; sin ruta física.')
    WHERE servicio_id=p_servicio_id AND mensajero_id IS NULL
      AND estado IN ('PENDIENTE','DISPONIBLE');

  UPDATE public.servicios SET estado='ENTREGADO',
    fecha_entrega_real=COALESCE(fecha_entrega_real,(now() AT TIME ZONE 'America/Bogota')::date)
    WHERE id=p_servicio_id AND estado NOT IN ('ENTREGADO','CANCELADO');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cerrar_ecogrupal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_evento_cierre_ecogrupal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM public.fn_cerrar_ecogrupal(OLD.servicio_id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_cerrar_ecogrupal(NEW.servicio_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_evento_cierre_ecogrupal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ecogrupal_digitales ON public.digitales_envios;
CREATE TRIGGER trg_ecogrupal_digitales AFTER INSERT OR UPDATE OF estado
ON public.digitales_envios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_ecogrupal();
DROP TRIGGER IF EXISTS trg_ecogrupal_certificado ON public.reportes_grupales_envios;
CREATE TRIGGER trg_ecogrupal_certificado AFTER INSERT OR UPDATE OF estado
ON public.reportes_grupales_envios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_ecogrupal();
DROP TRIGGER IF EXISTS trg_ecogrupal_items ON public.servicio_recordatorios;
CREATE TRIGGER trg_ecogrupal_items AFTER INSERT OR DELETE OR UPDATE OF estado, origen
ON public.servicio_recordatorios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_ecogrupal();
COMMIT;
