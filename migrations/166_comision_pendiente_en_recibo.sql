-- ============================================================================
-- 166 — La comisión vieja que la vet pide cobrar se paga dentro del recibo
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-09-17): al hacerle el recibo a una veterinaria, algunas
-- piden que de una vez se les pague la comisión de un servicio ANTERIOR que
-- quedó sin pagar. Hoy no hay dónde registrarlo: el técnico o no lo hace, o lo
-- descuenta "a mano" y esa plata desaparece del rastro.
--
-- CÓMO SE DECIDIÓ QUE FUNCIONE (David, 17-sep):
--   1. Se CRUZA con el cobro del día: la vet paga hoy menos lo que se le debe.
--   2. Si la comisión pendiente no cabe en el cobro de hoy, se cruza hasta donde
--      alcance y el resto SIGUE PENDIENTE para la próxima vez.
--   3. Solo aparece en el recibo de VETERINARIA, y es opcional.
--
-- 🩸 LA TRAMPA QUE OBLIGA A ESTE DISEÑO. Lo natural sería registrar que el
-- técnico "recogió menos". Está mal por partida doble:
--   · `servicios.valor_pagado` quedaría corto ⇒ el servicio de hoy aparecería
--     PARCIAL con un saldo que NADIE debe, vivo para siempre en la cartera.
--   · El cuadre compara `valor_a_recoger` (= `servicios.valor_total`) contra la
--     suma de los medios del recibo ⇒ le marcaría al técnico un FALTANTE por el
--     mismo valor de la comisión, que él nunca se quedó.
-- Por eso el cruce entra como un MEDIO DE PAGO propio, `CRUCE_COMISION`: suma
-- como recogido (el servicio queda COMPLETO y el cuadre da cero diferencia),
-- pero no es efectivo (el técnico entrega exactamente lo que tiene en la mano)
-- ni es digital (a la empresa no le entró: se le abonó a la vet).
--
-- POR ESO SE TOCAN TRES FUNCIONES:
--   · `guardar_recibo_tecnico`  — valida y registra el cruce en la MISMA
--     transacción del recibo (o no se guarda nada).
--   · `generar_cuadre_tecnico`  — saca el cruce del bucket "digital → empresa"
--     y lo guarda en su propia columna.
--   · `set_cuadre_item_medios`  — al reclasificar medios, el cruce se preserva:
--     sin esto el coordinador podría volverlo efectivo que el técnico nunca tuvo.
--
-- QUÉ ES "PENDIENTE" (no cambia): un servicio con `comision_aliado > 0` y
-- `comision_descontada = false` — la comisión no se le descontó al registrar,
-- así que Camino se la debe. Lo nuevo es `servicios.comision_pagada`, que dice
-- CUÁNTO de esa comisión ya se le pagó (permite pagos parciales).
-- ⚠️ NO se toca `comision_descontada`: esa bandera significa "el `valor_total`
-- guardado ya viene neto" y moverla cambiaría la plata del servicio.
--
-- Aditiva, idempotente, reversible. No pisa datos existentes.
-- Aplicar en VPS (Contabo) — el archivo se PIPEA desde local; no vive en el VPS:
--   cat migrations/166_comision_pendiente_en_recibo.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;

-- ─── 1. Cuánto de la comisión de un servicio ya se le pagó al aliado ────────
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS comision_pagada numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.servicios.comision_pagada IS
  'Parte de comision_aliado que YA se le pagó al aliado por fuera del descuento '
  '(cruzada en el recibo de otro servicio, o liquidada por el coordinador). '
  'Pendiente = comision_aliado - comision_pagada cuando comision_descontada = false.';

