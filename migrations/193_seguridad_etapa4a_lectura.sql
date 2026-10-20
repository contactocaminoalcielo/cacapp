-- ============================================================================
-- 193 — Seguridad etapa 4a: lo que cada quien NO necesita leer (sin cambio de
--       pantallas) + preparar la llave del portal de aliados
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10 · etapa 4 (lectura por rol), docs/auditoria/11-matriz-rbac.md.
-- Requiere 188 (es_coordinacion) y 191 (mi_personal_id, mi_rol).
-- Mapa de lecturas por rol: agentes de auditoría, 20-oct.
--
-- 1. aliados.tiene_acceso: columna calculada (¿la vet tiene enlace al portal?).
--    Es lo único que Configuración necesita saber de token_acceso; la 194 le
--    quita al navegador la lectura de la llave misma (hoy la lee cualquier
--    sesión, incluso en vivo desde el Kanban del productor).
-- 2. notificaciones: cada quien lee y marca SOLO las suyas (Topbar ya filtra por
--    para_personal_id); coordinación todas. Crear sigue abierto: el técnico le
--    escribe a coordinación.
-- 3. autorizaciones_datos y solicitudes_servicio: solo las LEE coordinación
--    (Gestión › Autorizaciones y la columna SOLICITUDES del Kanban). Insertar
--    sigue igual (formularios internos y público con sesión abierta).
-- 4. crm_*: el CRM va todo por el backend; por la API solo coordinación y el
--    comercial (hoy cualquier sesión).
-- Ninguna pantalla da error: las consultas de otros roles devuelven 0 filas.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.aliados
  ADD COLUMN IF NOT EXISTS tiene_acceso boolean GENERATED ALWAYS AS (token_acceso IS NOT NULL) STORED;

-- 2 ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS auth_full ON public.notificaciones;
DROP POLICY IF EXISTS crear ON public.notificaciones;
DROP POLICY IF EXISTS mias ON public.notificaciones;
CREATE POLICY crear ON public.notificaciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mias ON public.notificaciones FOR ALL TO authenticated
  USING (para_personal_id = (SELECT public.mi_personal_id()) OR (SELECT public.es_coordinacion()))
  WITH CHECK (para_personal_id = (SELECT public.mi_personal_id()) OR (SELECT public.es_coordinacion()));

-- 3 ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS auth_lectura ON public.autorizaciones_datos;
DROP POLICY IF EXISTS lee_coordinacion ON public.autorizaciones_datos;
CREATE POLICY lee_coordinacion ON public.autorizaciones_datos FOR SELECT TO authenticated
  USING ((SELECT public.es_coordinacion()));

DROP POLICY IF EXISTS auth_full ON public.solicitudes_servicio;
DROP POLICY IF EXISTS crear ON public.solicitudes_servicio;
DROP POLICY IF EXISTS escribe_coordinacion ON public.solicitudes_servicio;
CREATE POLICY crear ON public.solicitudes_servicio FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY escribe_coordinacion ON public.solicitudes_servicio FOR ALL TO authenticated
  USING ((SELECT public.es_coordinacion())) WITH CHECK ((SELECT public.es_coordinacion()));

-- 4 ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies
            WHERE schemaname = 'public' AND tablename LIKE 'crm\_%' AND policyname = 'auth_select' LOOP
    EXECUTE format('DROP POLICY auth_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS lee_crm ON public.%I', t);
    EXECUTE format('CREATE POLICY lee_crm ON public.%I FOR SELECT TO authenticated '
                   'USING ((SELECT public.es_coordinacion()) OR (SELECT public.mi_rol()) = ''COMERCIAL'')', t);
  END LOOP;
END $$;

COMMIT;

-- ROLLBACK:
--   ALTER TABLE public.aliados DROP COLUMN tiene_acceso;   (antes, revertir la 194)
--   notificaciones / solicitudes_servicio: CREATE POLICY auth_full … FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   autorizaciones_datos: CREATE POLICY auth_lectura … FOR SELECT TO authenticated USING (true);
--   crm_*: CREATE POLICY auth_select … FOR SELECT TO authenticated USING (true);
