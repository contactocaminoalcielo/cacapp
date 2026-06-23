-- ============================================================================
-- 016 — Congelar en el cuadre el valor a cobrar (plan / adicionales / total)
-- Fecha: 2026-06-23
--
-- El cuadre mostraba solo lo recogido. David pide ver también el valor del plan,
-- los adicionales y el total que se debía cobrar. Se snapshotean en cuadre_items
-- (en vez de leerlos en vivo desde el front, que fallaba en silencio).
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS valor_a_cobrar    numeric,
  ADD COLUMN IF NOT EXISTS valor_plan        numeric,
  ADD COLUMN IF NOT EXISTS valor_adicionales numeric;

COMMIT;

-- ============================================================================
-- generar_cuadre_tecnico — snapshot de valor a cobrar / plan / adicionales
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generar_cuadre_tecnico(
  p_tecnico_id        uuid,
  p_desde             date,
  p_hasta             date,
  p_actor_id          uuid    DEFAULT NULL,
  p_ajustes_manuales  numeric DEFAULT 0,
  p_ajustes_motivo    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuadre_id        uuid;
  v_rec              record;
  v_can              record;
  v_tarifa_dom       numeric := 0;
  v_tarifa_fes       numeric := 0;
  v_tarifa_noc       numeric := 0;
  v_tarifa_lej       numeric := 0;
  v_tarifa_can       numeric := 0;
  v_lej_recibos      uuid[]  := ARRAY[]::uuid[];
  v_vehiculo         text;
  v_es_moto          boolean;
  v_efectivo         numeric;
  v_digital          numeric;
  v_nmedios          int;
  v_es_dom           boolean;
  v_es_fes           boolean;
  v_es_noc           boolean;
  v_es_lej           boolean;
  v_dia_recargo      numeric;
  v_recargo          numeric;
  v_pago             numeric;
  v_transporte       numeric;
  v_sin_dato         boolean;
  v_n                int     := 0;
  v_tot_cobrado      numeric := 0;
  v_tot_efectivo     numeric := 0;
  v_tot_digital      numeric := 0;
  v_tot_transporte   numeric := 0;
  v_tot_recargos     numeric := 0;
  v_tot_pago         numeric := 0;
  v_tot_cancelados   numeric := 0;
  v_tot_reconocido   numeric := 0;
  v_neto             numeric;
  v_entregar         numeric;
  v_saldo_favor      numeric;
BEGIN
  IF p_tecnico_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: tecnico, desde y hasta son obligatorios';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'RANGO_INVALIDO: la fecha hasta no puede ser anterior a desde';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuadres_tecnico
    WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
      AND fecha_hasta = p_hasta AND estado = 'CERRADO'
  ) THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: ya existe un cuadre CERRADO para este técnico y rango';
  END IF;

  SELECT COALESCE(array_agg(ci.recibo_id) FILTER (WHERE ci.recibo_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_lej_recibos
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR' AND ci.es_lejania;

  DELETE FROM public.cuadres_tecnico
  WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
    AND fecha_hasta = p_hasta AND estado = 'BORRADOR';

  SELECT recargo_dominical, recargo_festivo, recargo_nocturno, recargo_lejania, pago_cancelado
    INTO v_tarifa_dom, v_tarifa_fes, v_tarifa_noc, v_tarifa_lej, v_tarifa_can
  FROM public.tarifas_reconocimiento_tecnico
  WHERE activo ORDER BY updated_at DESC LIMIT 1;
  v_tarifa_dom := COALESCE(v_tarifa_dom, 0);
  v_tarifa_fes := COALESCE(v_tarifa_fes, 0);
  v_tarifa_noc := COALESCE(v_tarifa_noc, 0);
  v_tarifa_lej := COALESCE(v_tarifa_lej, 0);
  v_tarifa_can := COALESCE(v_tarifa_can, 0);

  SELECT tipo_vehiculo INTO v_vehiculo FROM public.personal WHERE id = p_tecnico_id;
  v_es_moto := upper(COALESCE(v_vehiculo, '')) = 'MOTO';

  INSERT INTO public.cuadres_tecnico (
    tecnico_id, fecha_desde, fecha_hasta, estado,
    ajustes_manuales, ajustes_motivo, generado_por
  ) VALUES (
    p_tecnico_id, p_desde, p_hasta, 'BORRADOR',
    COALESCE(p_ajustes_manuales, 0), NULLIF(p_ajustes_motivo,''), p_actor_id
  )
  RETURNING id INTO v_cuadre_id;

  -- ── Recibos del técnico (excluye los ya cuadrados en un cierre previo) ──────
  FOR v_rec IN
    SELECT r.id AS recibo_id, r.servicio_id, r.fecha_emision, r.hora_emision,
           r.valor_cobrado, r.medios_pago,
           s.valor_transporte, s.ciudad_recogida, s.plan_id,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           m.nombre AS mascota_nombre,
           p.nombre AS plan_nombre
    FROM public.recibos_tecnico r
    JOIN public.servicios s ON s.id = r.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    WHERE r.tecnico_id = p_tecnico_id
      AND r.fecha_emision BETWEEN p_desde AND p_hasta
      AND s.estado <> 'CANCELADO'
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.recibo_id = r.id AND c2.estado = 'CERRADO'
      )
    ORDER BY r.fecha_emision, r.hora_emision
  LOOP
    SELECT COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'EFECTIVO'), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) <> 'EFECTIVO'), 0),
           COUNT(*)
      INTO v_efectivo, v_digital, v_nmedios
    FROM public.recibo_medios_pago
    WHERE recibo_id = v_rec.recibo_id;

    IF v_nmedios = 0 THEN
      SELECT COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') <> 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0)
        INTO v_efectivo, v_digital
      FROM jsonb_array_elements(COALESCE(v_rec.medios_pago, '[]'::jsonb)) elem;
    END IF;

    v_es_dom := extract(isodow FROM v_rec.fecha_emision) = 7;
    v_es_fes := EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = v_rec.fecha_emision);
    v_es_noc := v_rec.hora_emision IS NOT NULL AND v_rec.hora_emision >= TIME '18:00';
    v_es_lej := v_rec.recibo_id = ANY(v_lej_recibos);

    v_dia_recargo := CASE WHEN v_es_fes THEN v_tarifa_fes
                          WHEN v_es_dom THEN v_tarifa_dom
                          ELSE 0 END;
    v_recargo := v_dia_recargo
                 + CASE WHEN v_es_noc THEN v_tarifa_noc ELSE 0 END
                 + CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;

    v_pago := 0;
    IF v_rec.plan_id IS NOT NULL THEN
      SELECT CASE WHEN v_es_moto THEN monto_moto ELSE monto_carro END
        INTO v_pago
      FROM public.tarifas_pago_tecnico_servicio
      WHERE plan_id = v_rec.plan_id;
    END IF;
    v_pago := COALESCE(v_pago, 0);

    v_transporte := COALESCE(v_rec.valor_transporte, 0);
    v_sin_dato   := v_rec.valor_transporte IS NULL
                    AND COALESCE(v_rec.ciudad_recogida, 'Bogotá') <> 'Bogotá';

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo,
      valor_a_cobrar, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre, v_vehiculo,
      v_rec.svc_valor_total, v_rec.svc_valor_plan, v_rec.svc_valor_adic,
      v_efectivo + v_digital, v_efectivo, v_digital,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_es_lej, v_recargo, v_pago, false
    );

    v_n              := v_n + 1;
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital;
    v_tot_efectivo   := v_tot_efectivo   + v_efectivo;
    v_tot_digital    := v_tot_digital    + v_digital;
    v_tot_transporte := v_tot_transporte + v_transporte;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
    v_tot_pago       := v_tot_pago       + v_pago;
  END LOOP;

  -- ── Cancelados (viaje perdido) — excluye los ya cuadrados en un cierre previo ─
  IF v_tarifa_can > 0 THEN
    FOR v_can IN
      SELECT s.id AS servicio_id, s.cancelado_en, s.ciudad_recogida,
             s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
             s.valor_adicionales AS svc_valor_adic,
             m.nombre AS mascota_nombre, p.nombre AS plan_nombre
      FROM public.servicios s
      LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
      LEFT JOIN public.planes   p ON p.id = s.plan_id
      WHERE s.estado = 'CANCELADO'
        AND s.cancelado_en IS NOT NULL
        AND s.cancelado_en::date BETWEEN p_desde AND p_hasta
        AND COALESCE(s.etapa_cancelacion, 'INGRESADO') <> 'INGRESADO'
        AND COALESCE(
              (SELECT rg.tecnico_id FROM public.recogidas rg
                 WHERE rg.servicio_id = s.id AND rg.tecnico_id IS NOT NULL
                 ORDER BY rg.id DESC LIMIT 1),
              s.tecnico_id
            ) = p_tecnico_id
        AND NOT EXISTS (
          SELECT 1 FROM public.cuadre_items ci2
          JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
          WHERE ci2.servicio_id = s.id AND ci2.es_cancelado AND c2.estado = 'CERRADO'
        )
      ORDER BY s.cancelado_en
    LOOP
      INSERT INTO public.cuadre_items (
        cuadre_id, servicio_id, recibo_id, fecha, hora,
        mascota_nombre, ciudad, plan_nombre, vehiculo,
        valor_a_cobrar, valor_plan, valor_adicionales,
        total_cobrado, efectivo, digital,
        transporte_reconocido, transporte_sin_dato,
        es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado
      ) VALUES (
        v_cuadre_id, v_can.servicio_id, NULL, v_can.cancelado_en::date, NULL,
        v_can.mascota_nombre, v_can.ciudad_recogida, v_can.plan_nombre, v_vehiculo,
        v_can.svc_valor_total, v_can.svc_valor_plan, v_can.svc_valor_adic,
        0, 0, 0,
        0, false,
        false, false, false, false, 0, v_tarifa_can, true
      );
      v_n              := v_n + 1;
      v_tot_cancelados := v_tot_cancelados + v_tarifa_can;
    END LOOP;
  END IF;

  v_tot_reconocido := v_tot_transporte + v_tot_recargos + v_tot_pago + v_tot_cancelados;
  v_neto        := v_tot_efectivo - v_tot_reconocido - COALESCE(p_ajustes_manuales, 0);
  v_entregar    := GREATEST(v_neto, 0);
  v_saldo_favor := GREATEST(-v_neto, 0);

  UPDATE public.cuadres_tecnico SET
    total_servicios       = v_n,
    total_cobrado         = v_tot_cobrado,
    efectivo_recibido     = v_tot_efectivo,
    digital_empresa       = v_tot_digital,
    total_transporte      = v_tot_transporte,
    total_recargos        = v_tot_recargos,
    total_pago_servicio   = v_tot_pago,
    total_cancelados      = v_tot_cancelados,
    total_reconocido      = v_tot_reconocido,
    dinero_a_entregar     = v_entregar,
    saldo_a_favor_tecnico = v_saldo_favor
  WHERE id = v_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id', v_cuadre_id,
    'total_servicios', v_n,
    'total_cobrado', v_tot_cobrado,
    'efectivo_recibido', v_tot_efectivo,
    'digital_empresa', v_tot_digital,
    'total_pago_servicio', v_tot_pago,
    'total_cancelados', v_tot_cancelados,
    'total_reconocido', v_tot_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo_favor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generar_cuadre_tecnico(uuid, date, date, uuid, numeric, text)
  TO authenticated, service_role;