-- ─── 2. El libro de comisiones pagadas ──────────────────────────────────────
-- Se reutiliza `comisiones_aliados` (existe desde el inicio y está VACÍA: nunca
-- llegó a usarse porque el único insert que la escribía omitía servicio_id, que
-- es NOT NULL, y reventaba). Aquí gana las columnas que le faltaban para poder
-- responder "quién pagó esta comisión, cuándo y en qué recibo".
ALTER TABLE public.comisiones_aliados
  ADD COLUMN IF NOT EXISTS recibo_id          uuid REFERENCES public.recibos_tecnico(id),
  ADD COLUMN IF NOT EXISTS servicio_recibo_id uuid REFERENCES public.servicios(id),
  ADD COLUMN IF NOT EXISTS pagado_por         uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS via                text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comisiones_aliados_via_check') THEN
    ALTER TABLE public.comisiones_aliados
      ADD CONSTRAINT comisiones_aliados_via_check
      CHECK (via IS NULL OR via IN ('CRUCE_RECIBO', 'EFECTIVO', 'LIQUIDACION'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comisiones_recibo ON public.comisiones_aliados(recibo_id);

COMMENT ON COLUMN public.comisiones_aliados.recibo_id IS
  'Recibo del técnico dentro del cual se le pagó esta comisión al aliado (via = CRUCE_RECIBO).';
COMMENT ON COLUMN public.comisiones_aliados.servicio_recibo_id IS
  'Servicio de ESE recibo (la mascota que se estaba cobrando cuando se cruzó la comisión).';

-- ─── 3. El cruce en la fila del cuadre ──────────────────────────────────────
ALTER TABLE public.cuadre_items
  ADD COLUMN IF NOT EXISTS cruce_comision numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cuadre_items.cruce_comision IS
  'Parte de lo recogido que NO fue plata: comisión vieja que se le abonó a la '
  'veterinaria dentro del recibo. Cuenta en total_cobrado, NO en efectivo ni en digital.';

-- ─── 4. El recibo del técnico puede pagar comisiones viejas ─────────────────
-- La firma cambia (un parámetro nuevo, opcional) ⇒ DROP + CREATE dentro de la
-- misma transacción. Con CREATE OR REPLACE quedarían DOS funciones sobrecargadas
-- y PostgREST no sabría cuál llamar ("could not choose the best candidate").
DROP FUNCTION IF EXISTS public.guardar_recibo_tecnico(
  uuid, uuid, text, text, date, text, numeric, jsonb, jsonb,
  boolean, boolean, uuid, text, numeric, text, text, text);

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
         ELSE COALESCE(p_medios,'[]'::jsonb)
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
      || CASE WHEN v_sobrepago > 0
              THEN jsonb_build_object('sobrepago_valor', v_sobrepago,
                                      'sobrepago_motivo', TRIM(p_sobrepago_motivo))
              ELSE '{}'::jsonb END,
    'GUARDADO', p_idempotency_key
  )
  RETURNING id INTO v_recibo_id;

  -- ── INSERT medios formales (fuente de verdad nueva) ─────────────────────────
  IF NOT p_pago_pendiente AND NOT v_es_fm AND p_medios IS NOT NULL AND jsonb_typeof(p_medios) = 'array' THEN
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
            COALESCE(p_novedad_nota, 'Recibo generado con pago pendiente. No. ' || p_numero_recibo),
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

GRANT EXECUTE ON FUNCTION public.guardar_recibo_tecnico(
  uuid, uuid, text, text, date, text, numeric, jsonb, jsonb,
  boolean, boolean, uuid, text, numeric, text, text, text, jsonb)
  TO anon, authenticated, service_role;


-- ─── 5. El cuadre: el cruce no es efectivo ni es digital ────────────────────
CREATE OR REPLACE FUNCTION public.generar_cuadre_tecnico(p_tecnico_id uuid, p_desde date, p_hasta date, p_actor_id uuid DEFAULT NULL::uuid, p_ajustes_manuales numeric DEFAULT 0, p_ajustes_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuadre_id        uuid;
  v_posterior        numeric;
  v_rec              record;
  v_can              record;
  v_sr               record;
  v_ent              record;   -- cobro hecho en la entrega (migr. 152)
  v_prev_ent         jsonb   := '{}'::jsonb;   -- ediciones previas POR ENTREGA
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
  v_cruce            numeric;   -- comision vieja pagada a la vet dentro del recibo (migr. 166)
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
  -- ⚠️ Las filas de ENTREGA se excluyen: desde la migración 152 un servicio
  -- puede tener DOS filas (su recogida y su entrega) y este mapa está indexado
  -- por servicio_id — sin el filtro, la corrección manual hecha sobre una se le
  -- aplicaría a la otra. Las de entrega llevan su propio mapa (v_prev_ent).
  SELECT
    COALESCE(array_agg(ci.servicio_id) FILTER (WHERE ci.es_lejania AND NOT ci.es_entrega), ARRAY[]::uuid[]),
    COALESCE(jsonb_object_agg(ci.servicio_id::text, jsonb_build_object(
      'obs', ci.observaciones, 'estado', ci.estado_conciliacion,
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta,
      'efectivo', ci.efectivo, 'digital', ci.digital, 'cruce_comision', ci.cruce_comision,
      'medios_pago', ci.medios_pago,
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
      FILTER (WHERE ci.servicio_id IS NOT NULL AND NOT ci.es_entrega), '{}'::jsonb)
    INTO v_lej_svcs, v_prev
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR';

  -- Las mismas marcas manuales, pero de las filas de ENTREGA y por entrega_id.
  -- Sin esto, regenerar el borrador borraría lo que el coordinador corrigió con
  -- el lápiz sobre un cobro en la puerta (reclasificar el medio, o reconocerle
  -- un pago por la entrega).
  SELECT COALESCE(jsonb_object_agg(ci.entrega_id::text, jsonb_build_object(
      'obs', ci.observaciones, 'estado', ci.estado_conciliacion,
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta,
      'efectivo', ci.efectivo, 'digital', ci.digital, 'medios_pago', ci.medios_pago,
      'medios_pago_original', ci.medios_pago_original, 'medios_editado_en', ci.medios_editado_en,
      'medios_editado_por', ci.medios_editado_por, 'medios_motivo', ci.medios_motivo,
      'recargo_aplicado', ci.recargo_aplicado, 'recargo_manual_original', ci.recargo_manual_original,
      'recargo_manual_editado_en', ci.recargo_manual_editado_en, 'recargo_manual_editado_por', ci.recargo_manual_editado_por,
      'recargo_manual_motivo', ci.recargo_manual_motivo,
      'pago_servicio', ci.pago_servicio, 'pago_servicio_original', ci.pago_servicio_original,
      'pago_servicio_editado_en', ci.pago_servicio_editado_en, 'pago_servicio_editado_por', ci.pago_servicio_editado_por,
      'pago_servicio_motivo', ci.pago_servicio_motivo))
      FILTER (WHERE ci.entrega_id IS NOT NULL), '{}'::jsonb)
    INTO v_prev_ent
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
           r.valor_cobrado, r.medios_pago, r.valor_total AS recibo_valor_total,
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
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) NOT IN ('EFECTIVO','CRUCE_COMISION')), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'CRUCE_COMISION'), 0),
           COUNT(*),
           COALESCE(jsonb_agg(jsonb_build_object('metodo', metodo, 'monto', monto)
                              ORDER BY created_at), '[]'::jsonb)
      INTO v_efectivo, v_digital, v_cruce, v_nmedios, v_medios
    FROM public.recibo_medios_pago
    WHERE recibo_id = v_rec.recibo_id;

    IF v_nmedios = 0 THEN
      SELECT COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') NOT IN ('EFECTIVO','CRUCE_COMISION')
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'CRUCE_COMISION'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0)
        INTO v_efectivo, v_digital, v_cruce
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

    -- Lo que se le sumo al servicio DESPUES de que el tecnico emitio su recibo:
    -- adicionales vendidos cuando el ya no estaba. No es plata suya. Se guarda
    -- aparte para que la diferencia del cuadre no se la cobre a el; el saldo
    -- sigue vivo en la cartera de Finanzas, que es donde se persigue el cobro.
    -- Se ignora el caso contrario (el servicio bajo de precio): eso ya lo trata
    -- `excesoValorARecoger`.
    v_posterior := CASE
      WHEN COALESCE(v_rec.recibo_valor_total, 0) > 0
       AND v_a_cobrar > v_rec.recibo_valor_total
      THEN v_a_cobrar - v_rec.recibo_valor_total
      ELSE 0
    END;

    v_p := v_prev -> (v_rec.servicio_id::text);
    -- Vía: preserva la manual; si no, facturación mensual entra a Conciliaciones.
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_rec.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' END);

    -- Facturación mensual: el técnico NO recoge esta plata — el aliado la paga
    -- por factura al cierre del mes. El recibo VET quedaba con el valor
    -- prellenado como EFECTIVO y inflaba el dinero a entregar (migración 068).
    -- Si de verdad recibió algo, el coordinador lo corrige con el lápiz y esa
    -- edición manda: se aplica abajo, después de esto.
    IF v_rec.svc_modalidad = 'FACTURACION_MENSUAL' THEN
      v_efectivo := 0;
      v_digital  := 0;
      v_cruce    := 0;
      v_medios   := '[]'::jsonb;
    END IF;

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
      v_cruce    := COALESCE((v_p->>'cruce_comision')::numeric, v_cruce);
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
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales, valor_posterior_recibo,
      total_cobrado, efectivo, digital, cruce_comision, medios_pago,
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
      v_a_cobrar, COALESCE(v_rec.svc_valor_total, 0), v_rec.svc_valor_plan, v_rec.svc_valor_adic, v_posterior,
      v_efectivo + v_digital + v_cruce, v_efectivo, v_digital, v_cruce, v_medios,
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
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital + v_cruce;
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
      -- ⚠️ `AND NOT ci2.es_entrega`: una fila de entrega cerrada NO significa
      -- que la recogida de ese servicio ya se haya cuadrado. Sin este filtro,
      -- cobrar en la puerta y cerrar ese cuadre habría hecho desaparecer para
      -- siempre la recogida sin recibo del mismo servicio (migr. 152).
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = s.id AND NOT ci2.es_entrega AND c2.estado = 'CERRADO'
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

  -- ── Dinero que el mensajero cobró AL ENTREGAR (migración 152) ─────────────
  -- Se fecha por el día del cobro (`fecha_realizada` de la entrega, que se
  -- escribe con la fecha LOCAL), no por el ingreso del servicio: la deuda del
  -- mensajero nace el día que recibe la plata. `cobro_registrado_en` es
  -- timestamptz y solo se usa de respaldo, convertido a hora de Bogotá — en UTC
  -- un cobro de la noche saltaría al día siguiente.
  FOR v_ent IN
    SELECT e.id AS entrega_id, e.servicio_id,
           COALESCE(e.cobro_monto, 0) AS monto,
           upper(COALESCE(e.cobro_metodo, 'EFECTIVO')) AS metodo,
           COALESCE(e.fecha_realizada,
                    (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date) AS fecha_cobro,
           e.hora_realizada,
           s.ciudad_recogida, s.plan_id,
           a.nombre AS veterinaria,
           m.nombre AS mascota_nombre, p.nombre AS plan_nombre
    FROM public.entregas e
    JOIN public.servicios s ON s.id = e.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE e.cobro_registrado_por = p_tecnico_id
      AND COALESCE(e.cobro_monto, 0) > 0
      AND s.estado <> 'CANCELADO'
      AND COALESCE(e.fecha_realizada,
                   (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date)
          BETWEEN p_desde AND p_hasta
      -- Descarte por ENTREGA, no por servicio: la recogida del mismo servicio
      -- se cuadra por su lado y no debe taparse con esta.
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.entrega_id = e.id AND c2.estado = 'CERRADO'
      )
    ORDER BY COALESCE(e.fecha_realizada,
                      (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date),
             e.hora_realizada
  LOOP
    -- Misma regla que en el recibo: solo el efectivo es plata que él tiene en
    -- la mano; lo digital entró directo a la empresa.
    IF v_ent.metodo = 'EFECTIVO' THEN
      v_efectivo := v_ent.monto; v_digital := 0;
    ELSE
      v_efectivo := 0; v_digital := v_ent.monto;
    END IF;
    v_medios := jsonb_build_array(jsonb_build_object('metodo', v_ent.metodo, 'monto', v_ent.monto));

    -- Una entrega no es una recogida: sin transporte y sin recargos de día u
    -- hora. Lo que se le quiera reconocer por entregar se pone con el lápiz.
    v_recargo := 0;
    v_pago    := 0;

    v_p := v_prev_ent -> (v_ent.entrega_id::text);
    IF (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_medios   := COALESCE(v_p->'medios_pago', v_medios);
      v_efectivo := COALESCE((v_p->>'efectivo')::numeric, v_efectivo);
      v_digital  := COALESCE((v_p->>'digital')::numeric, v_digital);
    END IF;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, 0);
    END IF;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, 0);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, entrega_id, es_entrega, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_posterior_recibo,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      medios_pago_original, medios_editado_en, medios_editado_por, medios_motivo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      -- `hora_realizada` se escribe como 'HH:MM' desde la app: el cast explícito
      -- evita depender de si la columna quedó como time o como texto.
      v_cuadre_id, v_ent.servicio_id, NULL, v_ent.entrega_id, true, v_ent.fecha_cobro, v_ent.hora_realizada::time,
      v_ent.mascota_nombre, v_ent.ciudad_recogida, v_ent.plan_nombre, v_vehiculo, v_ent.veterinaria, NULL, 0,
      -- Cuadrada por construcción: lo que tenía que recoger en la puerta ES lo
      -- que recogió. El saldo que el cliente haya quedado debiendo se persigue
      -- en la cartera de Finanzas, no en el cuadre (misma frontera de la 143).
      v_ent.monto, v_ent.monto, 0,
      v_efectivo + v_digital, v_efectivo, v_digital, v_medios,
      0, false,
      false, false, false, false, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_p->>'via',
      COALESCE((v_p->>'resuelta')::boolean, false),
      v_p->'medios_pago_original', (v_p->>'medios_editado_en')::timestamptz, (v_p->>'medios_editado_por')::uuid, NULLIF(v_p->>'medios_motivo',''),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );

    v_n            := v_n + 1;
    v_tot_cobrado  := v_tot_cobrado  + v_efectivo + v_digital;
    v_tot_efectivo := v_tot_efectivo + v_efectivo;
    v_tot_digital  := v_tot_digital  + v_digital;
    v_tot_recargos := v_tot_recargos + v_recargo;
    v_tot_pago     := v_tot_pago     + v_pago;
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


