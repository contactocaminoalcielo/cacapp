-- ============================================================================
-- 188 — Seguridad: nadie se cambia el rol a sí mismo (RBAC-001, CRÍTICA)
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10-19 · docs/auditoria/11-matriz-rbac.md.
--
-- `personal` tenía la política auth_full (TO authenticated USING true WITH
-- CHECK true): cualquier usuario con sesión —un técnico, el operario, el
-- comercial— podía, con su propio JWT y una petición a la API REST:
--   · cambiarse `rol_principal_id` a ADMIN (el backend lee el rol de ahí en
--     cada petición, orbit-backend/src/auth.js:23-30 → acceso total);
--   · ponerse el `auth_user_id`/`email` de la fila de un admin (auth.js busca
--     por auth_user_id O email → entraría como ese admin);
--   · reactivar o desactivar gente, crear o borrar personal.
-- Y `roles_personal` también era auth_full: renombrar el rol 2 a 'ADMIN'
-- convertía en admin a todos los técnicos de un golpe.
--
-- Qué cambia: desde el navegador, solo ADMIN/COORDINADOR crean, borran o tocan
-- las columnas de identidad y permiso de `personal`, y solo ellos escriben en
-- `roles_personal`/`personal_roles`. Las pantallas que hoy lo hacen (Gestión y
-- Configuración) son de coordinación: no cambian. El backend (orbit_backend),
-- la función admin-auth (service_role) y postgres no pasan por este control.
-- Lo demás de `personal` (nombre, teléfono…) queda como está: se ordena en el
-- plan de RBAC por etapas, no aquí.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ¿Quien llama es ADMIN o COORDINADOR activo? Mismo criterio que auth.js:
-- su fila de personal por auth_user_id o por el email del JWT.
CREATE OR REPLACE FUNCTION public.es_coordinacion()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.personal p
      JOIN public.roles_personal r ON r.id = p.rol_principal_id
     WHERE p.activo
       AND r.nombre IN ('ADMIN', 'COORDINADOR')
       AND (p.auth_user_id = auth.uid()
            OR lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', '#'))))
$$;
REVOKE ALL ON FUNCTION public.es_coordinacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_coordinacion() TO authenticated, service_role, orbit_backend;

-- Guardia de `personal`. Solo aplica a peticiones del NAVEGADOR (rol
-- authenticated); el backend y los procesos internos usan otros roles.
-- ⚠️ SIN `SECURITY DEFINER` a propósito: dentro de una función así,
-- current_user es el DUEÑO (postgres) y la guardia nunca se activaría (el
-- ensayo lo demostró: el técnico se cambiaba el rol igual). La consulta de
-- quién es coordinación ya está protegida dentro de es_coordinacion().
CREATE OR REPLACE FUNCTION public.fn_personal_guardia()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user <> 'authenticated' OR public.es_coordinacion() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    RAISE EXCEPTION 'Solo coordinación puede crear o borrar personal' USING ERRCODE = '42501';
  END IF;
  IF NEW.rol_principal_id IS DISTINCT FROM OLD.rol_principal_id
     OR NEW.activo        IS DISTINCT FROM OLD.activo
     OR NEW.auth_user_id  IS DISTINCT FROM OLD.auth_user_id
     OR NEW.email         IS DISTINCT FROM OLD.email
     OR NEW.cedula        IS DISTINCT FROM OLD.cedula THEN
    RAISE EXCEPTION 'Solo coordinación puede cambiar rol, estado, cuenta, correo o cédula del personal'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_personal_guardia ON public.personal;
CREATE TRIGGER trg_personal_guardia
  BEFORE INSERT OR UPDATE OR DELETE ON public.personal
  FOR EACH ROW EXECUTE FUNCTION public.fn_personal_guardia();

-- Catálogo de roles y roles secundarios: lectura para todos, escritura solo coordinación.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles_personal', 'personal_roles'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_full ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS leer_todos ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS escribe_coordinacion ON public.%I', t);
    EXECUTE format('CREATE POLICY leer_todos ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY escribe_coordinacion ON public.%I FOR ALL TO authenticated '
                   'USING (public.es_coordinacion()) WITH CHECK (public.es_coordinacion())', t);
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- Verificación: con sesión de TÉCNICO,
--   PATCH /rest/v1/personal?id=eq.<su id>  {"rol_principal_id":6}  → error 42501
--   PATCH /rest/v1/roles_personal?id=eq.2  {"nombre":"ADMIN"}      → 0 filas
-- Con sesión de COORDINADOR: editar personal en Gestión sigue funcionando.
-- ROLLBACK: DROP TRIGGER trg_personal_guardia ON public.personal;
--   y en roles_personal/personal_roles: DROP POLICY leer_todos/escribe_coordinacion,
--   CREATE POLICY auth_full … FOR ALL TO authenticated USING (true) WITH CHECK (true).
-- ============================================================================
