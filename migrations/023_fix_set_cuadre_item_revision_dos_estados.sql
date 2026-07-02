-- ============================================================================
-- 023 — Fix: set_cuadre_item_revision con los DOS estados nuevos
-- Fecha: 2026-07-02
--
-- La 022 cambió el CHECK de cuadre_items.estado_conciliacion a
-- ('VERIFICADO','PENDIENTE_GESTIONAR'), pero el RPC set_cuadre_item_revision
-- seguía validando contra la lista vieja (VERIFICADO/CORRECTO/PARCIAL/
-- NO_RECOGIO/EXCEDENTE) y lanzaba 'ESTADO_INVALIDO: PENDIENTE_GESTIONAR' al
-- marcar "Pendiente gestionar" en el cuadre. Aquí se recrea el RPC con la
-- lista correcta.
--
-- Aplicar por SSH→psql en Contabo. Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_cuadre_item_revision(
  p_item_id        uuid,
  p_estado         text DEFAULT NULL,
  p_observaciones  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado_cuadre text;
BEGIN
  SELECT c.estado INTO v_estado_cuadre
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE ci.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NO_EXISTE: %', p_item_id;
  END IF;
  IF v_estado_cuadre = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: no se puede editar la revisión de un cuadre cerrado';
  END IF;
  IF p_estado IS NOT NULL AND p_estado NOT IN
       ('VERIFICADO','PENDIENTE_GESTIONAR') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: %', p_estado;
  END IF;

  UPDATE public.cuadre_items SET
    estado_conciliacion = p_estado,
    observaciones       = NULLIF(p_observaciones, '')
  WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'estado', p_estado);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_cuadre_item_revision(uuid, text, text)
  TO authenticated, service_role;
