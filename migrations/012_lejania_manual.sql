-- ============================================================================
-- 012 — Recargo de lejanía MANUAL por recogida (corrige 011) · Fase 1.2
-- Fecha: 2026-06-23
--
-- David corrige: la lejanía NO es por ciudad y puede aplicar incluso a servicios
-- dentro de Bogotá. Debe marcarse MANUAL, fila por fila, EN EL CUADRE, con monto
-- FIJO de Configuración, y hacer parte de la lógica matemática del cuadre.
--
-- Cambios:
--   - Se elimina la detección automática por ciudad (tarifas_transporte.es_lejana).
--   - generar_cuadre_tecnico ya NO infiere lejanía; preserva las marcas manuales
--     previas (por recibo) al regenerar un BORRADOR.
--   - Nueva RPC set_cuadre_item_lejania: marca/desmarca lejanía en una fila y
--     recalcula el recargo de esa fila + los totales del cuadre (solo BORRADOR).
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

BEGIN;

-- Revertir el flag por-ciudad de 011 (era el mecanismo equivocado).
ALTER TABLE public.tarifas_transporte DROP COLUMN IF EXISTS es_lejana;

COMMIT;

-- ============================================================================
-- generar_cuadre_tecnico — sin inferencia por ciudad; preserva lejanía manual
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
  v_tarifa_dom       numeric := 0;
  v_tarifa_fes       numeric := 0;
  v_tarifa_noc       numeric := 0;
  v_tarifa_lej       numeric := 0;
  v_lej_recibos      uuid[]  := ARRAY[]::uuid[];   -- recibos marcados lejanía en el borrador previo
  v_efectivo         numeric;
  v_digital          numeric;
  v_nmedios          int;
  v_es_dom           boolean;
  v_es_fes           boolean;
  v_es_noc           boolean;
  v_es_lej           boolean;
  v_dia_recargo      numeric;
  v_recargo          numeric;
  v_transporte       numeric;
  v_sin_dato         boolean;
  v_n                int     := 0;
  v_tot_cobrado      numeric := 0;
  v_tot_efectivo     numeric := 0;
  v_tot_digital      numeric := 0;
  v_tot_transporte   numeric := 0;
  v_tot_recargos     numeric := 0;
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

  -- Preservar marcas manuales de lejanía del borrador previo (por recibo).
  SELECT COALESCE(array_agg(ci.recibo_id), ARRAY[]::uuid[])
    INTO v_lej_recibos
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR' AND ci.es_lejania;

  DELETE FROM public.cuadres_tecnico
  WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
    AND fecha_hasta = p_hasta AND estado = 'BORRADOR';

  SELECT recargo_dominical, recargo_festivo, recargo_nocturno, recargo_lejania
    INTO v_tarifa_dom, v_tarifa_fes, v_tarifa_noc, v_tarifa_lej
  FROM public.tarifas_reconocimiento_tecnico
  WHERE activo
  ORDER BY updated_at DESC
  LIMIT 1;
  v_tarifa_dom := COALESCE(v_tarifa_dom, 0);
  v_tarifa_fes := COALESCE(v_tarifa_fes, 0);
  v_tarifa_noc := COALESCE(v_tarifa_noc, 0);
  v_tarifa_lej := COALESCE(v_tarifa_lej, 0);

  INSERT INTO public.cuadres_tecnico (
    tecnico_id, fecha_desde, fecha_hasta, estado,
    ajustes_manuales, ajustes_motivo, generado_por
  ) VALUES (
    p_tecnico_id, p_desde, p_hasta, 'BORRADOR',
    COALESCE(p_ajustes_manuales, 0), NULLIF(p_ajustes_motivo,''), p_actor_id
  )
  RETURNING id INTO v_cuadre_id;

  FOR v_rec IN
    SELECT r.id AS recibo_id, r.servicio_id, r.fecha_emision, r.hora_emision,
           r.valor_cobrado, r.medios_pago,
           s.valor_transporte, s.ciudad_recogida,
           m.nombre AS mascota_nombre,
           p.nombre AS plan_nombre
    FROM public.recibos_tecnico r
    JOIN public.servicios s ON s.id = r.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    WHERE r.tecnico_id = p_tecnico_id
      AND r.fecha_emision BETWEEN p_desde AND p_hasta
      AND s.estado <> 'CANCELADO'
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
    -- Lejanía: MANUAL. Solo se conserva si venía marcada en el borrador previo.
    v_es_lej := v_rec.recibo_id = ANY(v_lej_recibos);

    v_dia_recargo := CASE WHEN v_es_fes THEN v_tarifa_fes
                          WHEN v_es_dom THEN v_tarifa_dom
                          ELSE 0 END;
    v_recargo := v_dia_recargo
                 + CASE WHEN v_es_noc THEN v_tarifa_noc ELSE 0 END
                 + CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;

    v_transporte := COALESCE(v_rec.valor_transporte, 0);
    v_sin_dato   := v_rec.valor_transporte IS NULL
                    AND COALESCE(v_rec.ciudad_recogida, 'Bogotá') <> 'Bogotá';

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre,
      total_cobrado, efectivo, digital,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre,
      v_efectivo + v_digital, v_efectivo, v_digital,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_es_lej, v_recargo
    );

    v_n              := v_n + 1;
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital;
    v_tot_efectivo   := v_tot_efectivo   + v_efectivo;
    v_tot_digital    := v_tot_digital    + v_digital;
    v_tot_transporte := v_tot_transporte + v_transporte;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
  END LOOP;

  v_tot_reconocido := v_tot_transporte + v_tot_recargos;
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
    'total_reconocido', v_tot_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo_favor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generar_cuadre_tecnico(uuid, date, date, uuid, numeric, text)
  TO authenticated, service_role;

