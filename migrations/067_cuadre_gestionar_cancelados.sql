-- ============================================================================
-- 067 — Cuadres: gestionar el pago al técnico en servicios CANCELADOS
-- ----------------------------------------------------------------------------
-- David (2026-07-22): en el cuadre salen los servicios cancelados pero la fila
-- queda muerta — no se le puede reconocer nada extra al técnico ni dejar
-- constancia. El pago por cancelado era un monto FIJO de tarifas
-- (tarifas_reconocimiento_tecnico.pago_cancelado, hoy $20.000) igual para un
-- viaje a 10 cuadras que para uno a Chía.
--
-- Este cambio:
--   1) Nueva RPC set_cuadre_item_pago_servicio → corrige el "Pago téc." de una
--      fila (cancelada o no) con motivo y auditoría, igual que 030/031.
--      Recalcula total_pago_servicio / total_cancelados / total_reconocido /
--      dinero_a_entregar en la misma transacción.
--   2) set_cuadre_item_recargo_manual y set_cuadre_item_lejania dejan de
--      rechazar las filas canceladas (ITEM_CANCELADO). Conservan lo demás:
--      solo BORRADOR, y rol ADMIN(6) o COORDINADOR(1) — regla de 063.
--   3) generar_cuadre_tecnico preserva al regenerar el BORRADOR el pago manual,
--      el recargo manual y la lejanía TAMBIÉN en las filas canceladas y en las
--      SIN RECIBO (antes solo se preservaban en las filas con recibo: al
--      regenerar, un cancelado ajustado a mano volvía a la tarifa fija).
--   4) Se quita el gate `IF v_tarifa_can > 0` que ocultaba TODOS los cancelados
--      cuando la tarifa está en 0: ahora la fila entra siempre (con el valor que
--      diga la tarifa, aunque sea 0) y el coordinador decide cuánto reconocer.
--      Con la tarifa actual en $20.000 esto no cambia nada de lo que hoy se ve.
--
-- Nota: en las filas canceladas los flags es_dominical/es_festivo/es_nocturno
-- se guardan en false (no hay recibo del que sacar hora); si el viaje perdido
-- fue dominical o nocturno se reconoce con el lápiz de recargo.
--
-- Aplicar por SSH→psql en Contabo. Idempotente. Requiere 064 aplicada.
-- ============================================================================

BEGIN;

ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS pago_servicio_original    numeric,
  ADD COLUMN IF NOT EXISTS pago_servicio_editado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS pago_servicio_editado_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS pago_servicio_motivo      text;

COMMIT;

