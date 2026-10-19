-- ============================================================================
-- 185 — El contador de la fecha límite se DETIENE cuando el servicio se entrega
-- ----------------------------------------------------------------------------
-- Reporte de Producción y Diseño (15-oct-2026): «Negrita» recibió imágenes el
-- 1-oct, límite el 14-oct, todo entregado el 13-oct… y Orbit la mostraba «1d
-- vencido» el 15-oct. El contador seguía corriendo después de entregar.
--
-- Causa, en dos partes:
--   1. `v_kanban.dias_para_vencer` = fn_dias_habiles_hasta(fecha_limite_entrega)
--      cuenta SIEMPRE contra HOY, esté o no entregado el servicio.
--   2. `servicios.fecha_entrega_real` (la fecha en la que debería parar) solo la
--      llenaban los cierres automáticos (148/160/169): estaba vacía en 943 de
--      los 1114 ENTREGADO. Tampoco servía para medir cumplimiento: por eso
--      `v_tiempo_promesa` contaba a casi todos los entregados como VENCIDO.
--
-- Arreglo:
--   · Trigger: al pasar a ENTREGADO se sella `fecha_entrega_real` (si no traía
--     una); si el servicio sale de ENTREGADO, se borra y el reloj vuelve a
--     correr.
--   · Relleno de los 943 con la fecha REAL del cambio a ENTREGADO, tomada de la
--     bitácora `novedades_servicio` (CAMBIO_ESTADO «→ ENTREGADO», la última).
--     Cubre los 943 sin excepción (medido el 19-oct).
--   · v_kanban: un servicio ENTREGADO congela `dias_para_vencer` en los días
--     hábiles entre su entrega y su límite (positivo = entregó antes, 0 = el
--     mismo día límite, negativo = tarde). v_alertas no cambia: ya excluía los
--     ENTREGADO. Se expone además `fecha_entrega_real`.
--
-- Todas las entregas tienen recordatorios ENTREGADO ⇔ servicio ENTREGADO: no
-- hay ningún servicio con todos sus ítems entregados que no esté ENTREGADO
-- (medido el 19-oct: 0), así que parar con el ESTADO del servicio es parar
-- cuando se entrega lo último.
--   cat migrations/185_plazo_se_congela_al_entregar.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Días hábiles entre dos fechas (misma regla que fn_dias_habiles_hasta) ─
-- fn_dias_habiles_hasta(fin) = fn_dias_habiles_entre(hoy, fin). Positivo si
-- `hasta` es posterior a `desde`; no cuenta el día de partida, ni fines de
-- semana ni festivos.
CREATE OR REPLACE FUNCTION public.fn_dias_habiles_entre(desde date, hasta date)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_inicio date := desde;
  v_fin    date := hasta;
  v_signo  integer := 1;
  v_count  integer;
BEGIN
  IF desde IS NULL OR hasta IS NULL THEN RETURN NULL; END IF;
  IF v_fin < v_inicio THEN
    v_signo := -1; v_inicio := hasta; v_fin := desde;
  END IF;
  SELECT COUNT(*)::integer INTO v_count
    FROM generate_series(v_inicio, v_fin, '1 day'::interval) d
   WHERE extract(isodow FROM d::date) < 6
     AND NOT EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = d::date)
     AND d::date <> v_inicio;
  RETURN v_signo * v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_dias_habiles_entre(date, date) TO authenticated, service_role, orbit_backend;

-- ── 2. Sello de la fecha de entrega ──────────────────────────────────────────
-- BEFORE: así el trigger AFTER de la 173 (cierra la fila de `entregas`) ya ve
-- la fecha sellada y la copia en `entregas.fecha_realizada`.
CREATE OR REPLACE FUNCTION public.fn_sellar_fecha_entrega_real()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ENTREGADO' AND OLD.estado IS DISTINCT FROM 'ENTREGADO' THEN
    NEW.fecha_entrega_real := COALESCE(NEW.fecha_entrega_real, (now() AT TIME ZONE 'America/Bogota')::date);
  ELSIF OLD.estado = 'ENTREGADO' AND NEW.estado IS DISTINCT FROM 'ENTREGADO' THEN
    -- Se reabrió: la entrega no ocurrió (todavía) y el plazo vuelve a correr.
    NEW.fecha_entrega_real := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sellar_fecha_entrega_real ON public.servicios;
CREATE TRIGGER trg_sellar_fecha_entrega_real
  BEFORE UPDATE OF estado ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.fn_sellar_fecha_entrega_real();

-- ── 3. Relleno de los ENTREGADO sin fecha ────────────────────────────────────
-- Sin tocar `updated_at`: es un dato histórico, no una edición de hoy. Los
-- demás triggers de UPDATE no hacen nada si no cambia el estado ni el plan.
ALTER TABLE public.servicios DISABLE TRIGGER trg_servicios_updated;

