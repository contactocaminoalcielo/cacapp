-- 224 · Recibo del técnico: un medio en $0 no se guarda, y si el servicio
--       debe plata y no se cobró nada, el recibo queda como PAGO PENDIENTE.
--
-- Pregunta de David (25-nov-2026): «¿un recibo en 0 se marca solo como
-- efectivo?». Sí: el formulario arranca con un medio EFECTIVO prellenado con el
-- saldo; si el saldo es $0 queda «EFECTIVO $0», la app solo rechaza medios en
-- cero cuando el total es > 0, y esta RPC guardaba la línea tal cual en
-- recibo_medios_pago y en el jsonb. En prod: 12 recibos (jul–oct 2026), 11
-- EFECTIVO $0 + 1 NEQUI $0; 9 todo en cero, 3 con la línea de sobra al lado de
-- un pago real. Ninguno debía plata (saldo 0 hoy), así que no movía dinero,
-- pero el recibo decía EFECTIVO donde no se cobró nada.
--
-- Qué cambia en guardar_recibo_tecnico (copia de la 191, solo estos puntos):
--   1. Los medios con monto <= 0 no se guardan (ni en recibo_medios_pago, ni en
--      el jsonb, ni en servicios.metodo_pago). El `idx` de la respuesta sigue
--      siendo la posición en el arreglo que mandó la app, para que el anclaje
--      de comprobantes (medioPagoId) no se corra.
--   2. Si NO es facturación mensual, NO vino marcado pago pendiente, no se cobró
--      nada (ni medios ni cruce) y el servicio DEBE plata (saldo > 1) → el
--      recibo se guarda como PAGO PENDIENTE (David: «el técnico no recogió
--      dinero, por eso está en 0»). Motivo «OTRO» con detalle automático y
--      marca `pago_pendiente_auto`. La app nueva ya lo hace antes de llegar
--      aquí (pide el motivo); esto cubre las PWA viejas en caché.
--   Si el saldo es 0 (servicio ya pagado o de valor $0) NO es pago pendiente:
--   el recibo queda sin medios, que es lo que pasó.
--
--   Excepción en ambos puntos: una línea sin monto pero CON comprobante adjunto
--   se conserva (es evidencia de un pago; en jun-2026 hubo TRANSFERENCIA ""
--   con su foto) y no dispara el pago pendiente automático.
--
-- Backfill: quita las líneas en $0 SIN comprobante de la tabla (12 recibos,
-- ninguna con comprobante colgado; verificado) y del jsonb (27 recibos, 15 de
-- ellos de jun-2026, anteriores a la tabla). Novedad de auditoría por recibo.
-- Los cuadres CERRADOS conservan su snapshot; los BORRADOR se corrigen al
-- regenerarlos (en todo caso la línea sumaba $0).

BEGIN;

