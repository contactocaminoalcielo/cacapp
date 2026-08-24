-- 114 — Corregir desde Orbit un recibo marcado como cobrado por error
--
-- El caso real (EUGENE, 24-ago-2026): el técnico emitió el recibo marcando
-- $ 223.300 en EFECTIVO que nunca recibió. En Orbit no había forma de
-- deshacerlo: lo único que la UI dejaba tocar era el desplegable de
-- `estado_pago` del Kanban, que cambia ESA columna y nada más — así el servicio
-- queda "PENDIENTE" mientras `valor_pagado`, `metodo_pago` y el recibo siguen
-- diciendo que se cobró, y el cuadre le sigue cobrando el efectivo al técnico.
-- Hubo que arreglarlo por SQL.
--
-- Esta función es la inversa exacta de `guardar_recibo_tecnico`: deja el recibo
-- EXACTAMENTE como si el técnico lo hubiera emitido bien, marcando "pago
-- pendiente". No inventa un estado nuevo — después de revertir, la fila es
-- indistinguible de un recibo sin cobro legítimo, que es lo que el resto del
-- sistema (cuadre, "No cobrados", Cartera, el PDF) ya sabe leer.
--
-- Lo que NO hace: borrar el recibo ni la novedad PAGO_RECIBIDO del técnico. La
-- bitácora no se reescribe — se le agrega la corrección, con quién y por qué.

BEGIN;

