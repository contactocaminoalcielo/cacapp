-- Extiende el cierre automático de la migración 148 a los planes que solo
-- entregan el comprobante: DESAMPARADO, ANGEL y BASICO_SIN_REC. Misma regla que
-- el ECO_GRUPAL — envío registrado del reporte/certificado y todos los ítems
-- aplicables entregados — salvo la pieza digital, que solo el ECO_GRUPAL exige:
-- esos tres planes no llevan memorial (ANGEL y DESAMPARADO están en
-- planes_excluidos de DIGITALES; BASICO_SIN_REC no incluye pieza digital).
-- La función y los triggers cambian de nombre porque ya no son solo del grupal.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_cerrar_servicio_sin_ruta(p_servicio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_codigo text;
BEGIN
  -- Serializa envíos simultáneos de certificado y digitales. El estado final
  -- del segundo envío debe ver lo que confirmó el primero.
  SELECT p.codigo INTO v_codigo
    FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
    WHERE s.id=p_servicio_id
      AND p.codigo IN ('ECO_GRUPAL','DESAMPARADO','ANGEL','BASICO_SIN_REC')
      AND s.estado NOT IN ('ENTREGADO','CANCELADO') FOR UPDATE OF s;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_codigo='ECO_GRUPAL' AND NOT EXISTS (SELECT 1 FROM public.digitales_envios
       WHERE servicio_id=p_servicio_id AND estado='ENVIADO') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reportes_grupales_envios
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
    notas=concat_ws(E'\n',NULLIF(notas,''),'Cierre automático '||v_codigo||': comprobante enviado y todos los ítems entregados; sin ruta física.')
    WHERE servicio_id=p_servicio_id AND mensajero_id IS NULL
      AND estado IN ('PENDIENTE','DISPONIBLE');

  UPDATE public.servicios SET estado='ENTREGADO',
    fecha_entrega_real=COALESCE(fecha_entrega_real,(now() AT TIME ZONE 'America/Bogota')::date)
    WHERE id=p_servicio_id AND estado NOT IN ('ENTREGADO','CANCELADO');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cerrar_servicio_sin_ruta(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_evento_cierre_sin_ruta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM public.fn_cerrar_servicio_sin_ruta(OLD.servicio_id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_cerrar_servicio_sin_ruta(NEW.servicio_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_evento_cierre_sin_ruta() FROM PUBLIC, anon, authenticated;

-- Los triggers de la 148 se retiran antes de crear los nuevos: la regla queda en
-- un solo sitio y no se ejecuta dos veces por evento.
DROP TRIGGER IF EXISTS trg_ecogrupal_digitales ON public.digitales_envios;
DROP TRIGGER IF EXISTS trg_ecogrupal_certificado ON public.reportes_grupales_envios;
DROP TRIGGER IF EXISTS trg_ecogrupal_items ON public.servicio_recordatorios;
DROP FUNCTION IF EXISTS public.fn_evento_cierre_ecogrupal();
DROP FUNCTION IF EXISTS public.fn_cerrar_ecogrupal(uuid);

DROP TRIGGER IF EXISTS trg_cierre_sin_ruta_digitales ON public.digitales_envios;
CREATE TRIGGER trg_cierre_sin_ruta_digitales AFTER INSERT OR UPDATE OF estado
ON public.digitales_envios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_sin_ruta();
DROP TRIGGER IF EXISTS trg_cierre_sin_ruta_comprobante ON public.reportes_grupales_envios;
CREATE TRIGGER trg_cierre_sin_ruta_comprobante AFTER INSERT OR UPDATE OF estado
ON public.reportes_grupales_envios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_sin_ruta();
DROP TRIGGER IF EXISTS trg_cierre_sin_ruta_items ON public.servicio_recordatorios;
CREATE TRIGGER trg_cierre_sin_ruta_items AFTER INSERT OR DELETE OR UPDATE OF estado, origen
ON public.servicio_recordatorios FOR EACH ROW EXECUTE FUNCTION public.fn_evento_cierre_sin_ruta();

-- Los que ya cumplían la regla antes de existir el trigger: se cierran ahora
-- porque los triggers solo actúan por evento y estos servicios pueden no volver
-- a moverse nunca. La función decide; aquí no se fuerza ningún estado.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT s.id FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
            WHERE p.codigo IN ('DESAMPARADO','ANGEL','BASICO_SIN_REC')
              AND s.estado NOT IN ('ENTREGADO','CANCELADO')
  LOOP
    PERFORM public.fn_cerrar_servicio_sin_ruta(r.id);
  END LOOP;
END $do$;
COMMIT;
