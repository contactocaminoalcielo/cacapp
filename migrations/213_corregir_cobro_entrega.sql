-- 213 · Corregir el valor cobrado en una ENTREGA
--
-- Reporte 19-nov (Tablero, urgencia crítica): "el servicio quedó pendiente en
-- veterinaria, teníamos un recordatorio por entregar y el pago se realizaba
-- contra entrega; al subir el comprobante del recordatorio el servicio
-- completo quedó como pago efectuado".
--
-- Causa: el panel «Dinero por cobrar» del mensajero (migr. 151) era TODO o
-- NADA: «Recibí el dinero» registraba el SALDO COMPLETO del servicio. Cuando el
-- plan está pendiente con la veterinaria (o el cliente lo liquida después) y en
-- la puerta solo se cobra el recordatorio adicional, el servicio quedaba
-- COMPLETO. Casos reales: Muñeca (cobró $167.750, era $26.000 del Memopet),
-- HORUS ($208.920; el mensajero escribió "la cliente solo me pagó lo del
-- memopet adicional") y Leonidas ($217.100).
--
-- El front ya deja escribir cuánto se recibió (TecnicoApp). Esta función
-- arregla los que ya quedaron mal, y los que se equivoquen en adelante, desde
-- la ficha del servicio (Tablero y Gestión) — antes solo por SQL.
--
-- Qué hace, en una transacción:
--   · entregas.cobro_monto/cobro_metodo pasan al valor REAL. Con 0 queda como
--     "no me pagaron" (cobro_* en NULL + motivo), igual que si el mensajero lo
--     hubiera marcado así: el cuadre (migr. 152) ya sabe leer las dos formas.
--   · servicios.valor_pagado se mueve SOLO por la diferencia (no se recalcula:
--     trae abonos de Cartera y recibos del técnico). estado_pago se recalcula.
--     Excepción: si al cobrar el servicio YA estaba en saldo cero, ese cobro
--     nunca se sumó a valor_pagado (TecnicoApp lo anotó solo en la entrega), así
--     que tampoco se resta.
--   · La bitácora se anota con el antes, el después, el motivo y quién.
-- Cerrojos: solo coordinación; motivo obligatorio; se niega si la entrega ya
-- entró en un cuadre CERRADO (inmutable, migr. 015 → Conciliaciones).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.corregir_cobro_entrega(
  p_entrega_id uuid,
  p_monto_real numeric,
  p_metodo     text DEFAULT NULL,
  p_motivo     text DEFAULT NULL,
  p_actor_id   uuid DEFAULT NULL,
  p_actor_rol  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent          record;
  v_total        numeric;
  v_pagado       numeric;
  v_nuevo_pagado numeric;
  v_nuevo_estado text;
  v_metodo       text;
  v_monto        numeric := round(COALESCE(p_monto_real, -1), 2);
  v_antes        numeric;
  v_dif          numeric;
  v_aplicado     boolean;
  v_cerrados     int;
  v_borrador     int;
  v_motivo       text := NULLIF(TRIM(p_motivo), '');
  fmt_antes      text;
  fmt_real       text;
BEGIN
  -- Desde el navegador el actor es la sesión, no lo que declare la petición
  -- (mismo patrón que la migr. 191).
  IF coalesce(auth.jwt() ->> 'role', '') = 'authenticated' THEN
    IF NOT public.es_coordinacion() THEN
      RAISE EXCEPTION 'NO_AUTORIZADO: solo coordinación puede corregir un cobro' USING ERRCODE = '42501';
    END IF;
    p_actor_id  := public.mi_personal_id();
    p_actor_rol := public.mi_rol();
  ELSIF p_actor_rol IS NULL OR p_actor_rol NOT IN ('COORDINADOR','ADMIN') THEN
    RAISE EXCEPTION 'NO_AUTORIZADO: solo coordinación puede corregir un cobro';
  END IF;

  IF p_entrega_id IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: entrega_id es obligatorio';
  END IF;
  IF v_monto < 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: escribe cuánto se recibió de verdad (0 si no se recibió nada)';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 4 THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: escribe la observación (queda en la bitácora del servicio)';
  END IF;

  SELECT e.id, e.servicio_id, e.cobro_monto, e.cobro_metodo, e.cobro_comprobante_path,
         e.cobro_registrado_por, e.cobro_registrado_en
    INTO v_ent
    FROM public.entregas e
   WHERE e.id = p_entrega_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTREGA_NO_EXISTE: %', p_entrega_id;
  END IF;
  IF v_ent.servicio_id IS NULL THEN
    RAISE EXCEPTION 'NO_APLICA: esta entrega es de una compra de recordatorios; se corrige en Compras';
  END IF;
  IF v_ent.cobro_monto IS NULL THEN
    RAISE EXCEPTION 'SIN_COBRO: en esta entrega no se registró dinero recibido';
  END IF;

  SELECT count(*) FILTER (WHERE c.estado = 'CERRADO'), count(*) FILTER (WHERE c.estado <> 'CERRADO')
    INTO v_cerrados, v_borrador
    FROM public.cuadre_items ci
    JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
   WHERE ci.entrega_id = p_entrega_id;
  IF v_cerrados > 0 THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: este cobro ya entró en un cuadre cerrado y firmado del mensajero; corrígelo en Conciliaciones';
  END IF;

  v_antes  := v_ent.cobro_monto;
  v_dif    := v_monto - v_antes;
  v_metodo := upper(COALESCE(NULLIF(TRIM(p_metodo), ''), v_ent.cobro_metodo));

  IF v_dif = 0 AND v_metodo = v_ent.cobro_metodo THEN
    RETURN jsonb_build_object('entrega_id', p_entrega_id, 'servicio_id', v_ent.servicio_id, 'sin_cambios', true);
  END IF;

  -- ¿Este cobro se había sumado a valor_pagado? Solo NO si el servicio ya
  -- estaba en saldo cero cuando el mensajero cobró (TecnicoApp deja esa NOTA).
  v_aplicado := NOT EXISTS (
    SELECT 1 FROM public.novedades_servicio n
     WHERE n.servicio_id = v_ent.servicio_id
       AND n.tipo_novedad = 'NOTA'
       AND n.descripcion LIKE '%YA estaba en saldo cero%'
       AND n.created_at BETWEEN v_ent.cobro_registrado_en - interval '10 minutes'
                            AND v_ent.cobro_registrado_en + interval '10 minutes'
  );

  SELECT COALESCE(valor_total, 0), COALESCE(valor_pagado, 0)
    INTO v_total, v_pagado
    FROM public.servicios WHERE id = v_ent.servicio_id FOR UPDATE;

  IF v_aplicado AND v_monto > 0 AND v_pagado + v_dif > v_total THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: con ese valor el servicio quedaría pagado de más (máximo %)',
      replace(to_char(v_antes + (v_total - v_pagado), 'FM999G999G999'), ',', '.');
  END IF;

  -- ── La entrega (lo que lee el cuadre del mensajero) ─────────────────────────
  IF v_monto = 0 THEN
    UPDATE public.entregas
       SET cobro_monto = NULL, cobro_metodo = NULL, cobro_registrado_por = NULL,
           cobro_no_realizado_motivo = left('Corregido por coordinación: ' || v_motivo, 500)
     WHERE id = p_entrega_id;
  ELSE
    IF v_metodo NOT IN ('EFECTIVO','TRANSFERENCIA','NEQUI','DAVIPLATA','TARJETA','OTRO') THEN
      RAISE EXCEPTION 'METODO_INVALIDO: %', v_metodo;
    END IF;
    IF v_metodo NOT IN ('EFECTIVO','OTRO') AND v_ent.cobro_comprobante_path IS NULL THEN
      RAISE EXCEPTION 'COMPROBANTE_REQUERIDO: un pago % necesita el comprobante en la entrega', v_metodo;
    END IF;
    UPDATE public.entregas
       SET cobro_monto = v_monto, cobro_metodo = v_metodo
     WHERE id = p_entrega_id;
  END IF;

  -- ── El servicio: solo la diferencia ────────────────────────────────────────
  IF v_aplicado THEN
    v_nuevo_pagado := GREATEST(v_pagado + v_dif, 0);
    v_nuevo_estado := CASE
      WHEN v_nuevo_pagado <= 0 THEN 'PENDIENTE'
      WHEN v_nuevo_pagado >= v_total THEN 'COMPLETO'
      ELSE 'PARCIAL' END;
    UPDATE public.servicios
       SET valor_pagado = v_nuevo_pagado,
           estado_pago  = v_nuevo_estado,
           metodo_pago  = CASE WHEN v_nuevo_pagado <= 0 THEN NULL
                               WHEN v_monto > 0 AND metodo_pago = v_ent.cobro_metodo THEN v_metodo
                               ELSE metodo_pago END
     WHERE id = v_ent.servicio_id;
  ELSE
    v_nuevo_pagado := v_pagado;
    SELECT estado_pago INTO v_nuevo_estado FROM public.servicios WHERE id = v_ent.servicio_id;
  END IF;

  -- ── La bitácora se anota, no se reescribe ───────────────────────────────────
  fmt_antes := '$ ' || replace(to_char(v_antes, 'FM999G999G999'), ',', '.');
  fmt_real  := '$ ' || replace(to_char(v_monto, 'FM999G999G999'), ',', '.');
  INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
  VALUES (
    v_ent.servicio_id, 'NOTA',
    'Corrección del cobro en la entrega: se había registrado ' || fmt_antes || ' (' || v_ent.cobro_metodo || ')'
      || CASE WHEN v_monto = 0 THEN ', pero NO se recibió dinero.'
              ELSE ', pero lo recibido fue ' || fmt_real || ' (' || v_metodo || ').' END
      || CASE WHEN v_aplicado
              THEN ' Pagado del servicio: $ ' || replace(to_char(v_nuevo_pagado, 'FM999G999G999'), ',', '.')
                   || ' · saldo pendiente $ ' || replace(to_char(GREATEST(v_total - v_nuevo_pagado, 0), 'FM999G999G999'), ',', '.') || '.'
              ELSE ' (Ese cobro no se había sumado al pago del servicio: el servicio no cambia.)' END
      || ' Observación: ' || v_motivo,
    v_dif, p_actor_id
  );

  RETURN jsonb_build_object(
    'entrega_id',   p_entrega_id,
    'servicio_id',  v_ent.servicio_id,
    'sin_cambios',  false,
    'antes',        v_antes,
    'monto_real',   v_monto,
    'valor_pagado', v_nuevo_pagado,
    'saldo',        GREATEST(v_total - v_nuevo_pagado, 0),
    'estado_pago',  v_nuevo_estado,
    'en_borrador',  v_borrador > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.corregir_cobro_entrega(uuid, numeric, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corregir_cobro_entrega(uuid, numeric, text, text, uuid, text) TO authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- ROLLBACK manual:
--   DROP FUNCTION public.corregir_cobro_entrega(uuid, numeric, text, text, uuid, text);
