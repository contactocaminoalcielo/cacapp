-- 173 — La entrega se cierra cuando el servicio queda ENTREGADO por otra vía.
--
-- 🩸 Medido el 24-sep: 152 servicios ENTREGADO seguían con su entrega en
-- DISPONIBLE (más 1 ASIGNADA y 2 EN_CAMINO). Coordinación marca ENTREGADO en
-- el Tablero, o el cliente recoge, y la fila de `entregas` nunca se enteraba.
-- El pool del mensajero trae las 100 más antiguas: de 94 entregas REALES
-- esperando, solo le salían 25. Las recién preparadas nunca le aparecían.
--
-- Qué hace:
--  1. Trigger: cuando un servicio pasa a ENTREGADO, su entrega DISPONIBLE o
--     ASIGNADA pasa a ENTREGADA con una nota. NO toca EN_CAMINO: esa la tiene
--     un mensajero en la calle y la cierra él, con el cobro en la puerta
--     (mismo principio que fn_cerrar_servicio_sin_ruta, migr. 148/160). Y la
--     app del técnico actualiza el servicio ANTES que la entrega, así que en
--     su flujo normal la entrega ya está EN_CAMINO y el trigger no la toca.
--  2. Backfill de las existentes, incluidas las 2 EN_CAMINO de hace dos
--     semanas (MIA y KIARA, las dos con el servicio pagado por completo).
--
-- No mueve dinero: el cuadre solo lee entregas con `cobro_monto`, y aquí no
-- se escribe ningún cobro. El saldo del servicio, si lo hay, sigue en cartera.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_entrega_sigue_servicio_entregado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.entregas
     SET estado = 'ENTREGADA',
         fecha_realizada = COALESCE(fecha_realizada, NEW.fecha_entrega_real,
                                    (now() AT TIME ZONE 'America/Bogota')::date),
         notas = concat_ws(E'\n', NULLIF(notas, ''),
                   'Cerrada sola: el servicio se marcó ENTREGADO por fuera de la app de entregas.')
   WHERE servicio_id = NEW.id
     AND estado IN ('DISPONIBLE', 'ASIGNADA');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entrega_sigue_servicio_entregado ON public.servicios;
CREATE TRIGGER trg_entrega_sigue_servicio_entregado
  AFTER UPDATE OF estado ON public.servicios
  FOR EACH ROW
  WHEN (NEW.estado = 'ENTREGADO' AND OLD.estado IS DISTINCT FROM 'ENTREGADO')
  EXECUTE FUNCTION public.fn_entrega_sigue_servicio_entregado();

UPDATE public.entregas e
   SET estado = 'ENTREGADA',
       fecha_realizada = COALESCE(e.fecha_realizada, s.fecha_entrega_real, s.updated_at::date),
       notas = concat_ws(E'\n', NULLIF(e.notas, ''),
                 'Cerrada en la migración 173: el servicio ya estaba ENTREGADO y la entrega seguía abierta.')
  FROM public.servicios s
 WHERE s.id = e.servicio_id
   AND s.estado = 'ENTREGADO'
   AND e.estado IN ('DISPONIBLE', 'ASIGNADA', 'EN_CAMINO');

COMMIT;

-- Verificación (debe dar 0):
--   SELECT count(*) FROM entregas e JOIN servicios s ON s.id = e.servicio_id
--    WHERE s.estado = 'ENTREGADO' AND e.estado IN ('DISPONIBLE','ASIGNADA','EN_CAMINO');