-- ============================================================================
-- set_cuadre_item_lejania — marca/desmarca lejanía en una fila y recalcula
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_cuadre_item_lejania(
  p_item_id  uuid,
  p_aplica   boolean,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuadre_id      uuid;
  v_estado         text;
  v_es_dom         boolean;
  v_es_fes         boolean;
  v_es_noc         boolean;
  v_dom numeric; v_fes numeric; v_noc numeric; v_lej numeric;
  v_dia            numeric;
  v_recargo        numeric;
  v_tot_recargos   numeric;
  v_tot_transporte numeric;
  v_efectivo       numeric;
  v_ajustes        numeric;
  v_reconocido     numeric;
  v_neto           numeric;
  v_entregar       numeric;
  v_saldo          numeric;
BEGIN
  SELECT ci.cuadre_id, c.estado, ci.es_dominical, ci.es_festivo, ci.es_nocturno
    INTO v_cuadre_id, v_estado, v_es_dom, v_es_fes, v_es_noc
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE ci.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NO_EXISTE: %', p_item_id;
  END IF;
  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: no se puede editar un cuadre cerrado';
  END IF;

  SELECT recargo_dominical, recargo_festivo, recargo_nocturno, recargo_lejania
    INTO v_dom, v_fes, v_noc, v_lej
  FROM public.tarifas_reconocimiento_tecnico
  WHERE activo ORDER BY updated_at DESC LIMIT 1;
  v_dom := COALESCE(v_dom,0); v_fes := COALESCE(v_fes,0); v_noc := COALESCE(v_noc,0); v_lej := COALESCE(v_lej,0);

  v_dia := CASE WHEN v_es_fes THEN v_fes WHEN v_es_dom THEN v_dom ELSE 0 END;
  v_recargo := v_dia
               + CASE WHEN v_es_noc THEN v_noc ELSE 0 END
               + CASE WHEN p_aplica THEN v_lej ELSE 0 END;

  UPDATE public.cuadre_items
     SET es_lejania = p_aplica, recargo_aplicado = v_recargo
   WHERE id = p_item_id;

  -- Recalcular totales del cuadre desde los ítems + la cabecera congelada.
  SELECT COALESCE(SUM(recargo_aplicado), 0) INTO v_tot_recargos
  FROM public.cuadre_items WHERE cuadre_id = v_cuadre_id;

  SELECT total_transporte, efectivo_recibido, ajustes_manuales
    INTO v_tot_transporte, v_efectivo, v_ajustes
  FROM public.cuadres_tecnico WHERE id = v_cuadre_id;

  v_reconocido := v_tot_transporte + v_tot_recargos;
  v_neto       := v_efectivo - v_reconocido - COALESCE(v_ajustes, 0);
  v_entregar   := GREATEST(v_neto, 0);
  v_saldo      := GREATEST(-v_neto, 0);

  UPDATE public.cuadres_tecnico SET
    total_recargos        = v_tot_recargos,
    total_reconocido      = v_reconocido,
    dinero_a_entregar     = v_entregar,
    saldo_a_favor_tecnico = v_saldo
  WHERE id = v_cuadre_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'es_lejania', p_aplica,
    'recargo_aplicado', v_recargo,
    'total_recargos', v_tot_recargos,
    'total_reconocido', v_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_lejania(uuid, boolean, uuid)
  TO authenticated, service_role;
