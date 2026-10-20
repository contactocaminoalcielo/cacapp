-- ============================================================================
-- 189 — Seguridad: etapa 1 de permisos, lo mínimo para `anon`, y desactivar
--       a alguien le cierra también la sesión
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10 · docs/auditoria/11-matriz-rbac.md (§5, etapa 1),
-- RBAC-005, RBAC-012, DATA-010, SEC-102. Requiere la 188 (es_coordinacion()).
--
-- A. ETAPA 1 (RBAC-005). Configuración, tarifas, precios y catálogos tenían
--    auth_full: cualquier sesión —el operario, el comercial— cambiaba la tarifa
--    que se le paga al técnico o el precio de un plan. Ahora: todos LEEN (las
--    pantallas los necesitan para calcular), solo coordinación ESCRIBE.
--    Verificado en el código: todas las escrituras del navegador a estas tablas
--    salen de Configuración, Gestión (canEdit = coordinación), Eutanasias y la
--    pestaña Evidencias de Tenjo, que son de ADMIN/COORDINADOR. El backend
--    (orbit_backend) y los procesos internos (postgres) saltan RLS: no cambian.
--    Fuera a propósito: `cubiculos` y `neveras` (los mueve la operación).
--
-- B. ANON (DATA-010, RBAC-012). `anon` conservaba GRANT total sobre casi todas
--    las tablas; solo RLS lo frenaba. Se le deja exactamente lo que usan las
--    páginas públicas (/solicitud, /aliado, /fotos):
--      · leer catálogos: especies, planes, planes_precios, plan_recordatorios,
--        recordatorios, tarifas_transporte, tipo_establecimiento;
--      · leer de aliados SOLO id, nombre, ciudad y activo (antes: todas las
--        columnas de las clínicas activas, teléfonos incluidos);
--      · insertar solicitudes_servicio SOLO con las columnas del formulario
--        (antes podía fijar estado, servicio_id, agente_id…);
--      · insertar autorizaciones_datos (ya acotada por su WITH CHECK).
--
-- C. SEC-102. Desactivar a alguien en `personal` no tocaba su cuenta de acceso:
--    seguía entrando y con su sesión leía y escribía por la API de la base. Ahora
--    `activo = false` bloquea la cuenta (auth.users.banned_until) y reactivarla
--    la desbloquea. Se aplica también a quien ya está desactivado hoy.
--
-- Reversible (ver ROLLBACK al final). No cambia datos de negocio.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── A. Etapa 1 ─────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'canal_origen', 'config_comisiones', 'config_operativa', 'config_sistema',
    'especies', 'eutanasia_tarifas', 'festivos', 'flujos_proceso',
    'plan_recordatorios', 'planes', 'planes_precios', 'recordatorios',
    'tarifas_pago_tecnico_servicio', 'tarifas_reconocimiento_tecnico',
    'tarifas_transporte', 'tipo_establecimiento', 'procesos_disposicion',
    'maquinas_produccion'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_full ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS leer_todos ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS escribe_coordinacion ON public.%I', t);
    EXECUTE format('CREATE POLICY leer_todos ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY escribe_coordinacion ON public.%I FOR ALL TO authenticated '
                   'USING (public.es_coordinacion()) WITH CHECK (public.es_coordinacion())', t);
  END LOOP;
END $$;

-- ─── B. anon: solo lo que usan las páginas públicas ─────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.especies, public.planes, public.planes_precios,
                public.plan_recordatorios, public.recordatorios,
                public.tarifas_transporte, public.tipo_establecimiento TO anon;
GRANT SELECT (id_aliado, nombre, ciudad, activo) ON public.aliados TO anon;
GRANT INSERT (cliente_nombre, cliente_apellido, cliente_cedula, cliente_whatsapp,
              cliente_telefono, cliente_telefono2, cliente_email, cliente_ciudad,
              cliente_localidad, cliente_barrio, cliente_direccion,
              mascota_nombre, especie_id, mascota_peso_kg, mascota_sexo, mascota_raza,
              plan_id, tipo_recogida, aliado_id, aliado_nombre_otro,
              ciudad, localidad, barrio, direccion, hora_aproximada, notas_cliente)
  ON public.solicitudes_servicio TO anon;
GRANT INSERT ON public.autorizaciones_datos TO anon;
-- Las tablas nuevas no nacen abiertas para anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ─── C. Desactivar = bloquear la cuenta ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_personal_sincroniza_bloqueo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.activo THEN
    UPDATE auth.users SET banned_until = NULL
     WHERE id = NEW.auth_user_id AND banned_until IS NOT NULL;
  -- Solo si ninguna OTRA fila activa usa esa misma cuenta.
  ELSIF NOT EXISTS (SELECT 1 FROM public.personal p
                     WHERE p.auth_user_id = NEW.auth_user_id AND p.activo AND p.id <> NEW.id) THEN
    UPDATE auth.users SET banned_until = 'infinity'
     WHERE id = NEW.auth_user_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_personal_sincroniza_bloqueo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_personal_sincroniza_bloqueo ON public.personal;
CREATE TRIGGER trg_personal_sincroniza_bloqueo
  AFTER INSERT OR UPDATE OF activo, auth_user_id ON public.personal
  FOR EACH ROW EXECUTE FUNCTION public.fn_personal_sincroniza_bloqueo();

-- Quien ya está desactivado hoy.
UPDATE auth.users u SET banned_until = 'infinity'
 WHERE EXISTS (SELECT 1 FROM public.personal p WHERE p.auth_user_id = u.id AND NOT p.activo)
   AND NOT EXISTS (SELECT 1 FROM public.personal p WHERE p.auth_user_id = u.id AND p.activo)
   AND u.banned_until IS NULL;

COMMIT;

-- ============================================================================
-- Verificación:
--   anon: GET /rest/v1/aliados?select=id_aliado,nombre,ciudad&activo=eq.true → 200
--         GET /rest/v1/aliados?select=whatsapp                               → 401/42501
--         GET /rest/v1/clientes                                              → 401/42501
--         /#/solicitud carga y envía; /#/fotos/CODIGO muestra el catálogo.
--   técnico: PATCH /rest/v1/planes_precios … → 0 filas; leer planes → OK.
--   coordinador: Configuración guarda tarifas, planes y festivos.
-- ROLLBACK:
--   por tabla de A: DROP POLICY leer_todos/escribe_coordinacion;
--     CREATE POLICY auth_full ON <t> FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   B: GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
--   C: DROP TRIGGER trg_personal_sincroniza_bloqueo ON public.personal;
--      UPDATE auth.users SET banned_until = NULL WHERE banned_until = 'infinity';
-- ============================================================================
