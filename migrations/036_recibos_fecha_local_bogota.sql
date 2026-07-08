-- ============================================================================
-- 036 — fecha_emision de recibos en hora LOCAL de Bogotá (bug UTC +1 día)
--
-- BUG: el frontend fechaba el recibo con new Date().toISOString() (fecha UTC).
-- Colombia es UTC-5 → todo recibo emitido después de las 7:00 p.m. quedaba con
-- fecha_emision del día SIGUIENTE, mientras hora_emision sí era local (par
-- inconsistente: "2026-07-06 · 19:19" para un cobro del domingo 05 a las 7:19 pm).
--
-- Daños reales:
--   1. La bitácora del técnico muestra el servicio en el día equivocado
--      (caso SHEILA d1421d43: recogida del DOMINGO 2026-07-05 mostrada el lunes).
--   2. El cuadre calcula dominical/festivo con fecha_emision → el recargo se
--      PIERDE cuando el día real era domingo o festivo (73 recibos corridos;
--      15 con dominical/festivo perdido). Ningún recibo afectado está en un
--      cuadre CERRADO (verificado 2026-07-08) → se corrige regenerando BORRADOR.
--
-- Fix en dos frentes:
--   A. Backfill: fecha_emision = fecha real en Bogotá derivada de created_at
--      (timestamptz del servidor, fuente confiable). Solo filas con la firma
--      exacta del bug (corridas +1 día).
--   B. guardar_recibo_tecnico v3: la fecha de emisión la pone el SERVIDOR en
--      hora Bogotá e ignora p_fecha_emision — protege contra bundles PWA viejos
--      en caché y relojes de celular descuadrados.
--
-- El frontend también se corrigió (hoyLocalISO en TecnicoApp), pero la defensa
-- real queda en la DB. Después de aplicar: REGENERAR los cuadres BORRADOR
-- activos desde Finanzas para que tomen los recargos correctos.
-- ============================================================================

BEGIN;

-- ── A. Backfill: reporte de lo que se corrige (sale en la salida de psql) ────
SELECT r.id, r.servicio_id, r.fecha_emision AS fecha_mal,
       (r.created_at AT TIME ZONE 'America/Bogota')::date AS fecha_real,
       to_char(r.created_at AT TIME ZONE 'America/Bogota', 'Dy') AS dia_real,
       r.hora_emision, r.valor_cobrado
FROM public.recibos_tecnico r
WHERE r.fecha_emision = ((r.created_at AT TIME ZONE 'America/Bogota')::date + 1)
ORDER BY r.created_at;

UPDATE public.recibos_tecnico r
SET fecha_emision = (r.created_at AT TIME ZONE 'America/Bogota')::date
WHERE r.fecha_emision = ((r.created_at AT TIME ZONE 'America/Bogota')::date + 1);

