-- ============================================================================
-- 062 — Cuadres: ADMIN y COORDINADOR pueden reclasificar medios de pago
-- ----------------------------------------------------------------------------
-- ROLE_CONFIG establece que ambos roles comparten permisos de administración.
-- La migración 060 dejó esta RPC limitada por error al rol 6 (ADMIN).
-- Conserva las demás reglas: borrador, no cancelado, motivo obligatorio y
-- total cobrado invariable.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'set_cuadre_item_medios'
    AND pg_get_function_identity_arguments(p.oid) = 'p_item_id uuid, p_medios jsonb, p_actor_id uuid, p_motivo text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'La RPC public.set_cuadre_item_medios no existe; aplica primero la migración 060';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('COALESCE(v_rol, 0) <> 6' in v_def) = 0 THEN
    IF position('COALESCE(v_rol, 0) NOT IN (1, 6)' in v_def) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'No se encontró la validación de rol esperada en set_cuadre_item_medios';
  END IF;

  v_def := replace(
    v_def,
    'COALESCE(v_rol, 0) <> 6',
    'COALESCE(v_rol, 0) NOT IN (1, 6)'
  );
  v_def := replace(
    v_def,
    'SOLO_ADMIN: solo ADMIN puede reclasificar los medios de pago',
    'SOLO_GESTION: solo ADMIN o COORDINADOR puede reclasificar los medios de pago'
  );

  EXECUTE v_def;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
