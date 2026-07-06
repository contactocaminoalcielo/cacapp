-- ============================================================================
-- 031 - Cuadre tecnicos: editar recargo manual por admin
-- ----------------------------------------------------------------------------
-- Permite corregir el valor final de recargo_aplicado de una fila del cuadre
-- desde Finanzas. La correccion recalcula total_recargos, total_reconocido y
-- dinero_a_entregar en la misma transaccion. Solo ADMIN puede ejecutar la RPC.
-- Si luego se usa el checkbox de lejania, se limpia la marca manual y el recargo
-- vuelve a quedar calculado por las tarifas vigentes.
-- ============================================================================

ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS recargo_manual_original numeric,
  ADD COLUMN IF NOT EXISTS recargo_manual_editado_en timestamptz,
  ADD COLUMN IF NOT EXISTS recargo_manual_editado_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS recargo_manual_motivo text;

CREATE OR REPLACE FUNCTION public.set_cuadre_item_recargo_manual(
  p_item_id          uuid,
  p_recargo_aplicado numeric,
  p_actor_id         uuid DEFAULT NULL,
  p_motivo           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuadre_id        uuid;
  v_estado           text;
  v_es_cancelado     boolean;
  v_rol              int;
  v_recargo_anterior numeric;
  v_original         numeric;
  v_tot_recargos     numeric;
  v_tot_transporte   numeric;
  v_tot_pago         numeric;
  v_tot_cancelados   numeric;
  v_efectivo         numeric;
  v_ajustes          numeric;
  v_reconocido       numeric;
  v_neto             numeric;
  v_entregar         numeric;
  v_saldo            numeric;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUERIDO: se requiere usuario admin';
  END IF;

  SELECT rol_principal_id INTO v_rol
  FROM public.personal
  WHERE id = p_actor_id;

  IF COALESCE(v_rol, 0) <> 6 THEN
    RAISE EXCEPTION 'SOLO_ADMIN: solo ADMIN puede modificar el recargo';
  END IF;

  IF p_recargo_aplicado IS NULL OR p_recargo_aplicado < 0 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: el recargo debe ser mayor o igual a cero';
  END IF;

  SELECT ci.cuadre_id, c.estado, ci.es_cancelado, ci.recargo_aplicado, ci.recargo_manual_original
    INTO v_cuadre_id, v_estado, v_es_cancelado, v_recargo_anterior, v_original
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE ci.id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NO_EXISTE: %', p_item_id;
  END IF;
  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: no se puede editar un cuadre cerrado';
  END IF;
  IF COALESCE(v_es_cancelado, false) THEN
    RAISE EXCEPTION 'ITEM_CANCELADO: no se edita recargo en servicios cancelados';
  END IF;

  UPDATE public.cuadre_items SET
    recargo_manual_original   = COALESCE(recargo_manual_original, v_recargo_anterior),
    recargo_aplicado          = p_recargo_aplicado,
    recargo_manual_editado_en = now(),
    recargo_manual_editado_por = p_actor_id,
    recargo_manual_motivo     = NULLIF(btrim(p_motivo), '')
  WHERE id = p_item_id;

  SELECT COALESCE(SUM(recargo_aplicado), 0) INTO v_tot_recargos
  FROM public.cuadre_items
  WHERE cuadre_id = v_cuadre_id;

  SELECT total_transporte, total_pago_servicio, total_cancelados, efectivo_recibido, ajustes_manuales
    INTO v_tot_transporte, v_tot_pago, v_tot_cancelados, v_efectivo, v_ajustes
  FROM public.cuadres_tecnico
  WHERE id = v_cuadre_id;

  v_reconocido := COALESCE(v_tot_transporte, 0) + v_tot_recargos + COALESCE(v_tot_pago, 0) + COALESCE(v_tot_cancelados, 0);
  v_neto       := COALESCE(v_efectivo, 0) - v_reconocido - COALESCE(v_ajustes, 0);
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
    'cuadre_id', v_cuadre_id,
    'recargo_aplicado', p_recargo_aplicado,
    'recargo_manual_original', COALESCE(v_original, v_recargo_anterior, 0),
    'recargo_manual_editado_en', now(),
    'recargo_manual_motivo', NULLIF(btrim(p_motivo), ''),
    'total_recargos', v_tot_recargos,
    'total_reconocido', v_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_recargo_manual(uuid, numeric, uuid, text)
  TO authenticated, service_role;

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
  v_es_cancelado   boolean;
  v_es_dom         boolean;
  v_es_fes         boolean;
  v_es_noc         boolean;
  v_dom numeric; v_fes numeric; v_noc numeric; v_lej numeric;
  v_dia            numeric;
  v_recargo        numeric;
  v_tot_recargos   numeric;
  v_tot_transporte numeric;
  v_tot_pago       numeric;
  v_tot_cancelados numeric;
  v_efectivo       numeric;
  v_ajustes        numeric;
  v_reconocido     numeric;
  v_neto           numeric;
  v_entregar       numeric;
  v_saldo          numeric;
BEGIN
  SELECT ci.cuadre_id, c.estado, ci.es_cancelado, ci.es_dominical, ci.es_festivo, ci.es_nocturno
    INTO v_cuadre_id, v_estado, v_es_cancelado, v_es_dom, v_es_fes, v_es_noc
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE ci.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NO_EXISTE: %', p_item_id;
  END IF;
  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: no se puede editar un cuadre cerrado';
  END IF;
  IF v_es_cancelado THEN
    RAISE EXCEPTION 'ITEM_CANCELADO: una fila de servicio cancelado no admite recargo de lejania';
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

  UPDATE public.cuadre_items SET
    es_lejania                = p_aplica,
    recargo_aplicado          = v_recargo,
    recargo_manual_original   = NULL,
    recargo_manual_editado_en = NULL,
    recargo_manual_editado_por = NULL,
    recargo_manual_motivo     = NULL
  WHERE id = p_item_id;

  SELECT COALESCE(SUM(recargo_aplicado), 0) INTO v_tot_recargos
  FROM public.cuadre_items WHERE cuadre_id = v_cuadre_id;

  SELECT total_transporte, total_pago_servicio, total_cancelados, efectivo_recibido, ajustes_manuales
    INTO v_tot_transporte, v_tot_pago, v_tot_cancelados, v_efectivo, v_ajustes
  FROM public.cuadres_tecnico WHERE id = v_cuadre_id;

  v_reconocido := COALESCE(v_tot_transporte, 0) + v_tot_recargos + COALESCE(v_tot_pago, 0) + COALESCE(v_tot_cancelados, 0);
  v_neto       := COALESCE(v_efectivo, 0) - v_reconocido - COALESCE(v_ajustes, 0);
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
    'recargo_manual_original', NULL,
    'recargo_manual_editado_en', NULL,
    'recargo_manual_motivo', NULL,
    'total_recargos', v_tot_recargos,
    'total_reconocido', v_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_lejania(uuid, boolean, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
