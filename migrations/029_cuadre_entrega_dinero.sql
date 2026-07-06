-- ============================================================================
-- 029 — Cuadre técnicos: confirmación de entrega del dinero a gerencia
-- ----------------------------------------------------------------------------
-- Después de cerrar un cuadre, el técnico entrega el efectivo físicamente.
-- Hasta ahora no quedaba registro de que gerencia lo recibió. Esta migración
-- agrega el registro (quién recibió, cuándo, monto y notas) sobre la cabecera
-- del cuadre + RPC para confirmarlo (solo cuadres CERRADOS, una sola vez).
--
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   docker exec -i supabase-db psql -U postgres < 029_cuadre_entrega_dinero.sql
-- ============================================================================

-- ============================================================================
-- 1. Columnas de entrega en la cabecera del cuadre
-- ============================================================================
ALTER TABLE public.cuadres_tecnico
  ADD COLUMN IF NOT EXISTS entrega_confirmada_en  timestamptz,
  ADD COLUMN IF NOT EXISTS entrega_confirmada_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS entrega_monto          numeric,
  ADD COLUMN IF NOT EXISTS entrega_notas          text;

-- ============================================================================
-- 2. RPC confirmar_entrega_cuadre — gerencia confirma que recibió el efectivo
--    Solo aplica a cuadres CERRADOS y una sola vez (el registro es inmutable,
--    igual que el cierre). El monto puede diferir de dinero_a_entregar
--    (entrega parcial o acordada distinta) y queda como dato de auditoría.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_entrega_cuadre(
  p_cuadre_id uuid,
  p_actor_id  uuid    DEFAULT NULL,
  p_monto     numeric DEFAULT NULL,
  p_notas     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado    text;
  v_entregada timestamptz;
BEGIN
  SELECT estado, entrega_confirmada_en INTO v_estado, v_entregada
    FROM public.cuadres_tecnico WHERE id = p_cuadre_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUADRE_NO_EXISTE: %', p_cuadre_id;
  END IF;
  IF v_estado <> 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_NO_CERRADO: la entrega solo se confirma sobre cuadres cerrados';
  END IF;
  IF v_entregada IS NOT NULL THEN
    RAISE EXCEPTION 'ENTREGA_YA_CONFIRMADA: este cuadre ya tiene la entrega de dinero confirmada';
  END IF;

  UPDATE public.cuadres_tecnico SET
    entrega_confirmada_en  = now(),
    entrega_confirmada_por = p_actor_id,
    entrega_monto          = p_monto,
    entrega_notas          = NULLIF(btrim(p_notas), '')
  WHERE id = p_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id',              p_cuadre_id,
    'entrega_confirmada_en',  now(),
    'entrega_confirmada_por', p_actor_id,
    'entrega_monto',          p_monto
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_entrega_cuadre(uuid, uuid, numeric, text)
  TO authenticated, service_role;

-- ─── Verificación rápida ─────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'cuadres_tecnico' AND column_name LIKE 'entrega%';
