-- ============================================================================
-- 038 — Cerrar cuadre REQUIERE la firma del técnico (o motivo registrado)
--
-- Decisión David 2026-07-08 (cambia la decisión de la 032, que solo avisaba):
--   - El técnico confirma ("firma") su cuadre BORRADOR desde Mis pagos › Cuadres
--     (RPC confirmar_cuadre_por_tecnico, migración 032 — sin cambios).
--   - cerrar_cuadre v2: si NO hay confirmación vigente (nunca confirmó, o
--     confirmó una versión con otros montos), el cierre se BLOQUEA salvo que
--     el coordinador/admin pase un motivo (p_forzar_motivo), que queda
--     registrado en firma.cierre_forzado = {motivo, actor_id, en}.
--   - Confirmación vigente = tecnico_confirmado_en presente Y el monto
--     confirmado (snapshot) igual al dinero_a_entregar actual — la misma regla
--     del chip en Finanzas y de la invalidación automática al editar valores.
--
-- El gate vive en la DB a propósito: una PWA/bundle viejo en caché no puede
-- saltárselo (mismo patrón del gate "no entra al cuarto frío sin recibo").
-- Se DROPea la versión de 3 parámetros para NO dejar una sobrecarga sin gate.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.cerrar_cuadre(uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.cerrar_cuadre(
  p_cuadre_id     uuid,
  p_actor_id      uuid  DEFAULT NULL,
  p_firma         jsonb DEFAULT NULL,
  p_forzar_motivo text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado     text;
  v_conf_en    timestamptz;
  v_conf_monto numeric;
  v_dinero     numeric;
  v_confirmado boolean;
  v_firma      jsonb;
BEGIN
  SELECT estado, tecnico_confirmado_en, tecnico_confirmado_monto, dinero_a_entregar
    INTO v_estado, v_conf_en, v_conf_monto, v_dinero
  FROM public.cuadres_tecnico
  WHERE id = p_cuadre_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUADRE_NO_EXISTE: %', p_cuadre_id;
  END IF;
  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_YA_CERRADO: este cuadre ya fue cerrado';
  END IF;

  -- Confirmación vigente del técnico (misma regla que el chip de Finanzas)
  v_confirmado := v_conf_en IS NOT NULL AND v_conf_monto IS NOT DISTINCT FROM v_dinero;

  v_firma := COALESCE(p_firma, '{}'::jsonb);

  IF NOT v_confirmado THEN
    IF p_forzar_motivo IS NULL OR btrim(p_forzar_motivo) = '' THEN
      RAISE EXCEPTION 'SIN_CONFIRMACION_TECNICO: el técnico aún no ha firmado este cuadre (o firmó una versión con otros montos). Pídele que lo confirme desde su app, o cierra con un motivo que quedará registrado.';
    END IF;
    v_firma := v_firma || jsonb_build_object('cierre_forzado', jsonb_build_object(
      'motivo',   btrim(p_forzar_motivo),
      'actor_id', p_actor_id,
      'en',       now()
    ));
  END IF;

  UPDATE public.cuadres_tecnico SET
    estado      = 'CERRADO',
    cerrado_por = p_actor_id,
    cerrado_en  = now(),
    firma       = v_firma
  WHERE id = p_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id', p_cuadre_id,
    'estado', 'CERRADO',
    'cierre_forzado', NOT v_confirmado
  );
END;
$$;

-- El DROP borra los GRANTs: restaurar los mismos que tenía (baseline del proyecto)
GRANT EXECUTE ON FUNCTION public.cerrar_cuadre(uuid, uuid, jsonb, text) TO anon, authenticated, service_role;

COMMIT;