CREATE OR REPLACE FUNCTION public.guardar_recibo_tecnico(p_servicio_id uuid, p_idempotency_key uuid, p_tipo text, p_numero_recibo text, p_fecha_emision date, p_hora_emision text, p_valor_total numeric, p_medios jsonb, p_datos_form jsonb, p_pago_pendiente boolean DEFAULT false, p_es_facturacion_mensual boolean DEFAULT false, p_actor_id uuid DEFAULT NULL::uuid, p_actor_rol text DEFAULT NULL::text, p_comision_aliado numeric DEFAULT NULL::numeric, p_novedad_pago text DEFAULT NULL::text, p_novedad_nota text DEFAULT NULL::text, p_sobrepago_motivo text DEFAULT NULL::text, p_comisiones_pagadas jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_sobrepago       numeric := 0;
  v_es_fm           boolean := false;
  -- Cruce de comisiones viejas dentro de este recibo (migr. 166)
  v_com             jsonb;
  v_com_svc         uuid;
  v_com_monto       numeric;
  v_com_pend        numeric;
  v_com_mascota     text;
  v_cruce_total     numeric := 0;
  v_cruce_detalle   text    := '';
  v_aliado_id       uuid;
  v_aliado_mod      text;
  -- migr. 224
  v_ord             int;
  v_medios_ok       jsonb := '[]'::jsonb;
  v_pp_auto         boolean := false;
BEGIN
  -- 🔒 migr. 191 (RBAC-002): el actor y su rol salen de la sesión. Así la
  -- validación de abajo (técnico de la recogida o del servicio) no se salta
  -- declarando p_actor_rol = 'ADMIN' o NULL.
  IF coalesce(auth.jwt() ->> 'role', '') = 'authenticated' THEN
    p_actor_id := public.mi_personal_id();
    p_actor_rol := public.mi_rol();
    IF p_actor_id IS NULL THEN
      RAISE EXCEPTION 'Usuario sin personal activo' USING ERRCODE = '42501';
    END IF;
  END IF;
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

  -- ── Facturación mensual: el técnico NO recibe dinero (migración 068) ────────
  -- Se DERIVA del aliado del servicio y no solo del flag que manda la app: los
  -- bundles PWA viejos en caché siguen prellenando el medio de pago con el
  -- valor del servicio, y así quedaban recibos con EFECTIVO que nadie recogió.
  SELECT COALESCE(a.modalidad_comision = 'FACTURACION_MENSUAL', false)
    INTO v_es_fm
  FROM public.servicios s
  LEFT JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
  WHERE s.id = p_servicio_id;
  v_es_fm := COALESCE(v_es_fm, false) OR COALESCE(p_es_facturacion_mensual, false);

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
  -- Facturación mensual: no hay cobro ahora (el aliado paga por factura al
  -- cierre del mes) → el recibo es constancia del servicio, con recogido 0.
  IF v_es_fm THEN v_total_medios := 0; END IF;

  IF v_min_monto IS NOT NULL AND v_min_monto < 0 THEN
    RAISE EXCEPTION 'MONTO_NEGATIVO: ningún medio de pago puede ser negativo';
  END IF;

  -- ── Un medio en $0 no es un cobro: no se guarda (migr. 224) ─────────────────
  -- El formulario arranca con EFECTIVO prellenado con el saldo; con saldo $0
  -- quedaba «EFECTIVO $0» y el recibo decía efectivo donde no se cobró nada.
  IF p_medios IS NOT NULL AND jsonb_typeof(p_medios) = 'array' THEN
    SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb)
      INTO v_medios_ok
    FROM jsonb_array_elements(p_medios) WITH ORDINALITY AS t(e, o)
    -- Con comprobante adjunto se conserva aunque venga sin monto: es evidencia
    -- de un pago (pasó en jun-2026) y coordinación tiene que verla.
    WHERE COALESCE(NULLIF(e->>'monto','')::numeric, 0) > 0
       OR COALESCE(e->>'comprobanteUrl','') <> '';
  END IF;

  v_saldo := v_valor_total_svc - v_valor_pagado;

  -- ── Comisiones viejas que la vet pide cobrar en este recibo (migr. 166) ────
  -- La veterinaria paga hoy MENOS lo que Camino le debe de comisiones de
  -- servicios anteriores. Esa plata no entra por ninguna parte: se cruza. Por
  -- eso viaja como un medio propio ('CRUCE_COMISION') y NO como "recogio de
  -- menos": si se registrara asi, el servicio de hoy quedaria PARCIAL con un
  -- saldo que nadie debe y el cuadre le marcaria al tecnico ese mismo faltante.
  IF p_comisiones_pagadas IS NOT NULL
     AND jsonb_typeof(p_comisiones_pagadas) = 'array'
     AND jsonb_array_length(p_comisiones_pagadas) > 0
     AND NOT p_pago_pendiente AND NOT v_es_fm THEN

    SELECT s.aliado_origen_id INTO v_aliado_id
    FROM public.servicios s WHERE s.id = p_servicio_id;
    IF v_aliado_id IS NULL THEN
      RAISE EXCEPTION 'CRUCE_SIN_ALIADO: este servicio no tiene veterinaria; no hay comision que cruzar';
    END IF;
    SELECT a.modalidad_comision INTO v_aliado_mod
    FROM public.aliados a WHERE a.id_aliado = v_aliado_id;

    FOR v_com IN SELECT * FROM jsonb_array_elements(p_comisiones_pagadas)
    LOOP
      v_com_svc   := NULLIF(v_com->>'servicio_id','')::uuid;
      v_com_monto := round(COALESCE(NULLIF(v_com->>'monto','')::numeric, 0));

      IF v_com_svc IS NULL OR v_com_monto <= 0 THEN
        RAISE EXCEPTION 'CRUCE_INVALIDO: cada comision necesita servicio y monto mayor que cero';
      END IF;
      IF v_com_svc = p_servicio_id THEN
        RAISE EXCEPTION 'CRUCE_INVALIDO: la comision de este mismo servicio no se cruza consigo misma';
      END IF;

      -- Solo comisiones VIVAS y de LA MISMA veterinaria: una comision ya
      -- descontada al registrar el servicio no se vuelve a pagar.
      SELECT COALESCE(s.comision_aliado,0) - COALESCE(s.comision_pagada,0), m.nombre
        INTO v_com_pend, v_com_mascota
      FROM public.servicios s
      LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
      WHERE s.id = v_com_svc
        AND s.aliado_origen_id = v_aliado_id
        AND s.comision_descontada IS NOT TRUE
        AND s.estado <> 'CANCELADO'
      FOR UPDATE OF s;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CRUCE_INVALIDO: el servicio % no tiene comision pendiente con esta veterinaria', v_com_svc;
      END IF;
      IF v_com_monto > v_com_pend THEN
        RAISE EXCEPTION 'CRUCE_EXCEDE_PENDIENTE: se intento pagar % de una comision con % pendiente', v_com_monto, v_com_pend;
      END IF;

      v_cruce_total   := v_cruce_total + v_com_monto;
      v_cruce_detalle := v_cruce_detalle
        || CASE WHEN v_cruce_detalle = '' THEN '' ELSE ', ' END
        || COALESCE(v_com_mascota, 'servicio') || ' ' || v_com_monto::bigint::text;
    END LOOP;

    -- Nunca se cruza mas de lo que la veterinaria debe hoy: el resto de la
    -- comision sigue pendiente y se le paga en el proximo servicio.
    IF v_total_medios + v_cruce_total > GREATEST(v_saldo, 0) + 1 THEN
      RAISE EXCEPTION 'CRUCE_EXCEDE_COBRO: el cruce (%) mas lo cobrado (%) supera lo que la veterinaria debe hoy (%)',
        v_cruce_total, v_total_medios, GREATEST(v_saldo, 0);
    END IF;

    v_total_medios := v_total_medios + v_cruce_total;
  END IF;

  -- ── Sin cobro y con saldo → PAGO PENDIENTE (migr. 224) ──────────────────────
  -- El técnico no recogió nada y el servicio debe plata: eso es un pago
  -- pendiente, no un recibo «pagado» en $0. La app nueva lo marca antes (y pide
  -- el motivo); esto cubre las PWA viejas. Con saldo 0 (ya pagado o de valor
  -- $0) no aplica: nadie debe nada. Si viene un comprobante adjunto tampoco:
  -- alguien pagó y faltó escribir el monto; se guarda tal cual para revisarlo.
  IF NOT p_pago_pendiente AND NOT v_es_fm
     AND v_total_medios <= 0 AND v_saldo > 1
     AND jsonb_array_length(v_medios_ok) = 0 THEN
    p_pago_pendiente := true;
    v_pp_auto        := true;
  END IF;

  -- ── Sobrepago: permitido SOLO con motivo explícito (migración 041) ──────────
  IF NOT p_pago_pendiente AND NOT v_es_fm
     AND COALESCE(p_valor_total,0) > 0 AND v_total_medios > p_valor_total + 1 THEN
    IF COALESCE(TRIM(p_sobrepago_motivo), '') = '' THEN
      RAISE EXCEPTION 'SOBREPAGO: el total cobrado (%) supera el valor del recibo (%)', v_total_medios, p_valor_total;
    END IF;
    v_sobrepago := v_total_medios - p_valor_total;
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
    CASE WHEN p_pago_pendiente OR v_es_fm THEN '[]'::jsonb
         ELSE v_medios_ok
              || CASE WHEN v_cruce_total > 0
                      THEN jsonb_build_array(jsonb_build_object(
                             'metodo', 'CRUCE_COMISION', 'monto', v_cruce_total,
                             'referencia', v_cruce_detalle))
                      ELSE '[]'::jsonb END
    END,
    COALESCE(p_datos_form,'{}'::jsonb)
      || jsonb_build_object('pago_pendiente', p_pago_pendiente, 'facturacion_mensual', v_es_fm)
      -- El snapshot del formulario también viaja con el valor prellenado; si no
      -- se normaliza, el PDF del recibo cae a él y sigue diciendo que se cobró.
      || CASE WHEN v_es_fm THEN jsonb_build_object('total_recibido', 0) ELSE '{}'::jsonb END
      || CASE WHEN v_pp_auto
              THEN jsonb_build_object(
                     'total_recibido', 0,
                     'pago_pendiente_auto', true,
                     'pago_pendiente_motivo',
                       COALESCE(NULLIF(p_datos_form->>'pago_pendiente_motivo',''), 'OTRO'),
                     'pago_pendiente_detalle',
                       COALESCE(NULLIF(p_datos_form->>'pago_pendiente_detalle',''),
                                'El técnico no registró ningún cobro: Orbit dejó el recibo como pago pendiente.'))
              ELSE '{}'::jsonb END
      || CASE WHEN v_sobrepago > 0
              THEN jsonb_build_object('sobrepago_valor', v_sobrepago,
                                      'sobrepago_motivo', TRIM(p_sobrepago_motivo))
              ELSE '{}'::jsonb END,
    'GUARDADO', p_idempotency_key
  )
  RETURNING id INTO v_recibo_id;

  -- ── INSERT medios formales (fuente de verdad nueva) ─────────────────────────
  IF NOT p_pago_pendiente AND NOT v_es_fm AND p_medios IS NOT NULL AND jsonb_typeof(p_medios) = 'array' THEN
    FOR v_medio, v_ord IN SELECT e, o FROM jsonb_array_elements(p_medios) WITH ORDINALITY AS t(e, o)
    LOOP
      -- migr. 224: el medio en $0 no se guarda, pero el idx sigue siendo la
      -- posición en el arreglo de la app (anclaje de comprobantes).
      CONTINUE WHEN COALESCE(NULLIF(v_medio->>'monto','')::numeric, 0) <= 0
                AND COALESCE(v_medio->>'comprobanteUrl','') = '';

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
        'idx', v_ord - 1, 'id', v_medio_id,
        'metodo', COALESCE(v_medio->>'metodo','OTRO'),
        'monto', COALESCE(NULLIF(v_medio->>'monto','')::numeric, 0)
      );
    END LOOP;
  END IF;

  -- ── El cruce de comisiones, dentro de la misma transaccion (migr. 166) ─────
  IF v_cruce_total > 0 THEN
    INSERT INTO public.recibo_medios_pago (recibo_id, servicio_id, metodo, monto, referencia)
    VALUES (v_recibo_id, p_servicio_id, 'CRUCE_COMISION', v_cruce_total,
            'Comision pendiente pagada: ' || v_cruce_detalle);

    FOR v_com IN SELECT * FROM jsonb_array_elements(p_comisiones_pagadas)
    LOOP
      v_com_svc   := NULLIF(v_com->>'servicio_id','')::uuid;
      v_com_monto := round(COALESCE(NULLIF(v_com->>'monto','')::numeric, 0));

      UPDATE public.servicios
         SET comision_pagada = COALESCE(comision_pagada, 0) + v_com_monto
       WHERE id = v_com_svc;

      INSERT INTO public.comisiones_aliados (
        aliado_id, servicio_id, valor_comision, modalidad_pago, estado,
        fecha_generacion, fecha_liquidacion, notas,
        recibo_id, servicio_recibo_id, pagado_por, via
      ) VALUES (
        v_aliado_id, v_com_svc, v_com_monto,
        CASE WHEN v_aliado_mod IN ('DESCUENTO_INMEDIATO','CREDITO_ACUMULADO','FACTURACION_MENSUAL')
             THEN v_aliado_mod END,
        'PAGADA', v_fecha_local, v_fecha_local,
        'Pagada dentro del recibo ' || p_numero_recibo || ' (cruzada con el cobro del dia).',
        v_recibo_id, p_servicio_id, p_actor_id, 'CRUCE_RECIBO'
      );

      -- El rastro queda en el servicio VIEJO, que es donde alguien va a
      -- preguntarse por que su comision dejo de estar pendiente.
      INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
      VALUES (v_com_svc, 'NOTA',
        'Comision pendiente pagada a la veterinaria: ' || v_com_monto::bigint::text
        || ' — cruzada en el recibo ' || p_numero_recibo || ' del ' || v_fecha_local::text || '.',
        v_com_monto, p_actor_id);
    END LOOP;
  END IF;

  -- ── Efectos sobre el servicio + novedad (una sola vez por recibo nuevo) ─────
  IF p_pago_pendiente THEN
    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, registrado_por)
    VALUES (p_servicio_id, 'NOTA',
            CASE WHEN v_pp_auto
                 THEN 'Recibo ' || p_numero_recibo || ' guardado SIN ningún cobro y el servicio debe '
                      || v_saldo::bigint::text || ': queda como PAGO PENDIENTE (marcado por Orbit).'
                 ELSE COALESCE(p_novedad_nota, 'Recibo generado con pago pendiente. No. ' || p_numero_recibo)
            END,
            p_actor_id);

  ELSIF v_es_fm THEN
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
    FROM jsonb_array_elements(v_medios_ok) AS elem;

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

  -- ── Rastro del sobrepago: novedad propia, garantizada server-side ───────────
  IF v_sobrepago > 0 THEN
    INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
    VALUES (p_servicio_id, 'NOTA',
            '💰 Cobro SUPERIOR al recibo ' || p_numero_recibo || ': recibió ' || v_total_medios::text
            || ' vs recibo ' || p_valor_total::text || ' (diferencia +' || v_sobrepago::text
            || '). Motivo del técnico: ' || TRIM(p_sobrepago_motivo),
            v_sobrepago, p_actor_id);
  END IF;

  IF NOT p_pago_pendiente AND NOT v_es_fm
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
    'cruce_comision', v_cruce_total,
    'medios', v_medios_out
  );
