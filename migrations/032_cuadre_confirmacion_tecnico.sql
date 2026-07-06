-- ============================================================================
-- 032 — Cuadre técnicos: confirmación bilateral (el técnico confirma el BORRADOR)
-- ----------------------------------------------------------------------------
-- El técnico ve su cuadre en borrador desde TecnicoApp y lo confirma (o deja
-- una observación) ANTES de que el coordinador lo cierre. La confirmación
-- guarda un snapshot del dinero_a_entregar: si el coordinador regenera y el
-- monto cambia, el front detecta que la confirmación quedó desactualizada
-- (sin tocar generar_cuadre_tecnico). El cierre NO se bloquea: la UI muestra
-- la opción explícita "Cerrar SIN confirmación del técnico".
--
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   docker exec -i supabase-db psql -U postgres < 032_cuadre_confirmacion_tecnico.sql
-- ============================================================================

-- ============================================================================
-- 1. Columnas de confirmación en la cabecera del cuadre
-- ============================================================================
ALTER TABLE public.cuadres_tecnico
  ADD COLUMN IF NOT EXISTS tecnico_confirmado_en    timestamptz,
  ADD COLUMN IF NOT EXISTS tecnico_observacion      text,
  ADD COLUMN IF NOT EXISTS tecnico_confirmado_monto numeric;

-- ============================================================================
-- 2. RPC confirmar_cuadre_por_tecnico — el técnico confirma SU cuadre BORRADOR
--    Re-confirmable mientras siga en BORRADOR (la última confirmación gana:
--    si el coordinador regenera, el técnico vuelve a revisar y confirma).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_cuadre_por_tecnico(
  p_cuadre_id   uuid,
  p_tecnico_id  uuid,
  p_observacion text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado  text;
  v_tecnico uuid;
  v_monto   numeric;
BEGIN
  SELECT estado, tecnico_id, dinero_a_entregar INTO v_estado, v_tecnico, v_monto
    FROM public.cuadres_tecnico WHERE id = p_cuadre_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUADRE_NO_EXISTE: %', p_cuadre_id;
  END IF;
  IF v_tecnico IS DISTINCT FROM p_tecnico_id THEN
    RAISE EXCEPTION 'CUADRE_AJENO: solo puedes confirmar tus propios cuadres';
  END IF;
  IF v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: este cuadre ya fue cerrado, no aplica confirmar';
  END IF;

  UPDATE public.cuadres_tecnico SET
    tecnico_confirmado_en    = now(),
    tecnico_observacion      = NULLIF(btrim(p_observacion), ''),
    tecnico_confirmado_monto = v_monto
  WHERE id = p_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id',                p_cuadre_id,
    'tecnico_confirmado_en',    now(),
    'tecnico_confirmado_monto', v_monto,
    'tecnico_observacion',      NULLIF(btrim(p_observacion), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_cuadre_por_tecnico(uuid, uuid, text)
  TO authenticated, service_role;

-- ─── Verificación rápida ─────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'cuadres_tecnico' AND column_name LIKE 'tecnico_%';
