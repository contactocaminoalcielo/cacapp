-- ============================================================================
-- RPC transaccional: guardar_recibo_tecnico
-- Fecha: 2026-06-16
--
-- Reemplaza la secuencia frágil del front (insert recibo → update servicio →
-- insert novedad, sin transacción) por una sola operación atómica e idempotente.
--
-- Garantías:
--   - Atómica: o se guarda todo (recibo + medios + servicio + novedad) o nada.
--   - Idempotente: doble-click / reintento / reinicio con la MISMA
--     p_idempotency_key NO duplica recibo, ni vuelve a sumar el pago al servicio.
--   - valor_cobrado = SUMA REAL de los medios de pago (no el saldo asumido).
--   - tecnico_id se toma de recogidas.tecnico_id (cae a servicios.tecnico_id).
--   - Valida: servicio no CANCELADO, montos no negativos, no sobrepago.
--   - Permite pago parcial.
--
-- Requiere: la migración 2026-06-16_recibos_tecnico_robustez.sql ya aplicada.
-- Aplicar por SSH:
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < este_archivo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guardar_recibo_tecnico(
  p_servicio_id            uuid,
  p_idempotency_key        uuid,
  p_tipo                   text,
  p_numero_recibo          text,
  p_fecha_emision          date,
  p_hora_emision           text,
  p_valor_total            numeric,
  p_medios                 jsonb,         -- [{ metodo, monto, referencia, comprobanteUrl? }]
  p_datos_form             jsonb,
  p_pago_pendiente         boolean DEFAULT false,
  p_es_facturacion_mensual boolean DEFAULT false,
  p_actor_id               uuid    DEFAULT NULL,   -- personal.id del que opera (técnico/coord)
  p_actor_rol              text    DEFAULT NULL,   -- 'TECNICO' | 'COORDINADOR' | 'ADMIN' | ...
  p_comision_aliado        numeric DEFAULT NULL,   -- corrección FACTURACION_MENSUAL (comision=0 en DB)
  p_novedad_pago           text    DEFAULT NULL,   -- texto detallado del pago (lo arma el front)
  p_novedad_nota           text    DEFAULT NULL    -- texto NOTA (facturación mensual / pago pendiente / comprobante pendiente)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado          text;
  v_valor_total_svc numeric;
  v_valor_pagado    numeric;
  v_tecnico_svc     uuid;
  v_tecnico_recog   uuid;
  v_tecnico_final   uuid;
  v_saldo           numeric;
  v_total_medios    numeric := 0;
  v_min_monto       numeric;
  v_valor_cobrado   numeric;
  v_recibo_id       uuid;
  v_ya_existia      boolean := false;
  v_pago_registrado boolean := false;
  v_nuevo_pagado    numeric;
  v_nuevo_estado    text;
  v_medio           jsonb;
  v_medio_id        uuid;
  v_medios_out      jsonb := '[]'::jsonb;
  v_idx             int := 0;
  v_metodos_txt     text;
BEGIN
  IF p_servicio_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio_id e idempotency_key son obligatorios';
  END IF;

  -- ── Idempotencia: si ya existe un recibo con esta clave, NO repetir efectos ──
  SELECT id INTO v_recibo_id
  FROM public.recibos_tecnico
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Reintento/doble-click: devolvemos el recibo y sus medios sin re-aplicar pago.
    SELECT jsonb_agg(jsonb_build_object('id', id, 'metodo', metodo, 'monto', monto) ORDER BY created_at)
      INTO v_medios_out
    FROM public.recibo_medios_pago WHERE recibo_id = v_recibo_id;
    RETURN jsonb_build_object(
      'recibo_id', v_recibo_id,
      'ya_existia', true,
      'pago_registrado', false,
      'medios', COALESCE(v_medios_out, '[]'::jsonb)
    );
  END IF;

  -- ── Bloqueo + validación del servicio ──────────────────────────────────────
  SELECT estado, COALESCE(valor_total,0), COALESCE(valor_pagado,0), tecnico_id
    INTO v_estado, v_valor_total_svc, v_valor_pagado, v_tecnico_svc
  FROM public.servicios
  WHERE id = p_servicio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICIO_NO_EXISTE: %', p_servicio_id;
  END IF;
  IF v_estado = 'CANCELADO' THEN
    RAISE EXCEPTION 'SERVICIO_CANCELADO: este servicio fue cancelado; no admite recibos nuevos';
  END IF;

  -- ── Técnico real: recogidas.tecnico_id manda sobre servicios.tecnico_id ─────
  SELECT tecnico_id INTO v_tecnico_recog
  FROM public.recogidas
  WHERE servicio_id = p_servicio_id AND tecnico_id IS NOT NULL
  ORDER BY id DESC
  LIMIT 1;

  v_tecnico_final := COALESCE(v_tecnico_recog, v_tecnico_svc, p_actor_id);

  -- ── Autorización: técnico solo sobre servicios donde está asignado ──────────
  -- Coordinador/Admin pasan siempre. (Defensa a nivel de datos; la RLS estricta
  -- por auth.uid() está preparada aparte y requiere backfill de auth_user_id.)
  IF p_actor_rol IS NOT NULL AND p_actor_rol NOT IN ('COORDINADOR','ADMIN') THEN
    IF p_actor_id IS NULL
       OR (v_tecnico_recog IS NOT NULL AND p_actor_id <> v_tecnico_recog)
       OR (v_tecnico_recog IS NULL AND v_tecnico_svc IS NOT NULL AND p_actor_id <> v_tecnico_svc) THEN
      RAISE EXCEPTION 'NO_AUTORIZADO: el técnico no está asignado a la recogida de este servicio';
    END IF;
  END IF;

  -- ── Validación de medios de pago ───────────────────────────────────────────
  IF p_medios IS NOT NULL AND jsonb_typeof(p_medios) = 'array' THEN
    SELECT COALESCE(SUM(NULLIF(elem->>'monto','')::numeric), 0),
           MIN(NULLIF(elem->>'monto','')::numeric)
      INTO v_total_medios, v_min_monto
    FROM jsonb_array_elements(p_medios) AS elem;
  END IF;
  v_total_medios := COALESCE(v_total_medios, 0);

  IF v_min_monto IS NOT NULL AND v_min_monto < 0 THEN
    RAISE EXCEPTION 'MONTO_NEGATIVO: ningún medio de pago puede ser negativo';
  END IF;

  v_saldo := v_valor_total_svc - v_valor_pagado;

  -- Sobrepago: el tope es el valor del PROPIO recibo (p_valor_total), NO el saldo
  -- del servicio. Comparar contra el saldo rompería el caso legítimo
  -- comision_descontada=true (CLIENTE paga el bruto precioOriginal > valor_total
  -- neto). Aquí solo se atrapa el error grueso de digitar de más en un recibo.
  -- Tolerancia de 1 por redondeo. No aplica a pago pendiente / facturación mensual.
  IF NOT p_pago_pendiente AND NOT p_es_facturacion_mensual
     AND COALESCE(p_valor_total,0) > 0 AND v_total_medios > p_valor_total + 1 THEN
    RAISE EXCEPTION 'SOBREPAGO: el total cobrado (%) supera el valor del recibo (%)', v_total_medios, p_valor_total;
  END IF;

  -- valor_cobrado = suma real de los medios (no el saldo asumido). Fix #4.
  v_valor_cobrado := CASE WHEN p_pago_pendiente THEN 0 ELSE v_total_medios END;

  -- ── INSERT recibo (atómico con todo lo demás) ───────────────────────────────
  INSERT INTO public.recibos_tecnico (
    servicio_id, tecnico_id, numero_recibo, tipo,
    fecha_emision, hora_emision, valor_total, valor_cobrado,
    medios_pago, datos_form, estado, idempotency_key
  ) VALUES (
    p_servicio_id, v_tecnico_final, p_numero_recibo, p_tipo,
    p_fecha_emision, p_hora_emision, p_valor_total, v_valor_cobrado,
    -- medios_pago jsonb se conserva SOLO por compatibilidad con vistas/Finanzas actuales
    CASE WHEN p_pago_pendiente THEN '[]'::jsonb ELSE COALESCE(p_medios,'[]'::jsonb) END,
    COALESCE(p_datos_form,'{}'::jsonb) || jsonb_build_object('pago_pendiente', p_pago_pendiente),
    'GUARDADO', p_idempotency_key
  )
  RETURNING id INTO v_recibo_id;

  -- ── INSERT medios formales (fuente de verdad nueva) ─────────────────────────
  IF NOT p_pago_pendiente AND p_medios IS NOT NULL AND jsonb_typeof(p_medios) = 'array' THEN
    FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios)
    LOOP
      INSERT INTO public.recibo_medios_pago (recibo_id, servicio_id, metodo, monto, referencia)
      VALUES (
        v_recibo_id, p_servicio_id,
        COALESCE(v_medio->>'metodo','OTRO'),
        COALESCE(NULLIF(v_medio->>'monto','')::numeric, 0),
        NULLIF(v_medio->>'referencia','')
      )
      RETURNING id INTO v_medio_id;

      -- Si el medio ya traía comprobante subido (caso: subió ANTES de guardar),
      -- lo registramos en la tabla formal ligado por medio_pago_id (no por índice).
      IF COALESCE(v_medio->>'comprobanteUrl','') <> '' THEN
        INSERT INTO public.recibo_comprobantes (
          recibo_id, medio_pago_id, servicio_id, bucket, storage_path, estado, uploaded_by
        ) VALUES (
          v_recibo_id, v_medio_id, p_servicio_id, 'evidencias',
          v_medio->>'comprobanteUrl', 'PENDIENTE_REVISION', p_actor_id
        );
      END IF;

      v_medios_out := v_medios_out || jsonb_build_object(
        'idx', v_idx, 'id', v_medio_id,
        'metodo', COALESCE(v_medio->>'metodo','OTRO'),
        'monto', COALESCE(NULLIF(v_medio->>'monto','')::numeric, 0)
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- ── Efectos sobre el servicio + novedad (una sola vez por recibo nuevo) ─────
  IF p_pago_pendiente THEN
    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, registrado_por)
    VALUES (p_servicio_id, 'NOTA',
            COALESCE(p_novedad_nota, 'Recibo generado con pago pendiente. No. ' || p_numero_recibo),
            p_actor_id);

  ELSIF p_es_facturacion_mensual THEN
    IF p_comision_aliado IS NOT NULL AND p_comision_aliado > 0 THEN
      UPDATE public.servicios
         SET comision_aliado = p_comision_aliado
       WHERE id = p_servicio_id AND COALESCE(comision_aliado,0) <= 0;
    END IF;
    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, registrado_por)
    VALUES (p_servicio_id, 'NOTA',
            COALESCE(p_novedad_nota, 'Recibo VET generado — queda PENDIENTE para facturación mensual. No. ' || p_numero_recibo),
            p_actor_id);

  ELSIF v_total_medios > 0 THEN
    v_nuevo_pagado := v_valor_pagado + v_total_medios;
    v_nuevo_estado := CASE WHEN v_nuevo_pagado >= v_valor_total_svc THEN 'COMPLETO' ELSE 'PARCIAL' END;

    SELECT string_agg(elem->>'metodo', ', ')
      INTO v_metodos_txt
    FROM jsonb_array_elements(p_medios) AS elem;

    UPDATE public.servicios
       SET valor_pagado = v_nuevo_pagado,
           estado_pago  = v_nuevo_estado,
           metodo_pago  = v_metodos_txt
     WHERE id = p_servicio_id;

    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
    VALUES (p_servicio_id, 'PAGO_RECIBIDO',
            COALESCE(p_novedad_pago, 'Técnico recibió pago por ' || v_total_medios::text),
            v_total_medios, p_actor_id);
    v_pago_registrado := true;
  END IF;

  -- Rastro de comprobante pendiente para el coordinador (lo decide el front via p_novedad_nota).
  IF NOT p_pago_pendiente AND NOT p_es_facturacion_mensual
     AND p_novedad_nota IS NOT NULL AND p_novedad_nota <> '' THEN
    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, registrado_por)
    VALUES (p_servicio_id, 'NOTA', p_novedad_nota, p_actor_id);
  END IF;

  RETURN jsonb_build_object(
    'recibo_id', v_recibo_id,
    'ya_existia', false,
    'pago_registrado', v_pago_registrado,
    'tecnico_id', v_tecnico_final,
    'valor_cobrado', v_valor_cobrado,
    'medios', v_medios_out
  );
END;
$$;

-- PostgREST: exponer la RPC a los roles de la app.
GRANT EXECUTE ON FUNCTION public.guardar_recibo_tecnico(
  uuid, uuid, text, text, date, text, numeric, jsonb, jsonb,
  boolean, boolean, uuid, text, numeric, text, text
) TO authenticated, service_role;