END;
$function$;

-- ── Backfill: quitar las líneas en $0 que ya quedaron guardadas ──────────────
-- Dos lugares: la tabla recibo_medios_pago (desde jul-2026) y el jsonb del
-- recibo (también los de jun-2026, anteriores a la tabla). Una línea sin monto
-- pero CON comprobante adjunto NO se toca: es evidencia de un pago.
-- Novedad de auditoría primero (lee las líneas antes de borrarlas).
INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT rt.servicio_id, 'NOTA',
       'Corrección de datos (migr. 224): se quitaron del recibo ' || COALESCE(rt.numero_recibo, '')
       || ' las líneas de pago en $0 (ese medio no tuvo cobro). El valor cobrado del recibo no cambia.'
FROM public.recibos_tecnico rt
WHERE EXISTS (SELECT 1 FROM public.recibo_medios_pago m
              WHERE m.recibo_id = rt.id AND COALESCE(m.monto, 0) <= 0)
   OR (jsonb_typeof(rt.medios_pago) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(rt.medios_pago) e
                   WHERE COALESCE(NULLIF(e->>'monto','')::numeric, 0) <= 0
                     AND COALESCE(e->>'comprobanteUrl','') = ''));

-- Ninguna tiene comprobante colgado (verificado 25-nov); si apareciera uno, el
-- FK de recibo_comprobantes aborta la migración en vez de perderlo.
DELETE FROM public.recibo_medios_pago WHERE COALESCE(monto, 0) <= 0;

UPDATE public.recibos_tecnico rt
   SET medios_pago = (
         SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb)
         FROM jsonb_array_elements(rt.medios_pago) WITH ORDINALITY AS t(e, o)
         WHERE COALESCE(NULLIF(e->>'monto','')::numeric, 0) > 0
            OR COALESCE(e->>'comprobanteUrl','') <> '')
 WHERE jsonb_typeof(rt.medios_pago) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(rt.medios_pago) e
               WHERE COALESCE(NULLIF(e->>'monto','')::numeric, 0) <= 0
                 AND COALESCE(e->>'comprobanteUrl','') = '');

COMMIT;
