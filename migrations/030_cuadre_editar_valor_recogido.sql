-- ============================================================================
-- 030 - Cuadre tecnicos: editar valor recogido por admin
-- ----------------------------------------------------------------------------
-- Permite corregir en un cuadre BORRADOR el valor recogido de una fila desde
-- Finanzas. La correccion ajusta el efectivo por diferencia, conserva el valor
-- digital ya registrado y recalcula la cabecera del cuadre en la misma
-- transaccion. Solo ADMIN puede ejecutar esta RPC desde la app.
-- ============================================================================

ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS valor_recogido_original numeric,
  ADD COLUMN IF NOT EXISTS valor_recogido_editado_en timestamptz,
  ADD COLUMN IF NOT EXISTS valor_recogido_editado_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS valor_recogido_motivo text;

CREATE OR REPLACE FUNCTION public.set_cuadre_item_valor_recogido(
  p_item_id        uuid,
  p_total_cobrado numeric,
  p_actor_id       uuid DEFAULT NULL,
  p_motivo         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuadre_id       uuid;
  v_estado          text;
  v_es_cancelado    boolean;
  v_rol             int;
  v_total_anterior  numeric;
  v_original        numeric;
  v_digital         numeric;
  v_nuevo_efectivo  numeric;
  v_tot_cobrado     numeric;
  v_tot_efectivo    numeric;
  v_tot_digital     numeric;
  v_tot_transporte  numeric;
  v_tot_recargos    numeric;
  v_tot_pago        numeric;
  v_tot_cancelados  numeric;
  v_ajustes         numeric;
  v_reconocido      numeric;
  v_neto            numeric;
  v_entregar        numeric;
  v_saldo           numeric;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUERIDO: se requiere usuario admin';
  END IF;

  SELECT rol_principal_id INTO v_rol
  FROM public.personal
  WHERE id = p_actor_id;

  IF COALESCE(v_rol, 0) <> 6 THEN
    RAISE EXCEPTION 'SOLO_ADMIN: solo ADMIN puede modificar el valor recogido';
  END IF;

  IF p_total_cobrado IS NULL OR p_total_cobrado < 0 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: el valor recogido debe ser mayor o igual a cero';
  END IF;

  SELECT ci.cuadre_id, c.estado, ci.es_cancelado, ci.total_cobrado, ci.digital, ci.valor_recogido_original
    INTO v_cuadre_id, v_estado, v_es_cancelado, v_total_anterior, v_digital, v_original
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
    RAISE EXCEPTION 'ITEM_CANCELADO: no se edita valor recogido en servicios cancelados';
  END IF;

  v_digital := COALESCE(v_digital, 0);
  IF p_total_cobrado < v_digital THEN
    RAISE EXCEPTION 'VALOR_MENOR_A_DIGITAL: el valor recogido no puede ser menor al valor digital ya registrado (%)', v_digital;
  END IF;

  v_nuevo_efectivo := p_total_cobrado - v_digital;

  UPDATE public.cuadre_items SET
    valor_recogido_original   = COALESCE(valor_recogido_original, v_total_anterior),
    total_cobrado             = p_total_cobrado,
    efectivo                  = v_nuevo_efectivo,
    valor_recogido_editado_en = now(),
    valor_recogido_editado_por = p_actor_id,
    valor_recogido_motivo     = NULLIF(btrim(p_motivo), '')
  WHERE id = p_item_id;

  SELECT
    COALESCE(SUM(total_cobrado), 0),
    COALESCE(SUM(efectivo), 0),
    COALESCE(SUM(digital), 0),
    COALESCE(SUM(transporte_reconocido), 0),
    COALESCE(SUM(recargo_aplicado), 0),
    COALESCE(SUM(CASE WHEN NOT COALESCE(es_cancelado, false) THEN pago_servicio ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(es_cancelado, false) THEN pago_servicio ELSE 0 END), 0)
  INTO v_tot_cobrado, v_tot_efectivo, v_tot_digital, v_tot_transporte, v_tot_recargos, v_tot_pago, v_tot_cancelados
  FROM public.cuadre_items
  WHERE cuadre_id = v_cuadre_id;

  SELECT ajustes_manuales INTO v_ajustes
  FROM public.cuadres_tecnico
  WHERE id = v_cuadre_id;

  v_reconocido := v_tot_transporte + v_tot_recargos + v_tot_pago + v_tot_cancelados;
  v_neto       := v_tot_efectivo - v_reconocido - COALESCE(v_ajustes, 0);
  v_entregar   := GREATEST(v_neto, 0);
  v_saldo      := GREATEST(-v_neto, 0);

  UPDATE public.cuadres_tecnico SET
    total_cobrado         = v_tot_cobrado,
    efectivo_recibido     = v_tot_efectivo,
    digital_empresa       = v_tot_digital,
    total_transporte      = v_tot_transporte,
    total_recargos        = v_tot_recargos,
    total_pago_servicio   = v_tot_pago,
    total_cancelados      = v_tot_cancelados,
    total_reconocido      = v_reconocido,
    dinero_a_entregar     = v_entregar,
    saldo_a_favor_tecnico = v_saldo
  WHERE id = v_cuadre_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'cuadre_id', v_cuadre_id,
    'total_cobrado', p_total_cobrado,
    'efectivo', v_nuevo_efectivo,
    'digital', v_digital,
    'valor_recogido_original', COALESCE(v_original, v_total_anterior, 0),
    'valor_recogido_editado_en', now(),
    'valor_recogido_motivo', NULLIF(btrim(p_motivo), ''),
    'total_cobrado_cuadre', v_tot_cobrado,
    'efectivo_recibido', v_tot_efectivo,
    'digital_empresa', v_tot_digital,
    'total_transporte', v_tot_transporte,
    'total_recargos', v_tot_recargos,
    'total_pago_servicio', v_tot_pago,
    'total_cancelados', v_tot_cancelados,
    'total_reconocido', v_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_valor_recogido(uuid, numeric, uuid, text)
  TO authenticated, service_role;

-- PostgREST: recargar schema cache para que tome la RPC nueva.
NOTIFY pgrst, 'reload schema';
