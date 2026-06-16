-- ============================================================================
-- Endurecimiento RLS — Recibos del Técnico (Fase 6)
-- Fecha: 2026-06-16
--
-- ESTADO: PREPARADO, NO ACTIVADO POR DEFECTO.
--
-- Por qué NO se activa aún:
--   La RLS por-técnico necesita mapear auth.uid() → personal.id vía
--   `personal.auth_user_id`. Hoy ese mapeo es FRÁGIL: AuthContext también
--   resuelve al usuario por email cuando auth_user_id es NULL. Si activamos
--   estas policies con técnicos que tengan auth_user_id NULL, quedarían
--   BLOQUEADOS para ver/crear sus recibos → rompe el flujo de campo.
--
-- PRECONDICIÓN para activar (PASO 1): backfillear auth_user_id para TODO el
-- personal con login y verificar que no quede ninguno en NULL:
--
--   SELECT id, nombre, email, auth_user_id, rol_principal_id
--   FROM public.personal
--   WHERE activo = true AND auth_user_id IS NULL AND rol_principal_id IN (2,3); -- TECNICO, MENSAJERO
--   -- Debe devolver 0 filas antes de activar las policies estrictas.
--
-- Solo cuando esa consulta dé 0 filas, descomentar el bloque "POLICIES ESTRICTAS".
-- ============================================================================

BEGIN;

-- ─── Helpers (seguros de crear ya; no cambian comportamiento por sí solos) ──
-- personal.id del usuario autenticado actual (NULL si no hay mapeo).
CREATE OR REPLACE FUNCTION public.app_personal_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.personal WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ¿el usuario actual es COORDINADOR(1) o ADMIN(6)?
CREATE OR REPLACE FUNCTION public.app_is_admin_coord()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.personal
    WHERE auth_user_id = auth.uid()
      AND COALESCE(activo, true) = true
      AND rol_principal_id IN (1, 6)
  );
$$;

GRANT EXECUTE ON FUNCTION public.app_personal_id()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_admin_coord()  TO authenticated;

COMMIT;

-- ============================================================================
-- POLICIES ESTRICTAS — DESCOMENTAR SOLO TRAS CUMPLIR LA PRECONDICIÓN (PASO 2)
-- ============================================================================
-- Reemplazan el `auth_full USING(true)` por acceso por-técnico. Admin/coord ven
-- todo. Técnico solo los recibos de servicios donde está asignado en
-- recogidas.tecnico_id (cae a servicios.tecnico_id si la recogida no lo tiene).
--
-- BEGIN;
--
-- -- recibos_tecnico
-- DROP POLICY IF EXISTS "auth_full" ON public.recibos_tecnico;
-- CREATE POLICY "recibo_admin_coord" ON public.recibos_tecnico
--   FOR ALL TO authenticated
--   USING (public.app_is_admin_coord())
--   WITH CHECK (public.app_is_admin_coord());
-- CREATE POLICY "recibo_tecnico_propio" ON public.recibos_tecnico
--   FOR ALL TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (
--         SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL
--         ORDER BY r.id DESC LIMIT 1
--       ) rg ON true
--       WHERE s.id = recibos_tecnico.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id()
--     )
--   )
--   WITH CHECK (
--     EXISTS (
--       SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (
--         SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL
--         ORDER BY r.id DESC LIMIT 1
--       ) rg ON true
--       WHERE s.id = recibos_tecnico.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id()
--     )
--   );
--
-- -- recibo_medios_pago (mismo criterio, por servicio_id de la fila)
-- DROP POLICY IF EXISTS "auth_full" ON public.recibo_medios_pago;
-- CREATE POLICY "medios_admin_coord" ON public.recibo_medios_pago
--   FOR ALL TO authenticated
--   USING (public.app_is_admin_coord()) WITH CHECK (public.app_is_admin_coord());
-- CREATE POLICY "medios_tecnico_propio" ON public.recibo_medios_pago
--   FOR ALL TO authenticated
--   USING (
--     EXISTS (SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL ORDER BY r.id DESC LIMIT 1) rg ON true
--       WHERE s.id = recibo_medios_pago.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id())
--   )
--   WITH CHECK (
--     EXISTS (SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL ORDER BY r.id DESC LIMIT 1) rg ON true
--       WHERE s.id = recibo_medios_pago.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id())
--   );
--
-- -- recibo_comprobantes: técnico crea/ve los suyos; SOLO admin/coord cambian estado/revisión.
-- DROP POLICY IF EXISTS "auth_full" ON public.recibo_comprobantes;
-- CREATE POLICY "compro_admin_coord" ON public.recibo_comprobantes
--   FOR ALL TO authenticated
--   USING (public.app_is_admin_coord()) WITH CHECK (public.app_is_admin_coord());
-- CREATE POLICY "compro_tecnico_propio" ON public.recibo_comprobantes
--   FOR SELECT TO authenticated
--   USING (
--     EXISTS (SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL ORDER BY r.id DESC LIMIT 1) rg ON true
--       WHERE s.id = recibo_comprobantes.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id())
--   );
-- CREATE POLICY "compro_tecnico_insert" ON public.recibo_comprobantes
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     uploaded_by = public.app_personal_id()
--     AND EXISTS (SELECT 1 FROM public.servicios s
--       LEFT JOIN LATERAL (SELECT tecnico_id FROM public.recogidas r
--         WHERE r.servicio_id = s.id AND r.tecnico_id IS NOT NULL ORDER BY r.id DESC LIMIT 1) rg ON true
--       WHERE s.id = recibo_comprobantes.servicio_id
--         AND COALESCE(rg.tecnico_id, s.tecnico_id) = public.app_personal_id())
--   );
--
-- COMMIT;
--
-- ── ROLLBACK (volver al baseline auth_full) ────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS "recibo_admin_coord"   ON public.recibos_tecnico;
-- DROP POLICY IF EXISTS "recibo_tecnico_propio" ON public.recibos_tecnico;
-- CREATE POLICY "auth_full" ON public.recibos_tecnico FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "medios_admin_coord"    ON public.recibo_medios_pago;
-- DROP POLICY IF EXISTS "medios_tecnico_propio" ON public.recibo_medios_pago;
-- CREATE POLICY "auth_full" ON public.recibo_medios_pago FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "compro_admin_coord"    ON public.recibo_comprobantes;
-- DROP POLICY IF EXISTS "compro_tecnico_propio" ON public.recibo_comprobantes;
-- DROP POLICY IF EXISTS "compro_tecnico_insert" ON public.recibo_comprobantes;
-- CREATE POLICY "auth_full" ON public.recibo_comprobantes FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- COMMIT;