-- ── B. guardar_recibo_tecnico v3 — fecha/hora de emisión del servidor ────────
-- (Sobre la v2 de la migración 027: idéntica salvo que fecha_emision y
--  hora_emision ya no confían en el cliente.)
CREATE OR REPLACE FUNCTION public.guardar_recibo_tecnico(
  p_servicio_id            uuid,
  p_idempotency_key        uuid,
  p_tipo                   text,
  p_numero_recibo          text,
  p_fecha_emision          date,
  p_hora_emision           text,
  p_valor_total            numeric,
  p_medios                 jsonb,
  p_datos_form             jsonb,
  p_pago_pendiente         boolean DEFAULT false,
  p_es_facturacion_mensual boolean DEFAULT false,
  p_actor_id               uuid    DEFAULT NULL,
  p_actor_rol              text    DEFAULT NULL,
  p_comision_aliado        numeric DEFAULT NULL,
  p_novedad_pago           text    DEFAULT NULL,
  p_novedad_nota           text    DEFAULT NULL
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
  v_prev_aplicado   numeric := 0;
  v_nuevo_pagado    numeric;
  v_nuevo_estado    text;
  v_medio           jsonb;
  v_medio_id        uuid;
  v_medios_out      jsonb := '[]'::jsonb;
  v_idx             int := 0;
  v_metodos_txt     text;
  v_fecha_local     date;
  v_hora_local      time;
BEGIN
  IF p_servicio_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio_id e idempotency_key son obligatorios';
  END IF;

  -- ── Fecha/hora de emisión: SIEMPRE del servidor, en hora de Bogotá ─────────
  -- p_fecha_emision se ignora a propósito: los bundles PWA viejos mandaban la
  -- fecha UTC (corrida +1 día después de las 7 p.m.) y un celular con el reloj
  -- malo haría lo mismo. La emisión es "ahora" por diseño (el recibo se genera
  -- en el momento del cobro). La hora sí respeta la del dispositivo si viene
  -- (es la que el técnico ve en su recibo); si no, la del servidor.
  v_fecha_local := (now() AT TIME ZONE 'America/Bogota')::date;
  v_hora_local  := COALESCE(NULLIF(p_hora_emision,'')::time,
                            (now() AT TIME ZONE 'America/Bogota')::time);

  -- ── Idempotencia: si ya existe un recibo con esta clave, NO repetir efectos ──
  SELECT id INTO v_recibo_id
  FROM public.recibos_tecnico
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
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

  IF NOT p_pago_pendiente AND NOT p_es_facturacion_mensual
     AND COALESCE(p_valor_total,0) > 0 AND v_total_medios > p_valor_total + 1 THEN
    RAISE EXCEPTION 'SOBREPAGO: el total cobrado (%) supera el valor del recibo (%)', v_total_medios, p_valor_total;
  END IF;

  v_valor_cobrado := CASE WHEN p_pago_pendiente THEN 0 ELSE v_total_medios END;

  -- ── INSERT recibo (atómico con todo lo demás) ───────────────────────────────
  INSERT INTO public.recibos_tecnico (
    servicio_id, tecnico_id, numero_recibo, tipo,
    fecha_emision, hora_emision, valor_total, valor_cobrado,
    medios_pago, datos_form, estado, idempotency_key
  ) VALUES (
    p_servicio_id, v_tecnico_final, p_numero_recibo, p_tipo,
    v_fecha_local, v_hora_local, p_valor_total, v_valor_cobrado,
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
    -- El dinero de un servicio cuenta UNA sola vez (migración 027): si otro
    -- recibo del servicio ya había sumado a valor_pagado (regeneración o doble
    -- documento CLIENTE+VET del mismo cobro), ese aporte se RESTA primero.
    -- El caso "cobro repartido en dos recibos del técnico" no existe en la
    -- operación (el saldo restante lo gestiona el coordinador en Cartera).
    SELECT COALESCE(SUM(pago_aplicado), 0) INTO v_prev_aplicado
    FROM public.recibos_tecnico
    WHERE servicio_id = p_servicio_id AND id <> v_recibo_id AND pago_aplicado > 0;

    v_nuevo_pagado := GREATEST(v_valor_pagado - v_prev_aplicado, 0) + v_total_medios;
    v_nuevo_estado := CASE WHEN v_nuevo_pagado >= v_valor_total_svc THEN 'COMPLETO' ELSE 'PARCIAL' END;

    IF v_prev_aplicado > 0 THEN
      UPDATE public.recibos_tecnico
         SET pago_aplicado = 0
       WHERE servicio_id = p_servicio_id AND id <> v_recibo_id AND pago_aplicado > 0;
    END IF;
    UPDATE public.recibos_tecnico
       SET pago_aplicado = v_total_medios
     WHERE id = v_recibo_id;

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
            COALESCE(p_novedad_pago, 'Técnico recibió pago por ' || v_total_medios::text)
            || CASE WHEN v_prev_aplicado > 0
                    THEN ' (reemplaza el pago de un recibo anterior de este servicio: el cobro no se suma dos veces)'
                    ELSE '' END,
            v_total_medios, p_actor_id);
    v_pago_registrado := true;
  END IF;

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

COMMIT;

-- Verificación post-aplicación (debe dar 0):
-- SELECT count(*) FROM recibos_tecnico
-- WHERE fecha_emision = ((created_at AT TIME ZONE 'America/Bogota')::date + 1);