CREATE OR REPLACE FUNCTION public.revertir_cobro_recibo(
  p_recibo_id uuid,
  p_actor_id  uuid  DEFAULT NULL,
  p_actor_rol text  DEFAULT NULL,
  p_motivo    text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_servicio_id     uuid;
  v_numero          text;
  v_valor_cobrado   numeric;
  v_pago_aplicado   numeric;
  v_medios_txt      text;
  v_n_medios        int;
  v_valor_total_svc numeric;
  v_valor_pagado    numeric;
  v_nuevo_pagado    numeric;
  v_nuevo_estado    text;
  v_cerrados        int;
BEGIN
  IF p_recibo_id IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: recibo_id es obligatorio';
  END IF;

  -- Solo coordinación/gerencia. Un técnico no se corrige a sí mismo el cobro:
  -- esto mueve dinero en el cuadre que él mismo firma.
  IF p_actor_rol IS NULL OR p_actor_rol NOT IN ('COORDINADOR','ADMIN') THEN
    RAISE EXCEPTION 'NO_AUTORIZADO: solo coordinación o gerencia puede corregir un cobro';
  END IF;

  IF COALESCE(TRIM(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: hay que decir por qué se corrige el cobro';
  END IF;

  SELECT servicio_id, numero_recibo, COALESCE(valor_cobrado,0), COALESCE(pago_aplicado,0)
    INTO v_servicio_id, v_numero, v_valor_cobrado, v_pago_aplicado
  FROM public.recibos_tecnico
  WHERE id = p_recibo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECIBO_NO_EXISTE: %', p_recibo_id;
  END IF;

  -- Un cuadre CERRADO es inmutable por diseño (migración 015): si el efectivo ya
  -- se entregó y se firmó, esto no se deshace por detrás — se resuelve en
  -- Conciliaciones, que sí sabe trabajar sobre un cuadre cerrado.
  SELECT count(*) INTO v_cerrados
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE ci.recibo_id = p_recibo_id AND c.estado = 'CERRADO';

  IF v_cerrados > 0 THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: este recibo ya entró en un cuadre cerrado y firmado; corrígelo en Conciliaciones';
  END IF;

  SELECT count(*), string_agg(metodo || ' $ ' || replace(to_char(monto, 'FM999G999G999'), ',', '.'), ', ')
    INTO v_n_medios, v_medios_txt
  FROM public.recibo_medios_pago
  WHERE recibo_id = p_recibo_id;

  -- Idempotente: si ya está sin cobro, no hay nada que deshacer.
  IF v_valor_cobrado = 0 AND v_pago_aplicado = 0 AND COALESCE(v_n_medios,0) = 0 THEN
    RETURN jsonb_build_object(
      'recibo_id', p_recibo_id, 'servicio_id', v_servicio_id,
      'ya_revertido', true, 'valor_revertido', 0
    );
  END IF;

  -- ── El dinero que nunca entró ───────────────────────────────────────────────
  -- Los comprobantes de ESTE recibo se van con sus medios (el archivo sigue en
  -- storage). Los comprobantes atados solo al servicio — los que sube
  -- coordinación desde la ficha — llevan recibo_id NULL y no se tocan.
  DELETE FROM public.recibo_comprobantes WHERE recibo_id = p_recibo_id;
  DELETE FROM public.recibo_medios_pago  WHERE recibo_id = p_recibo_id;

  -- `total_recibido` se normaliza a 0 a propósito: el PDF del recibo cae al
  -- snapshot del formulario y, si no, seguiría diciendo que se cobró
  -- (la misma trampa de la migración 068).
  UPDATE public.recibos_tecnico
     SET valor_cobrado = 0,
         pago_aplicado = 0,
         medios_pago   = '[]'::jsonb,
         datos_form    = COALESCE(datos_form,'{}'::jsonb)
                         || jsonb_build_object('pago_pendiente', true, 'total_recibido', 0)
   WHERE id = p_recibo_id;

  -- ── El servicio ─────────────────────────────────────────────────────────────
  -- Se resta EXACTAMENTE lo que este recibo había aportado (`pago_aplicado`), no
  -- se recalcula desde los recibos: `valor_pagado` también puede traer abonos
  -- que registró coordinación en Cartera, y esos no tienen recibo del técnico.
  SELECT COALESCE(valor_total,0), COALESCE(valor_pagado,0)
    INTO v_valor_total_svc, v_valor_pagado
  FROM public.servicios WHERE id = v_servicio_id FOR UPDATE;

  v_nuevo_pagado := GREATEST(v_valor_pagado - v_pago_aplicado, 0);
  v_nuevo_estado := CASE
    WHEN v_nuevo_pagado <= 0 THEN 'PENDIENTE'
    WHEN v_nuevo_pagado >= v_valor_total_svc THEN 'COMPLETO'
    ELSE 'PARCIAL' END;

  UPDATE public.servicios
     SET valor_pagado = v_nuevo_pagado,
         estado_pago  = v_nuevo_estado,
         -- Si no queda nada pagado no hay método que valga; si quedan abonos de
         -- Cartera, el método de aquellos se conserva.
         metodo_pago  = CASE WHEN v_nuevo_pagado <= 0 THEN NULL ELSE metodo_pago END
   WHERE id = v_servicio_id;

  -- ── La bitácora se anota, no se reescribe ───────────────────────────────────
  INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
  VALUES (
    v_servicio_id, 'NOTA',
    'Corrección de cobro — recibo No. ' || COALESCE(v_numero,'?') || ': se había registrado como cobrado '
      || '$ ' || replace(to_char(v_valor_cobrado, 'FM999G999G999'), ',', '.')
      || COALESCE(' (' || v_medios_txt || ')', '')
      || ', pero ese dinero NO se recibió. El recibo queda como PAGO PENDIENTE y el cobro sigue abierto.'
      || ' Motivo: ' || TRIM(p_motivo)
      || ' · La novedad PAGO_RECIBIDO anterior se conserva por trazabilidad y no corresponde a un cobro real.',
    0, p_actor_id
  );

  RETURN jsonb_build_object(
    'recibo_id',       p_recibo_id,
    'servicio_id',     v_servicio_id,
    'ya_revertido',    false,
    'valor_revertido', v_valor_cobrado,
    'valor_pagado',    v_nuevo_pagado,
    'estado_pago',     v_nuevo_estado
  );
END;
$$;

-- La función decide la autorización por p_actor_rol; nadie anónimo la ejecuta.
REVOKE ALL ON FUNCTION public.revertir_cobro_recibo(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_cobro_recibo(uuid, uuid, text, text) TO authenticated, service_role;

COMMIT;
