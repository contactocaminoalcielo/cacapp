-- ============================================================================
-- 063 — Cuadres: restaurar ediciones de valor recogido y recargo
-- ----------------------------------------------------------------------------
-- ADMIN y COORDINADOR comparten permisos operativos en ORBIT. Las RPC creadas
-- en 030 y 031 seguían limitadas al rol 6 y ocultaban los lápices al rol 1.
-- Conserva las demás reglas de cada RPC, incluyendo cuadre BORRADOR.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_nombre text;
  v_oid oid;
  v_def text;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY[
    'set_cuadre_item_valor_recogido',
    'set_cuadre_item_recargo_manual'
  ] LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_nombre
    LIMIT 1;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'La RPC public.% no existe', v_nombre;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF position('COALESCE(v_rol, 0) <> 6' in v_def) > 0 THEN
      v_def := replace(
        v_def,
        'COALESCE(v_rol, 0) <> 6',
        'COALESCE(v_rol, 0) NOT IN (1, 6)'
      );
      v_def := replace(v_def, 'SOLO_ADMIN: solo ADMIN', 'SOLO_GESTION: solo ADMIN o COORDINADOR');
      EXECUTE v_def;
    ELSIF position('COALESCE(v_rol, 0) NOT IN (1, 6)' in v_def) = 0 THEN
      RAISE EXCEPTION 'No se encontró la validación de rol esperada en public.%', v_nombre;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
