-- ============================================================================
-- 071 — Cuántos servicios lleva un técnico SIN CUADRAR
-- ----------------------------------------------------------------------------
-- David (2026-07-22): cuando un técnico llegue a 40 servicios sin cuadrar, que
-- al entrar a Orbit le salte una alerta ("ya completaste 40 servicios, ve a
-- cuadrar cuentas") con un botón de WhatsApp para pedirle cita a coordinación.
--
-- "Sin cuadrar" = servicio del técnico que NO está todavía en ningún cuadre
-- CERRADO. Es la misma población que armaría generar_cuadre_tecnico:
--   · con recibo emitido por él,
--   · recogido por él SIN recibo (no cobró),
--   · cancelado con él ya despachado (etapa_cancelacion <> 'INGRESADO').
-- El técnico de un servicio es recogidas.tecnico_id y, si no hay, servicios.
-- tecnico_id — o el del recibo, que es quien de verdad cobró.
--
-- Un BORRADOR abierto NO descuenta: mientras no se cierre, el dinero sigue sin
-- cuadrarse (que es justo lo que la alerta persigue).
--
-- Se hace en la DB y no en la app para que el conteo sea el mismo que ve el
-- coordinador al generar el cuadre.
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.servicios_sin_cuadrar_tecnico(
  p_tecnico_id uuid,
  p_desde      date DEFAULT NULL   -- corte de datos de Orbit (lib/constants)
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mios AS (
    SELECT s.id, s.fecha_ingreso, s.estado,
           EXISTS (SELECT 1 FROM public.recibos_tecnico r WHERE r.servicio_id = s.id) AS con_recibo
    FROM public.servicios s
    WHERE (p_desde IS NULL OR s.fecha_ingreso >= p_desde)
      AND (
        -- recogido/asignado a él…
        COALESCE(
          (SELECT rg.tecnico_id FROM public.recogidas rg
            WHERE rg.servicio_id = s.id AND rg.tecnico_id IS NOT NULL
            ORDER BY rg.id DESC LIMIT 1),
          s.tecnico_id
        ) = p_tecnico_id
        -- …o fue él quien emitió el recibo (quien de verdad cobró)
        OR EXISTS (SELECT 1 FROM public.recibos_tecnico r
                    WHERE r.servicio_id = s.id AND r.tecnico_id = p_tecnico_id)
      )
      -- los cancelados solo cuentan si ya había salido (viaje perdido)
      AND (s.estado <> 'CANCELADO'
           OR (s.cancelado_en IS NOT NULL
               AND COALESCE(s.etapa_cancelacion, 'INGRESADO') <> 'INGRESADO'))
      -- ya cuadrado y cerrado → fuera
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci
        JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
        WHERE ci.servicio_id = s.id AND c.estado = 'CERRADO'
      )
  )
  SELECT jsonb_build_object(
    'total',        (SELECT count(*)                             FROM mios),
    'con_recibo',   (SELECT count(*) FILTER (WHERE con_recibo)   FROM mios),
    'sin_recibo',   (SELECT count(*) FILTER (WHERE NOT con_recibo AND estado <> 'CANCELADO') FROM mios),
    'cancelados',   (SELECT count(*) FILTER (WHERE estado = 'CANCELADO') FROM mios),
    'desde_fecha',  (SELECT min(fecha_ingreso)                   FROM mios),
    'hasta_fecha',  (SELECT max(fecha_ingreso)                   FROM mios)
  );
$$;

GRANT EXECUTE ON FUNCTION public.servicios_sin_cuadrar_tecnico(uuid, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