-- ============================================================================
-- set_cuadre_item_pago_servicio — corregir el pago reconocido al técnico
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_cuadre_item_pago_servicio(
  p_item_id  uuid,
  p_pago     numeric,
  p_actor_id uuid DEFAULT NULL,
  p_motivo   text DEFAULT NULL
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
  v_rol            int;
  v_pago_anterior  numeric;
  v_original       numeric;
  v_tot_pago       numeric;
  v_tot_cancelados numeric;
  v_tot_recargos   numeric;
  v_tot_transporte numeric;
  v_efectivo       numeric;
  v_ajustes        numeric;
  v_reconocido     numeric;
  v_neto           numeric;
  v_entregar       numeric;
  v_saldo          numeric;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUERIDO: se requiere usuario admin o coordinador';
  END IF;

  SELECT rol_principal_id INTO v_rol
  FROM public.personal
  WHERE id = p_actor_id;

  IF COALESCE(v_rol, 0) NOT IN (1, 6) THEN
    RAISE EXCEPTION 'SOLO_GESTION: solo ADMIN o COORDINADOR puede modificar el pago al técnico';
  END IF;

  IF p_pago IS NULL OR p_pago < 0 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: el pago debe ser mayor o igual a cero';
  END IF;

  SELECT ci.cuadre_id, c.estado, ci.es_cancelado, ci.pago_servicio, ci.pago_servicio_original
    INTO v_cuadre_id, v_estado, v_es_cancelado, v_pago_anterior, v_original
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

  UPDATE public.cuadre_items SET
    pago_servicio_original    = COALESCE(pago_servicio_original, v_pago_anterior),
    pago_servicio             = p_pago,
    pago_servicio_editado_en  = now(),
    pago_servicio_editado_por = p_actor_id,
    pago_servicio_motivo      = NULLIF(btrim(p_motivo), '')
  WHERE id = p_item_id;

  -- Los cancelados suman en total_cancelados; el resto en total_pago_servicio.
  SELECT COALESCE(SUM(CASE WHEN NOT COALESCE(es_cancelado, false) THEN pago_servicio ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN COALESCE(es_cancelado, false) THEN pago_servicio ELSE 0 END), 0),
         COALESCE(SUM(recargo_aplicado), 0)
    INTO v_tot_pago, v_tot_cancelados, v_tot_recargos
  FROM public.cuadre_items
  WHERE cuadre_id = v_cuadre_id;

  SELECT total_transporte, efectivo_recibido, ajustes_manuales
    INTO v_tot_transporte, v_efectivo, v_ajustes
  FROM public.cuadres_tecnico
  WHERE id = v_cuadre_id;

  v_reconocido := COALESCE(v_tot_transporte, 0) + v_tot_recargos + v_tot_pago + v_tot_cancelados;
  v_neto       := COALESCE(v_efectivo, 0) - v_reconocido - COALESCE(v_ajustes, 0);
  v_entregar   := GREATEST(v_neto, 0);
  v_saldo      := GREATEST(-v_neto, 0);

  UPDATE public.cuadres_tecnico SET
    total_pago_servicio   = v_tot_pago,
    total_cancelados      = v_tot_cancelados,
    total_reconocido      = v_reconocido,
    dinero_a_entregar     = v_entregar,
    saldo_a_favor_tecnico = v_saldo
  WHERE id = v_cuadre_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'cuadre_id', v_cuadre_id,
    'es_cancelado', COALESCE(v_es_cancelado, false),
    'pago_servicio', p_pago,
    'pago_servicio_original', COALESCE(v_original, v_pago_anterior, 0),
    'pago_servicio_editado_en', now(),
    'pago_servicio_motivo', NULLIF(btrim(p_motivo), ''),
    'total_pago_servicio', v_tot_pago,
    'total_cancelados', v_tot_cancelados,
    'total_reconocido', v_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_pago_servicio(uuid, numeric, uuid, text)
  TO authenticated, service_role;

-- ============================================================================
-- set_cuadre_item_recargo_manual — ahora también en filas canceladas
-- ============================================================================
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

  IF COALESCE(v_rol, 0) NOT IN (1, 6) THEN
    RAISE EXCEPTION 'SOLO_GESTION: solo ADMIN o COORDINADOR puede modificar el recargo';
  END IF;

  IF p_recargo_aplicado IS NULL OR p_recargo_aplicado < 0 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: el recargo debe ser mayor o igual a cero';
  END IF;

  SELECT ci.cuadre_id, c.estado, ci.recargo_aplicado, ci.recargo_manual_original
    INTO v_cuadre_id, v_estado, v_recargo_anterior, v_original
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
  -- 067: las filas canceladas SÍ admiten recargo manual (viaje perdido lejano,
  -- dominical o nocturno). Antes se rechazaban con ITEM_CANCELADO.

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

-- ============================================================================
-- set_cuadre_item_lejania — ahora también en filas canceladas
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
  v_tot_pago       numeric;
  v_tot_cancelados numeric;
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
  -- 067: un servicio cancelado lejos también le cuesta el viaje al técnico.

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

-- ============================================================================
-- generar_cuadre_tecnico — preserva pago/recargo/lejanía también en las filas
-- canceladas y sin recibo (base: 064)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generar_cuadre_tecnico(p_tecnico_id uuid, p_desde date, p_hasta date, p_actor_id uuid DEFAULT NULL::uuid, p_ajustes_manuales numeric DEFAULT 0, p_ajustes_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuadre_id        uuid;
  v_rec              record;
  v_can              record;
  v_sr               record;
  v_tarifa_dom       numeric := 0;
  v_tarifa_fes       numeric := 0;
  v_tarifa_noc       numeric := 0;
  v_tarifa_lej       numeric := 0;
  v_tarifa_can       numeric := 0;
  v_lej_svcs         uuid[]  := ARRAY[]::uuid[];
  v_prev             jsonb   := '{}'::jsonb;
  v_p                jsonb;
  v_medios           jsonb;
  v_vehiculo         text;
  v_es_moto          boolean;
  v_a_cobrar         numeric;
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
  v_via              text;
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

  -- Marcas manuales del BORRADOR previo, POR SERVICIO (una fila por servicio).
  SELECT
    COALESCE(array_agg(ci.servicio_id) FILTER (WHERE ci.es_lejania), ARRAY[]::uuid[]),
    COALESCE(jsonb_object_agg(ci.servicio_id::text, jsonb_build_object(
      'obs', ci.observaciones, 'estado', ci.estado_conciliacion,
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta,
      'efectivo', ci.efectivo, 'digital', ci.digital, 'medios_pago', ci.medios_pago,
      'medios_pago_original', ci.medios_pago_original, 'medios_editado_en', ci.medios_editado_en,
      'medios_editado_por', ci.medios_editado_por, 'medios_motivo', ci.medios_motivo,
      'valor_recogido_original', ci.valor_recogido_original, 'valor_recogido_editado_en', ci.valor_recogido_editado_en,
      'valor_recogido_editado_por', ci.valor_recogido_editado_por, 'valor_recogido_motivo', ci.valor_recogido_motivo,
      'recargo_aplicado', ci.recargo_aplicado, 'recargo_manual_original', ci.recargo_manual_original,
      'recargo_manual_editado_en', ci.recargo_manual_editado_en, 'recargo_manual_editado_por', ci.recargo_manual_editado_por,
      'recargo_manual_motivo', ci.recargo_manual_motivo,
      'pago_servicio', ci.pago_servicio, 'pago_servicio_original', ci.pago_servicio_original,
      'pago_servicio_editado_en', ci.pago_servicio_editado_en, 'pago_servicio_editado_por', ci.pago_servicio_editado_por,
      'pago_servicio_motivo', ci.pago_servicio_motivo))
      FILTER (WHERE ci.servicio_id IS NOT NULL), '{}'::jsonb)
    INTO v_lej_svcs, v_prev
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR';

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

  -- ── Recibos: UN recibo "contado" por servicio (regla migración 027) ────────
  FOR v_rec IN
    SELECT r.id AS recibo_id, r.servicio_id, r.fecha_emision, r.hora_emision,
           r.valor_cobrado, r.medios_pago,
           s.valor_transporte, s.ciudad_recogida, s.plan_id,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre,
           p.nombre AS plan_nombre
    FROM (
      -- El recibo "contado" del servicio: el más reciente CON dinero;
      -- si ninguno tiene dinero, el más reciente. Elegido entre TODOS los
      -- recibos del servicio (los demás son documentos, no cuentan plata).
      SELECT DISTINCT ON (rt.servicio_id) rt.*
      FROM public.recibos_tecnico rt
      CROSS JOIN LATERAL (
        SELECT COALESCE(
                 (SELECT SUM(mp.monto) FROM public.recibo_medios_pago mp WHERE mp.recibo_id = rt.id),
                 (SELECT SUM(NULLIF(e->>'monto','')::numeric)
                    FROM jsonb_array_elements(COALESCE(rt.medios_pago,'[]'::jsonb)) e),
                 0) AS cobrado
      ) mm
      ORDER BY rt.servicio_id, (mm.cobrado > 0) DESC, rt.created_at DESC
    ) r
    JOIN public.servicios s ON s.id = r.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE r.tecnico_id = p_tecnico_id
      AND s.fecha_ingreso BETWEEN p_desde AND p_hasta
      AND s.estado <> 'CANCELADO'
      -- El dinero del servicio ya se cuadró y CERRÓ (fila con recibo) → fuera.
      -- Filas sin_recibo/cancelado cerradas NO bloquean un cobro posterior.
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = r.servicio_id
          AND ci2.recibo_id IS NOT NULL
          AND c2.estado = 'CERRADO'
      )
    ORDER BY s.fecha_ingreso, r.hora_emision
  LOOP
    SELECT COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'EFECTIVO'), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) <> 'EFECTIVO'), 0),
           COUNT(*),
           COALESCE(jsonb_agg(jsonb_build_object('metodo', metodo, 'monto', monto)
                              ORDER BY created_at), '[]'::jsonb)
      INTO v_efectivo, v_digital, v_nmedios, v_medios
    FROM public.recibo_medios_pago
    WHERE recibo_id = v_rec.recibo_id;

    IF v_nmedios = 0 THEN
      SELECT COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') <> 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0)
        INTO v_efectivo, v_digital
      FROM jsonb_array_elements(COALESCE(v_rec.medios_pago, '[]'::jsonb)) elem;
      v_medios := COALESCE(v_rec.medios_pago, '[]'::jsonb);
    END IF;

    v_es_dom := extract(isodow FROM v_rec.fecha_emision) = 7;
    v_es_fes := EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = v_rec.fecha_emision);
    v_es_noc := v_rec.hora_emision IS NOT NULL AND v_rec.hora_emision >= TIME '18:00';
    v_es_lej := v_rec.servicio_id = ANY(v_lej_svcs);

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

    v_a_cobrar := COALESCE(v_rec.svc_valor_total, 0)
                  + CASE WHEN v_rec.svc_comdesc THEN v_rec.svc_comision ELSE 0 END;

    v_p := v_prev -> (v_rec.servicio_id::text);
    -- Vía: preserva la manual; si no, facturación mensual entra a Conciliaciones.
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_rec.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' END);

    -- Preserva las ediciones manuales del BORRADOR previo (la correccion del
    -- admin es autoritativa y no debe perderse al regenerar): reclasificacion de
    -- medios, valor recogido, recargo manual y pago al tecnico, por servicio.
    IF (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_medios := COALESCE(v_p->'medios_pago', v_medios);
    END IF;
    IF (v_p->>'valor_recogido_editado_en') IS NOT NULL
       OR (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_efectivo := COALESCE((v_p->>'efectivo')::numeric, v_efectivo);
      v_digital  := COALESCE((v_p->>'digital')::numeric, v_digital);
    END IF;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, v_pago);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      medios_pago_original, medios_editado_en, medios_editado_por, medios_motivo,
      valor_recogido_original, valor_recogido_editado_en, valor_recogido_editado_por, valor_recogido_motivo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre, v_vehiculo, v_rec.veterinaria, v_rec.svc_modalidad, v_rec.svc_comision,
      v_a_cobrar, COALESCE(v_rec.svc_valor_total, 0), v_rec.svc_valor_plan, v_rec.svc_valor_adic,
      v_efectivo + v_digital, v_efectivo, v_digital, v_medios,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_es_lej, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false),
      v_p->'medios_pago_original', (v_p->>'medios_editado_en')::timestamptz, (v_p->>'medios_editado_por')::uuid, NULLIF(v_p->>'medios_motivo',''),
      (v_p->>'valor_recogido_original')::numeric, (v_p->>'valor_recogido_editado_en')::timestamptz, (v_p->>'valor_recogido_editado_por')::uuid, NULLIF(v_p->>'valor_recogido_motivo',''),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );

    v_n              := v_n + 1;
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital;
    v_tot_efectivo   := v_tot_efectivo   + v_efectivo;
    v_tot_digital    := v_tot_digital    + v_digital;
    v_tot_transporte := v_tot_transporte + v_transporte;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
    v_tot_pago       := v_tot_pago       + v_pago;
  END LOOP;

  -- ── Servicios recogidos por el técnico SIN recibo (no cobró) ──────────────
  FOR v_sr IN
    SELECT s.id AS servicio_id, s.fecha_ingreso, s.ciudad_recogida, s.plan_id,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre, p.nombre AS plan_nombre
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE s.estado <> 'CANCELADO'
      AND s.fecha_ingreso BETWEEN p_desde AND p_hasta
      AND COALESCE(
            (SELECT rg.tecnico_id FROM public.recogidas rg
               WHERE rg.servicio_id = s.id AND rg.tecnico_id IS NOT NULL
               ORDER BY rg.id DESC LIMIT 1),
            s.tecnico_id
          ) = p_tecnico_id
      -- sin NINGÚN recibo (si tuviera, lo maneja el loop de recibos arriba)
      AND NOT EXISTS (
        SELECT 1 FROM public.recibos_tecnico r WHERE r.servicio_id = s.id
      )
      -- no incluido ya en un cuadre CERRADO
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = s.id AND c2.estado = 'CERRADO'
      )
    ORDER BY s.fecha_ingreso
  LOOP
    v_a_cobrar := COALESCE(v_sr.svc_valor_total, 0)
                  + CASE WHEN v_sr.svc_comdesc THEN v_sr.svc_comision ELSE 0 END;
    v_p := v_prev -> (v_sr.servicio_id::text);
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_sr.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' ELSE 'LLAMAR_COBRAR' END);

    -- Sin recibo no hay hora ni fecha de emisión: los recargos automáticos no
    -- aplican, pero la lejanía marcada a mano y las correcciones manuales del
    -- coordinador sí se conservan al regenerar (067).
    v_es_lej  := v_sr.servicio_id = ANY(v_lej_svcs);
    v_recargo := CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;
    v_pago := 0;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, 0);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta, sin_recibo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_sr.servicio_id, NULL, v_sr.fecha_ingreso, NULL,
      v_sr.mascota_nombre, v_sr.ciudad_recogida, v_sr.plan_nombre, v_vehiculo, v_sr.veterinaria, v_sr.svc_modalidad, v_sr.svc_comision,
      v_a_cobrar, COALESCE(v_sr.svc_valor_total, 0), v_sr.svc_valor_plan, v_sr.svc_valor_adic,
      0, 0, 0, '[]'::jsonb,
      0, false,
      false, false, false, v_es_lej, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false), true,
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );
    v_n            := v_n + 1;
    v_tot_recargos := v_tot_recargos + v_recargo;
    v_tot_pago     := v_tot_pago     + v_pago;
  END LOOP;

  -- ── Servicios CANCELADOS con el técnico ya despachado (viaje perdido) ─────
  -- Entran SIEMPRE (aunque la tarifa esté en 0): el coordinador decide cuánto
  -- reconocer con el lápiz de "Pago téc." y el de recargo (067).
  FOR v_can IN
    SELECT s.id AS servicio_id, s.cancelado_en, s.ciudad_recogida,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre, p.nombre AS plan_nombre
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
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
    v_a_cobrar := COALESCE(v_can.svc_valor_total, 0)
                  + CASE WHEN v_can.svc_comdesc THEN v_can.svc_comision ELSE 0 END;
    v_p := v_prev -> (v_can.servicio_id::text);
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_can.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' END);

    -- Pago del viaje perdido: tarifa fija, salvo corrección manual del cuadre.
    v_pago := v_tarifa_can;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, v_tarifa_can);
    END IF;
    -- Lejanía marcada a mano y recargo manual (el cancelado no tiene recibo del
    -- que deducir dominical/festivo/nocturno).
    v_es_lej  := v_can.servicio_id = ANY(v_lej_svcs);
    v_recargo := CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_can.servicio_id, NULL, v_can.cancelado_en::date, NULL,
      v_can.mascota_nombre, v_can.ciudad_recogida, v_can.plan_nombre, v_vehiculo, v_can.veterinaria, v_can.svc_modalidad, v_can.svc_comision,
      v_a_cobrar, COALESCE(v_can.svc_valor_total, 0), v_can.svc_valor_plan, v_can.svc_valor_adic,
      0, 0, 0, '[]'::jsonb,
      0, false,
      false, false, false, v_es_lej, v_recargo, v_pago, true,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );
    v_n              := v_n + 1;
    v_tot_cancelados := v_tot_cancelados + v_pago;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
  END LOOP;

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
$function$;

NOTIFY pgrst, 'reload schema';
