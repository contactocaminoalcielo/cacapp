-- ============================================================================
-- 070 — Descartar cuadres en BORRADOR que no se usaron
-- ----------------------------------------------------------------------------
-- David (2026-07-22): "poder tener un botón para quitar esos borradores que no
-- se utilizaron". Al probar rangos se acumulan borradores solapados del mismo
-- técnico (Giovanni llegó a tener 5 del mismo periodo) y ensucian la lista de
-- "Cuadres anteriores"; además cada uno duplica los mismos servicios, que es
-- justo lo que confunde al revisar.
--
-- Reglas:
--   · SOLO estado BORRADOR. Un cuadre CERRADO es la constancia del dinero
--     entregado: no se borra nunca (la RPC lo rechaza).
--   · Solo ADMIN(6) o COORDINADOR(1), igual que las demás ediciones del cuadre.
--   · Borrar el cuadre arrastra sus cuadre_items (FK ON DELETE CASCADE). NO
--     toca recibos, servicios ni dinero: el borrador es un cálculo, no un hecho.
--     Los servicios vuelven a entrar cuando se genere el cuadre otra vez.
--   · Devuelve lo borrado para poder dejarlo en pantalla / auditar.
--
-- Aplicar por SSH→psql en Contabo. Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_cuadre_borrador(
  p_cuadre_id uuid,
  p_actor_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol        int;
  v_estado     text;
  v_tecnico    uuid;
  v_desde      date;
  v_hasta      date;
  v_items      int;
  v_confirmado timestamptz;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUERIDO: se requiere usuario admin o coordinador';
  END IF;

  SELECT rol_principal_id INTO v_rol
  FROM public.personal
  WHERE id = p_actor_id;

  IF COALESCE(v_rol, 0) NOT IN (1, 6) THEN
    RAISE EXCEPTION 'SOLO_GESTION: solo ADMIN o COORDINADOR puede descartar un borrador';
  END IF;

  SELECT estado, tecnico_id, fecha_desde, fecha_hasta, tecnico_confirmado_en
    INTO v_estado, v_tecnico, v_desde, v_hasta, v_confirmado
  FROM public.cuadres_tecnico
  WHERE id = p_cuadre_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUADRE_NO_EXISTE: %', p_cuadre_id;
  END IF;
  IF v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: un cuadre cerrado no se puede descartar';
  END IF;

  SELECT count(*) INTO v_items
  FROM public.cuadre_items WHERE cuadre_id = p_cuadre_id;

  DELETE FROM public.cuadres_tecnico WHERE id = p_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id', p_cuadre_id,
    'tecnico_id', v_tecnico,
    'fecha_desde', v_desde,
    'fecha_hasta', v_hasta,
    'items_borrados', v_items,
    'tenia_confirmacion_tecnico', v_confirmado IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.eliminar_cuadre_borrador(uuid, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