-- ─── 6. Reclasificar medios no puede volver efectivo el cruce ───────────────
CREATE OR REPLACE FUNCTION public.set_cuadre_item_medios(p_item_id uuid, p_medios jsonb, p_actor_id uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuadre_id       uuid;
  v_estado          text;
  v_es_cancelado    boolean;
  v_rol             int;
  v_total_actual    numeric;
  v_orig_medios     jsonb;
  v_nuevo_efectivo  numeric;
  v_cruce_rows      jsonb;      -- filas CRUCE_COMISION de la fila (migr. 166)
  v_cruce           numeric := 0;
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
  IF COALESCE(v_rol, 0) NOT IN (1, 6) THEN
    RAISE EXCEPTION 'SOLO_GESTION: solo ADMIN o COORDINADOR puede reclasificar los medios de pago';
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

  -- El cruce de comision (migr. 166) no es un medio de pago reclasificable:
  -- es plata que nunca entro (se le abono a la vet su comision vieja). Se
  -- preserva tal cual y se descuenta de lo que el coordinador reparte, o
  -- reclasificar la fila lo convertiria en efectivo que el tecnico nunca tuvo.
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb),
         COALESCE(SUM((elem->>'monto')::numeric), 0)
    INTO v_cruce_rows, v_cruce
  FROM jsonb_array_elements(COALESCE(v_orig_medios, '[]'::jsonb)) elem
  WHERE upper(elem->>'metodo') = 'CRUCE_COMISION';

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_medios_norm
  FROM jsonb_array_elements(v_medios_norm) elem
  WHERE upper(elem->>'metodo') <> 'CRUCE_COMISION';

  SELECT
    COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO' THEN (elem->>'monto')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN upper(elem->>'metodo') <> 'EFECTIVO' THEN (elem->>'monto')::numeric ELSE 0 END), 0)
    INTO v_nuevo_efectivo, v_nuevo_digital
  FROM jsonb_array_elements(v_medios_norm) elem;

  v_suma := v_nuevo_efectivo + v_nuevo_digital + v_cruce;
  v_medios_norm := v_medios_norm || v_cruce_rows;

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
    cruce_comision       = v_cruce,
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
    'cruce_comision', v_cruce,
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
$function$;


-- Sin esto PostgREST sigue sirviendo la firma vieja y el técnico recibe un
-- "could not find the function" al guardar el recibo con comisiones marcadas.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ─── Verificación (después de aplicar) ──────────────────────────────────────
-- SELECT count(*) FROM information_schema.columns
--  WHERE (table_name, column_name) IN
--        (('servicios','comision_pagada'), ('cuadre_items','cruce_comision'),
--         ('comisiones_aliados','recibo_id'), ('comisiones_aliados','via'));   -- 4
-- SELECT proname, pronargs FROM pg_proc WHERE proname = 'guardar_recibo_tecnico'; -- 1 fila, 18
-- -- Comisiones que quedan pendientes hoy (las que verá el técnico):
-- SELECT a.nombre, count(*), sum(s.comision_aliado - s.comision_pagada)::bigint
--   FROM servicios s JOIN aliados a ON a.id_aliado = s.aliado_origen_id
--  WHERE s.comision_aliado > 0 AND s.comision_descontada IS NOT TRUE
--    AND s.estado <> 'CANCELADO' AND s.comision_aliado > s.comision_pagada
--  GROUP BY 1 ORDER BY 3 DESC;