UPDATE public.servicios s
   SET fecha_entrega_real = n.fecha
  FROM (
    SELECT servicio_id, max((created_at AT TIME ZONE 'America/Bogota')::date) AS fecha
      FROM public.novedades_servicio
     WHERE tipo_novedad = 'CAMBIO_ESTADO' AND descripcion LIKE '%→ ENTREGADO'
     GROUP BY servicio_id
  ) n
 WHERE n.servicio_id = s.id
   AND s.estado = 'ENTREGADO'
   AND s.fecha_entrega_real IS NULL;

ALTER TABLE public.servicios ENABLE TRIGGER trg_servicios_updated;

-- ── 4. v_kanban: el plazo se congela al entregar ─────────────────────────────
-- Idéntica a la vigente salvo `dias_para_vencer` y la columna nueva al final
-- (CREATE OR REPLACE VIEW solo deja AGREGAR columnas al final).
CREATE OR REPLACE VIEW public.v_kanban
WITH (security_invoker = true) AS
 SELECT s.id AS servicio_id,
    s.estado,
    s.fecha_ingreso,
    s.fecha_limite_entrega,
    s.fecha_imagenes_recibidas,
    CURRENT_DATE - s.fecha_ingreso AS dias_en_sistema,
    CASE
      WHEN s.estado::text = 'ENTREGADO' AND s.fecha_entrega_real IS NOT NULL
        THEN fn_dias_habiles_entre(s.fecha_entrega_real, s.fecha_limite_entrega)
      ELSE fn_dias_habiles_hasta(s.fecha_limite_entrega)
    END AS dias_para_vencer,
    m.nombre AS mascota,
    e.nombre AS especie,
    m.raza,
    (c.nombre::text || ' '::text) || c.apellido::text AS cliente,
    c.whatsapp AS cliente_wa,
    c.id_cliente,
    p.nombre AS plan,
    p.tipo_proceso,
    p.categoria AS plan_categoria,
    f.nombre AS flujo,
    s.tipo_acompanamiento,
    s.canal_entrada,
    a.nombre AS aliado_origen,
    a.vip AS aliado_vip,
    s.coordinador_id,
    s.tecnico_id,
    s.valor_total,
    s.valor_pagado,
    s.valor_total - s.valor_pagado AS saldo_pendiente,
    s.estado_pago,
    s.tipo_cliente,
    count(sr.id) FILTER (WHERE sr.origen::text <> 'REMOVIDO'::text AND sr.estado::text <> 'NA'::text) AS total_items,
    count(sr.id) FILTER (WHERE (sr.estado::text = ANY (ARRAY['LISTO'::character varying::text, 'ENTREGADO'::character varying::text])) AND sr.origen::text <> 'REMOVIDO'::text) AS items_listos,
    s.imagenes_solicitadas,
    s.notas,
    p.codigo AS codigo_plan,
    s.comentarios_cliente,
    s.recordatorios_anticipados,
    s.fecha_codigo_enviado,
        CASE
            WHEN s.fecha_codigo_enviado IS NOT NULL AND s.fecha_imagenes_recibidas IS NULL AND fn_dias_habiles_hasta(s.fecha_codigo_enviado) <= '-3'::integer THEN true
            ELSE false
        END AS alerta_fotos_pendientes,
    s.fecha_entrega_real
   FROM servicios s
     JOIN mascotas m ON s.mascota_id = m.id_mascota
     JOIN clientes c ON m.cliente_id = c.id_cliente
     LEFT JOIN especies e ON m.especie_id = e.id
     LEFT JOIN planes p ON s.plan_id = p.id
     LEFT JOIN flujos_proceso f ON s.flujo_id = f.id
     LEFT JOIN aliados a ON s.aliado_origen_id = a.id_aliado
     LEFT JOIN servicio_recordatorios sr ON sr.servicio_id = s.id
  WHERE s.estado::text <> 'CANCELADO'::text
  GROUP BY s.id, m.nombre, m.raza, e.nombre, c.nombre, c.apellido, c.whatsapp, c.id_cliente, p.nombre, p.tipo_proceso, p.categoria, p.codigo, f.nombre, a.nombre, a.vip;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 🪤 El frontend nuevo lee `v_kanban.fecha_entrega_real`: esta migración ANTES
-- del push (sin la columna, la tarjeta solo pierde la etiqueta «a tiempo/tarde»,
-- no se rompe: el campo llega undefined).
--
-- Reversa: volver a la vista sin la columna exige DROP VIEW v_alertas, v_kanban
-- y recrearlas (048). El trigger: DROP TRIGGER trg_sellar_fecha_entrega_real ON
-- servicios. El relleno no se revierte (era un dato que faltaba).
