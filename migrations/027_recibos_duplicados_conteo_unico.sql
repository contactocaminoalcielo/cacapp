-- ============================================================================
-- 027 — Recibos duplicados: el dinero de un servicio cuenta UNA sola vez
-- Fecha: 2026-07-03
--
-- Diagnóstico (VPS, 2026-07-03): 21 servicios tienen más de un recibo en
-- recibos_tecnico (51 recibos). Dos orígenes, ambos legítimos como DOCUMENTO:
--   a) El técnico regeneró el recibo (corrigió monto, lo re-abrió). Ej. LUNA
--      2ff6ebcc: 3 recibos VETERINARIA, uno de $109.000 y dos en $0.
--   b) Doble documento CLIENTE + VETERINARIA del mismo cobro (botón "También
--      generar recibo…"). Ej. SHAKIRA: CLIENTE $189.000 + VET $189.000 con
--      minutos de diferencia = LA MISMA plata contada dos veces.
--
-- Daños que corrige esta migración:
--   1. generar_cuadre_tecnico sumaba TODOS los recibos → mascotas repetidas en
--      el cuadre, "a cobrar"/comisión duplicados y filas "falta" fantasma ($0).
--   2. guardar_recibo_tecnico volvía a sumar el pago a servicios.valor_pagado
--      en cada regeneración → 6 servicios con valor_pagado inflado (ARIZONA
--      $1.978.000 sobre un servicio de $989.000; BROWNIE $1.735.800 sobre
--      $594.000; MAX, SHAKIRA, MORFEO, SR CALLE).
--
-- Regla (validada por David 2026-06-26 contra los recibos reales):
--   Por servicio cuenta UN solo recibo = el más reciente CON dinero
--   (created_at desc); si ninguno tiene dinero, el más reciente.
--   Los recibos NO se anulan ni se borran: siguen siendo documentos válidos
--   (el PDF del cliente y el de la veterinaria); solo el CONTEO es único.
--
-- Piezas:
--   · recibos_tecnico.pago_aplicado — cuánto sumó ESTE recibo a valor_pagado.
--   · Backfill: repara los servicios inflados (novedad NOTA de auditoría en el
--     timeline) y puebla pago_aplicado en el recibo "contado" de cada servicio.
--   · guardar_recibo_tecnico v2: al guardar un recibo con dinero resta primero
--     lo aplicado por los recibos anteriores del servicio (no re-suma).
--   · generar_cuadre_tecnico v7: DISTINCT ON (servicio_id) con la regla, y la
--     exclusión de cuadres CERRADOS pasa a nivel de servicio (si otro recibo
--     del mismo servicio ya se cuadró y cerró, no se vuelve a contar).
--
-- Estado en prod al escribirla: 9 cuadres, TODOS en BORRADOR (ninguno CERRADO
-- contaminado). Tras aplicar: REGENERAR los cuadres borrador para limpiarlos.
--
-- Aplicar UNA vez por SSH→psql en Contabo. El backfill es auto-limitante
-- (la condición de inflado deja de cumplirse tras la primera pasada).
-- ============================================================================

BEGIN;

-- ─── 1. pago_aplicado: cuánto de este recibo vive en servicios.valor_pagado ─
ALTER TABLE public.recibos_tecnico
  ADD COLUMN IF NOT EXISTS pago_aplicado numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.recibos_tecnico.pago_aplicado
  IS 'Monto que ESTE recibo sumó a servicios.valor_pagado (0 si pago pendiente, '
     'facturación mensual, o si un recibo posterior del servicio lo corrigió). '
     'Permite que una regeneración reste el pago anterior en vez de re-sumarlo.';

-- ─── 2. Reparar valor_pagado inflado por recibos duplicados ─────────────────
-- Inflado = servicio con >1 recibo cuyo valor_pagado no lo explica NINGÚN
-- recibo por sí solo (valor_pagado > recibo mayor): solo pudo salir de sumar
-- el mismo cobro varias veces. El valor correcto = el del recibo "contado".
CREATE TEMP TABLE _mig027_reparados AS
WITH money AS (
  SELECT r.id, r.servicio_id, r.created_at,
         COALESCE(
           (SELECT SUM(m.monto) FROM public.recibo_medios_pago m WHERE m.recibo_id = r.id),
           (SELECT SUM(NULLIF(e->>'monto','')::numeric)
              FROM jsonb_array_elements(COALESCE(r.medios_pago,'[]'::jsonb)) e),
           0) AS cobrado
  FROM public.recibos_tecnico r
),
kept AS (
  SELECT DISTINCT ON (servicio_id) id, servicio_id, cobrado
  FROM money
  ORDER BY servicio_id, (cobrado > 0) DESC, created_at DESC
),
stats AS (
  SELECT servicio_id, count(*) AS n_recibos, max(cobrado) AS recibo_mayor
  FROM money GROUP BY servicio_id
)
SELECT s.id AS servicio_id,
       s.valor_total,
       s.valor_pagado AS pagado_antes,
       k.cobrado      AS pagado_despues,
       st.n_recibos
FROM public.servicios s
JOIN kept  k  ON k.servicio_id  = s.id
JOIN stats st ON st.servicio_id = s.id
WHERE st.n_recibos > 1
  AND s.valor_pagado > st.recibo_mayor + 1;

UPDATE public.servicios s
   SET valor_pagado = m.pagado_despues,
       estado_pago  = CASE WHEN m.pagado_despues >= s.valor_total THEN 'COMPLETO'
                           WHEN m.pagado_despues > 0              THEN 'PARCIAL'
                           ELSE 'PENDIENTE' END
  FROM _mig027_reparados m
 WHERE s.id = m.servicio_id;

-- Auditoría visible en el timeline del servicio (reversible con este dato).
INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT servicio_id, 'NOTA',
       'Corrección automática (migración 027): valor_pagado ajustado de $' ||
       to_char(pagado_antes, 'FM999G999G999') || ' a $' ||
       to_char(pagado_despues, 'FM999G999G999') ||
       ' — recibos duplicados habían sumado el mismo pago varias veces.'
FROM _mig027_reparados;

-- ─── 3. Backfill de pago_aplicado: solo el recibo "contado" de cada servicio ─
-- Tope en valor_pagado ya reparado: nunca declarar aplicado más de lo que el
-- servicio tiene registrado (recibos de facturación mensual quedan en 0 solos
-- porque su servicio tiene valor_pagado 0).
WITH money AS (
  SELECT r.id, r.servicio_id, r.created_at,
         COALESCE(
           (SELECT SUM(m.monto) FROM public.recibo_medios_pago m WHERE m.recibo_id = r.id),
           (SELECT SUM(NULLIF(e->>'monto','')::numeric)
              FROM jsonb_array_elements(COALESCE(r.medios_pago,'[]'::jsonb)) e),
           0) AS cobrado
  FROM public.recibos_tecnico r
),
kept AS (
  SELECT DISTINCT ON (servicio_id) id, servicio_id, cobrado
  FROM money
  ORDER BY servicio_id, (cobrado > 0) DESC, created_at DESC
)
UPDATE public.recibos_tecnico r
   SET pago_aplicado = GREATEST(LEAST(k.cobrado, s.valor_pagado), 0)
  FROM kept k
  JOIN public.servicios s ON s.id = k.servicio_id
 WHERE r.id = k.id
   AND k.cobrado > 0;

-- Reporte de lo reparado (sale en la salida de psql).
SELECT * FROM _mig027_reparados ORDER BY pagado_antes - pagado_despues DESC;

COMMIT;

-- ============================================================================
-- guardar_recibo_tecnico v2 — regenerar un recibo NO re-suma el pago
-- (Sobre la versión 2026-06-16: idéntica salvo el bloque de valor_pagado, que
--  ahora resta lo aplicado por recibos anteriores del servicio y registra
--  pago_aplicado en el recibo nuevo.)
-- ============================================================================
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
BEGIN
  IF p_servicio_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio_id e idempotency_key son obligatorios';
  END IF;

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
    p_fecha_emision, NULLIF(p_hora_emision,'')::time, p_valor_total, v_valor_cobrado,
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

GRANT EXECUTE ON FUNCTION public.guardar_recibo_tecnico(
  uuid, uuid, text, text, date, text, numeric, jsonb, jsonb,
  boolean, boolean, uuid, text, numeric, text, text
) TO authenticated, service_role;

-- ============================================================================
-- generar_cuadre_tecnico v7 — un servicio cuenta UNA sola vez en el cuadre
-- (Sobre la v6 de la migración 021. Cambios:)
--   1. El loop de recibos toma UN recibo por servicio con DISTINCT ON:
--      el más reciente CON dinero; si ninguno cobró, el más reciente.
--      La selección es GLOBAL (entre todos los recibos del servicio, sin
--      filtrar por técnico ni rango) y DESPUÉS se filtra: el servicio entra
--      al cuadre del técnico y rango donde vive su recibo "contado".
--   2. La exclusión de cuadres CERRADOS pasa de recibo_id a servicio_id:
--      si el dinero del servicio ya se cuadró y cerró (fila con recibo),
--      otro recibo del mismo servicio NO lo vuelve a meter. Las filas
--      sin_recibo ($0) y cancelado de un cuadre CERRADO NO bloquean: si el
--      técnico cobra después, ese recibo sí entra a un cuadre nuevo (el
--      cobro tardío se refleja; la conciliación vieja se resuelve a mano).
--   3. Las marcas manuales (lejanía, obs, estado, conciliación) se preservan
--      por SERVICIO al regenerar un BORRADOR (antes recibo/servicio por
--      separado; ahora hay máximo una fila por servicio, y así no se pierden
--      si el recibo "contado" cambió por una regeneración del técnico).
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
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta))
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
      AND r.fecha_emision BETWEEN p_desde AND p_hasta
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
    ORDER BY r.fecha_emision, r.hora_emision
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

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre, v_vehiculo, v_rec.veterinaria, v_rec.svc_modalidad, v_rec.svc_comision,
      v_a_cobrar, COALESCE(v_rec.svc_valor_total, 0), v_rec.svc_valor_plan, v_rec.svc_valor_adic,
      v_efectivo + v_digital, v_efectivo, v_digital, v_medios,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_es_lej, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false)
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
    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta, sin_recibo
    ) VALUES (
      v_cuadre_id, v_sr.servicio_id, NULL, v_sr.fecha_ingreso, NULL,
      v_sr.mascota_nombre, v_sr.ciudad_recogida, v_sr.plan_nombre, v_vehiculo, v_sr.veterinaria, v_sr.svc_modalidad, v_sr.svc_comision,
      v_a_cobrar, COALESCE(v_sr.svc_valor_total, 0), v_sr.svc_valor_plan, v_sr.svc_valor_adic,
      0, 0, 0, '[]'::jsonb,
      0, false,
      false, false, false, false, 0, 0, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false), true
    );
    v_n := v_n + 1;
  END LOOP;

  IF v_tarifa_can > 0 THEN
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
      INSERT INTO public.cuadre_items (
        cuadre_id, servicio_id, recibo_id, fecha, hora,
        mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
        valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
        total_cobrado, efectivo, digital, medios_pago,
        transporte_reconocido, transporte_sin_dato,
        es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
        observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta
      ) VALUES (
        v_cuadre_id, v_can.servicio_id, NULL, v_can.cancelado_en::date, NULL,
        v_can.mascota_nombre, v_can.ciudad_recogida, v_can.plan_nombre, v_vehiculo, v_can.veterinaria, v_can.svc_modalidad, v_can.svc_comision,
        v_a_cobrar, COALESCE(v_can.svc_valor_total, 0), v_can.svc_valor_plan, v_can.svc_valor_adic,
        0, 0, 0, '[]'::jsonb,
        0, false,
        false, false, false, false, 0, v_tarifa_can, true,
        NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
        COALESCE((v_p->>'resuelta')::boolean, false)
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
