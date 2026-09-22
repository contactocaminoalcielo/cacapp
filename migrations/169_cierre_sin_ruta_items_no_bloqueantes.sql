-- El cierre automático sin ruta (148/160) exigía TODOS los ítems ENTREGADOS, y
-- «Día de amor y milagrino» se queda en PENDIENTE a propósito (David
-- 2026-07-16: la plantilla de digitales no lo menciona, así que nadie lo
-- marca). Resultado: ningún ECO_GRUPAL cerraba solo — se quedaban 5/6 listos
-- para siempre. Decisión David 2026-09-22: por el momento ese ítem se IGNORA
-- en el cierre. Sigue PENDIENTE en el tablero; solo deja de frenar el servicio.
--
-- La lista de ítems que no bloquean vive en config_operativa
-- (CIERRE_SIN_RUTA.items_no_bloqueantes, arreglo de ids de `recordatorios`),
-- no quemada en la función: si mañana se define cómo se cumple ese ítem, se
-- saca de la lista sin desplegar. El id se resuelve UNA vez aquí por nombre y
-- se persiste; la función cruza siempre por id.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Configuración: qué ítems no bloquean el cierre ────────────────────────
DO $do$
DECLARE v_id uuid; v_n integer;
BEGIN
  SELECT count(*), (array_agg(id))[1] INTO v_n, v_id FROM public.recordatorios WHERE nombre ILIKE '%milagrino%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente un recordatorio «Día de amor y milagrino» y hay %; revisar el catálogo antes de aplicar', v_n;
  END IF;

  INSERT INTO public.config_operativa (modulo, clave, valor, descripcion)
  VALUES ('CIERRE_SIN_RUTA', 'items_no_bloqueantes', jsonb_build_array(v_id),
    'Ids de `recordatorios` que NO frenan el cierre automático sin ruta (ECO_GRUPAL, DESAMPARADO, ANGEL, BASICO_SIN_REC). Siguen en su estado en el tablero; solo se ignoran al decidir si el servicio ya se entregó. Hoy: «Día de amor y milagrino», que queda PENDIENTE a propósito porque la plantilla de digitales no lo entrega (David 2026-07-16 y 2026-09-22).')
  ON CONFLICT (modulo, clave) DO UPDATE
    SET valor = (SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements(config_operativa.valor || EXCLUDED.valor) e),
        descripcion = EXCLUDED.descripcion, updated_at = now();
END $do$;

-- ── 2. La función lee la lista y excluye esos ítems ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cerrar_servicio_sin_ruta(p_servicio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_codigo text; v_no_bloquean uuid[];
BEGIN
  -- Serializa envíos simultáneos de certificado y digitales. El estado final
  -- del segundo envío debe ver lo que confirmó el primero.
  SELECT p.codigo INTO v_codigo
    FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
    WHERE s.id=p_servicio_id
      AND p.codigo IN ('ECO_GRUPAL','DESAMPARADO','ANGEL','BASICO_SIN_REC')
      AND s.estado NOT IN ('ENTREGADO','CANCELADO') FOR UPDATE OF s;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_codigo='ECO_GRUPAL' AND NOT EXISTS (SELECT 1 FROM public.digitales_envios
       WHERE servicio_id=p_servicio_id AND estado='ENVIADO') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reportes_grupales_envios
                 WHERE servicio_id=p_servicio_id AND estado='ENVIADO') THEN RETURN; END IF;

  -- Ítems que no frenan el cierre (config_operativa). Un valor mal formado se
  -- trata como lista vacía: la regla vuelve a ser la estricta, nunca más laxa.
  BEGIN
    SELECT COALESCE(array_agg((e#>>'{}')::uuid), '{}') INTO v_no_bloquean
      FROM public.config_operativa c, jsonb_array_elements(c.valor) e
      WHERE c.modulo='CIERRE_SIN_RUTA' AND c.clave='items_no_bloqueantes'
        AND jsonb_typeof(c.valor)='array';
  EXCEPTION WHEN OTHERS THEN v_no_bloquean := '{}';
  END;
  v_no_bloquean := COALESCE(v_no_bloquean, '{}');

  -- No interpretar ausencia de ítems como un servicio completo: tiene que haber
  -- al menos un ítem que sí cuente, y todos los que cuentan deben estar ENTREGADOS.
  IF NOT EXISTS (SELECT 1 FROM public.servicio_recordatorios
                 WHERE servicio_id=p_servicio_id AND COALESCE(origen,'')<>'REMOVIDO' AND estado<>'NA'
                   AND NOT (recordatorio_id = ANY(v_no_bloquean)))
     OR EXISTS (SELECT 1 FROM public.servicio_recordatorios
                 WHERE servicio_id=p_servicio_id AND COALESCE(origen,'')<>'REMOVIDO'
                   AND estado IS DISTINCT FROM 'NA' AND estado IS DISTINCT FROM 'ENTREGADO'
                   AND NOT (recordatorio_id = ANY(v_no_bloquean))) THEN RETURN; END IF;

  -- Una ruta física ya asignada requiere cierre por quien la realiza.
  PERFORM servicio_id FROM public.entregas WHERE servicio_id=p_servicio_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.entregas WHERE servicio_id=p_servicio_id
    AND estado<>'ENTREGADA' AND (mensajero_id IS NOT NULL OR estado NOT IN ('PENDIENTE','DISPONIBLE'))) THEN RETURN; END IF;

  UPDATE public.entregas SET estado='ENTREGADA',
    notas=concat_ws(E'\n',NULLIF(notas,''),'Cierre automático '||v_codigo||': comprobante enviado y todos los ítems entregados; sin ruta física.')
    WHERE servicio_id=p_servicio_id AND mensajero_id IS NULL
      AND estado IN ('PENDIENTE','DISPONIBLE');

  UPDATE public.servicios SET estado='ENTREGADO',
    fecha_entrega_real=COALESCE(fecha_entrega_real,(now() AT TIME ZONE 'America/Bogota')::date)
    WHERE id=p_servicio_id AND estado NOT IN ('ENTREGADO','CANCELADO');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cerrar_servicio_sin_ruta(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Los que ya cumplían la regla nueva ────────────────────────────────────
-- Los triggers solo actúan por evento y estos servicios no se van a mover más.
-- La función decide; aquí no se fuerza ningún estado.
DO $do$
DECLARE r record; v_antes integer; v_despues integer;
BEGIN
  SELECT count(*) INTO v_antes FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
    WHERE p.codigo IN ('ECO_GRUPAL','DESAMPARADO','ANGEL','BASICO_SIN_REC')
      AND s.estado NOT IN ('ENTREGADO','CANCELADO');
  FOR r IN SELECT s.id FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
            WHERE p.codigo IN ('ECO_GRUPAL','DESAMPARADO','ANGEL','BASICO_SIN_REC')
              AND s.estado NOT IN ('ENTREGADO','CANCELADO')
  LOOP
    PERFORM public.fn_cerrar_servicio_sin_ruta(r.id);
  END LOOP;
  SELECT count(*) INTO v_despues FROM public.servicios s JOIN public.planes p ON p.id=s.plan_id
    WHERE p.codigo IN ('ECO_GRUPAL','DESAMPARADO','ANGEL','BASICO_SIN_REC')
      AND s.estado NOT IN ('ENTREGADO','CANCELADO');
  RAISE NOTICE 'Cierre sin ruta: % abiertos antes, % cerrados ahora, % siguen abiertos', v_antes, v_antes - v_despues, v_despues;
END $do$;
COMMIT;
