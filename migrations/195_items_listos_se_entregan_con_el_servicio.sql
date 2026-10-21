-- ============================================================================
-- 195 — Al entregar el servicio, sus recordatorios LISTOS pasan a ENTREGADO
-- ----------------------------------------------------------------------------
-- Reporte de Producción y Diseño (15-oct-2026): la entrega queda «Entregada»
-- y en el Tablero los ítems físicos siguen en LISTO (Afiche, Lámpara, Cojín,
-- Portarretrato…), aunque ya están en manos de la familia. Había que pasarlos a
-- mano, uno por uno.
--
-- Los tres caminos de la entrega terminan en `servicios.estado = 'ENTREGADO'`:
-- el mensajero al cerrar su entrega (TecnicoApp.completarEntrega), coordinación
-- en el Tablero (Kanban.cambiarEstado) y el cierre automático sin ruta
-- (148/160/169). El trigger va ahí, igual que el de la 173.
--
-- Qué toca, y solo eso:
--   · ítems en LISTO de ESE servicio. PENDIENTE, EN_PROCESO, NA y ENTREGADO no
--     se mueven: lo que no estaba terminado no se da por entregado.
--   · que no sean REMOVIDO (quitados del servicio).
--   · que no sean DIGITALES (`recordatorios.categoria = 'digital'`). A un
--     digital lo entrega el ENVÍO de sus enlaces (digitales.js lo marca
--     ENTREGADO al enviar): uno en LISTO es uno que la familia aún NO recibió,
--     y la entrega física no lo cambia. Marcarlo escondería el envío pendiente.
--
-- Si el servicio sale de ENTREGADO (se reabre) los ítems no se devuelven: no
-- hay forma de distinguir los que pasó el trigger de los que se marcaron a mano.
--
-- Sin choque con el cierre sin ruta: su trigger sobre servicio_recordatorios se
-- dispara con este UPDATE, pero `fn_cerrar_servicio_sin_ruta` sale de una vez
-- porque el servicio ya está ENTREGADO. No mueve dinero ni inventario.
--
-- Relleno de los servicios ya ENTREGADO: ahí sí pasan TODOS los LISTO, también
-- los digitales (David 21-oct: lo entregado se da por entregado; no se audita
-- ítem por ítem). Medido antes de aplicar: 418 físicos + 91 digitales + 6
-- ceremonia = 515.
--   cat migrations/195_items_listos_se_entregan_con_el_servicio.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_items_siguen_servicio_entregado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.servicio_recordatorios sr
     SET estado = 'ENTREGADO'
    FROM public.recordatorios r
   WHERE r.id = sr.recordatorio_id
     AND sr.servicio_id = NEW.id
     AND sr.estado = 'LISTO'
     AND COALESCE(sr.origen, '') <> 'REMOVIDO'
     AND r.categoria IS DISTINCT FROM 'digital';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_items_siguen_servicio_entregado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_items_siguen_servicio_entregado ON public.servicios;
CREATE TRIGGER trg_items_siguen_servicio_entregado
  AFTER UPDATE OF estado ON public.servicios
  FOR EACH ROW
  WHEN (NEW.estado = 'ENTREGADO' AND OLD.estado IS DISTINCT FROM 'ENTREGADO')
  EXECUTE FUNCTION public.fn_items_siguen_servicio_entregado();

-- Relleno: todo lo LISTO de los servicios ya entregados (también digitales).
UPDATE public.servicio_recordatorios sr
   SET estado = 'ENTREGADO'
  FROM public.servicios s
 WHERE s.id = sr.servicio_id
   AND s.estado = 'ENTREGADO'
   AND sr.estado = 'LISTO'
   AND COALESCE(sr.origen, '') <> 'REMOVIDO';

COMMIT;

-- Verificación (debe dar 0):
--   SELECT count(*) FROM servicio_recordatorios sr
--     JOIN servicios s ON s.id = sr.servicio_id
--    WHERE s.estado = 'ENTREGADO' AND sr.estado = 'LISTO'
--      AND COALESCE(sr.origen,'') <> 'REMOVIDO';
