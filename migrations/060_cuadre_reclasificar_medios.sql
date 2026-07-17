-- ============================================================================
-- 060 — Cuadre técnicos: reclasificar medios de pago de una fila (efectivo↔digital)
-- ----------------------------------------------------------------------------
-- Caso real: al técnico le dijeron que pagarían en EFECTIVO y en el recibo lo
-- registró así, pero el cliente terminó pagando por Nequi a la cuenta de la
-- EMPRESA. El recibo es evidencia del cliente y NO se toca (inmutable). La
-- corrección vive en el cuadre, con motivo y rastro, igual que la edición de
-- valor recogido (migración 030).
--
-- Diferencia con 030 (set_cuadre_item_valor_recogido):
--   • 030 cambia CUÁNTO se recogió (el total) y ajusta el efectivo por diferencia.
--   • 060 NO cambia el total: solo cambia CÓMO se repartió entre efectivo y
--     digital. Ese es el bug de este caso — el total estaba bien, lo que estaba
--     mal era que el sistema le atribuía al técnico un efectivo que nunca tuvo.
--
-- Efecto en el cuadre: como `dinero_a_entregar = efectivo_recibido − reconocido`,
-- mover $X de efectivo a digital baja en $X lo que el técnico debe entregar (la
-- empresa ya tiene esa plata en su Nequi). Regla 2 del cuadre: todo lo digital
-- entra directo a la empresa.
--
-- Solo ADMIN, solo cuadre BORRADOR, motivo obligatorio. Snapshot del reparto
-- original en columnas nuevas. Aditiva, idempotente, reversible.
--
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < 060_cuadre_reclasificar_medios.sql
-- ============================================================================

BEGIN;

-- ─── 1. Columnas de rastro (snapshot + quién/cuándo/porqué) ─────────────────
ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS medios_pago_original    jsonb,
  ADD COLUMN IF NOT EXISTS medios_editado_en       timestamptz,
  ADD COLUMN IF NOT EXISTS medios_editado_por      uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS medios_motivo           text;

-- ─── 2. RPC: reasignar el reparto de medios de una fila ─────────────────────
-- p_medios = [{ "metodo": "NEQUI", "monto": 120000 }, ...]. La suma DEBE ser
-- igual al total ya recogido de la fila (esto reclasifica, no re-cobra; para
-- cambiar el total está set_cuadre_item_valor_recogido).
CREATE OR REPLACE FUNCTION public.set_cuadre_item_medios(
  p_item_id  uuid,
  p_medios   jsonb,
  p_actor_id uuid DEFAULT NULL,
  p_motivo   text DEFAULT NULL
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
  v_total_actual    numeric;
  v_orig_medios     jsonb;
  v_nuevo_efectivo  numeric;
  v_nuevo_digital   numeric;
  v_suma            numeric;
  v_medios_norm     jsonb;
  v_motivo          text := NULLIF(btrim(p_motivo), '');
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

  SELECT rol_principal_id INTO v_rol FROM public.personal WHERE id = p_actor_id;
  IF COALESCE(v_rol, 0) <> 6 THEN
    RAISE EXCEPTION 'SOLO_ADMIN: solo ADMIN puede reclasificar los medios de pago';
  END IF;

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: explica por qué cambias el medio de pago';
  END IF;

  IF p_medios IS NULL OR jsonb_typeof(p_medios) <> 'array' OR jsonb_array_length(p_medios) = 0 THEN
    RAISE EXCEPTION 'MEDIOS_INVALIDOS: se requiere al menos un medio con monto';
  END IF;

  SELECT ci.cuadre_id, c.estado, ci.es_cancelado, ci.total_cobrado, ci.medios_pago
    INTO v_cuadre_id, v_estado, v_es_cancelado, v_total_actual, v_orig_medios
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
    RAISE EXCEPTION 'ITEM_CANCELADO: no se reclasifican medios en servicios cancelados';
  END IF;

  -- Normalizar: metodo en mayúsculas, monto numérico >= 0, descartar montos nulos/0.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'metodo', upper(btrim(elem->>'metodo')),
           'monto',  round(COALESCE(NULLIF(elem->>'monto','')::numeric, 0))
         )) FILTER (WHERE COALESCE(NULLIF(elem->>'monto','')::numeric, 0) > 0), '[]'::jsonb)
    INTO v_medios_norm
  FROM jsonb_array_elements(p_medios) elem;

  IF v_medios_norm = '[]'::jsonb THEN
    RAISE EXCEPTION 'MEDIOS_INVALIDOS: todos los montos son cero';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO' THEN (elem->>'monto')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN upper(elem->>'metodo') <> 'EFECTIVO' THEN (elem->>'monto')::numeric ELSE 0 END), 0)
    INTO v_nuevo_efectivo, v_nuevo_digital
  FROM jsonb_array_elements(v_medios_norm) elem;

  v_suma := v_nuevo_efectivo + v_nuevo_digital;

  -- Reclasificación pura: la suma debe cuadrar con lo ya recogido en la fila.
  IF round(v_suma) <> round(COALESCE(v_total_actual, 0)) THEN
    RAISE EXCEPTION 'TOTAL_NO_CUADRA: los medios suman % pero la fila tiene recogido %. Para cambiar el total usa "Modificar valor recogido".',
      round(v_suma), round(COALESCE(v_total_actual, 0));
  END IF;

  UPDATE public.cuadre_items SET
    medios_pago_original = COALESCE(medios_pago_original, v_orig_medios, '[]'::jsonb),
    medios_pago          = v_medios_norm,
    efectivo             = v_nuevo_efectivo,
    digital              = v_nuevo_digital,
    medios_editado_en    = now(),
    medios_editado_por   = p_actor_id,
    medios_motivo        = v_motivo
  WHERE id = p_item_id;

  -- Recalcular cabecera (idéntico a set_cuadre_item_valor_recogido, migración 030).
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

  SELECT ajustes_manuales INTO v_ajustes FROM public.cuadres_tecnico WHERE id = v_cuadre_id;

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
    'medios_pago', v_medios_norm,
    'medios_pago_original', COALESCE(v_orig_medios, '[]'::jsonb),
    'efectivo', v_nuevo_efectivo,
    'digital', v_nuevo_digital,
    'total_cobrado', v_suma,
    'medios_editado_en', now(),
    'medios_motivo', v_motivo,
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

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_medios(uuid, jsonb, uuid, text)
  TO authenticated, service_role;

-- PostgREST: recargar schema cache para que tome la RPC nueva.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'set_cuadre_item_medios';
-- \d+ public.cuadre_items
