-- ============================================================================
-- 187 — Seguridad: cerrar lo que el rol `anon` (público) podía ver y ejecutar
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10-19 · SEC-001, SEC-002, SEC-003
-- (docs/auditoria/02-hallazgos-urgentes.md). ⚠️ Si al aplicar ya existe otra
-- 187 (hay sesiones en paralelo), renumerar.
--
-- SEC-001 (CRÍTICA): con la clave `anon` del bundle se listaban los 1.477
--   servicios con codigo_fotos, dirección y datos de entrega. La política
--   `codigo_fotos IS NOT NULL` era cierta para TODOS. Ninguna página pública
--   lee servicios/mascotas/servicio_recordatorios directo (los portales van por
--   /api/portal/*), así que se retira el acceso de anon a las tres.
-- SEC-002 (CRÍTICA): 22 funciones SECURITY DEFINER (recibos, cuadres,
--   bitácoras) ejecutables por anon vía /rest/v1/rpc. Postgres da EXECUTE a
--   PUBLIC al crearlas. El frontend las llama siempre con sesión, así que se
--   quitan a PUBLIC/anon y se dejan a authenticated (sin cambio para usuarios).
-- SEC-003 (MEDIA): tabla de respaldo de la fase 0 sin RLS y con permisos
--   totales para anon. Se le activa RLS (sin políticas = nadie del navegador).
--
-- No cambia datos. Reversible (ver ROLLBACK al final).
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── SEC-001 ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS anon_select_con_codigo  ON public.servicios;
DROP POLICY IF EXISTS anon_select_via_codigo  ON public.mascotas;
DROP POLICY IF EXISTS anon_select_via_codigo  ON public.servicio_recordatorios;
REVOKE ALL ON TABLE public.servicios, public.mascotas, public.servicio_recordatorios FROM anon;

-- ─── SEC-002 ────────────────────────────────────────────────────────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role, orbit_backend', f.firma);
  END LOOP;
END $$;
-- Que no vuelva a pasar con las funciones nuevas.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role, orbit_backend;

-- ─── SEC-001b: la subida de fotos del portal NO puede depender de leer servicios ──
-- 🩸 Detectado por el perito de datos antes de aplicar: la política de Storage
-- `anon_insert_fotos_clientes` validaba con una subconsulta a `servicios`
-- COMO anon. Con el REVOKE de arriba, esa subconsulta daría "permiso denegado"
-- y las familias dejarían de poder subir fotos (2.231 de 2.340 subidas de los
-- últimos 30 días son del portal, sin sesión). Se valida con una función que
-- corre con permisos de su dueño y SOLO responde sí/no para un id concreto
-- (los ids son UUID aleatorios: no sirve para listar nada).
-- Va DESPUÉS del bucle de SEC-002, que le quita EXECUTE a anon a todo SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.portal_puede_subir_foto(p_servicio text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.servicios s
     WHERE s.id::text = p_servicio
       AND s.estado::text IN ('EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION'))
$$;
REVOKE ALL ON FUNCTION public.portal_puede_subir_foto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_puede_subir_foto(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "anon_insert_fotos_clientes" ON storage.objects;
CREATE POLICY "anon_insert_fotos_clientes" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'fotos-clientes'
    AND public.portal_puede_subir_foto((string_to_array(name, '/'))[1])
  );

-- ─── SEC-003 ────────────────────────────────────────────────────────────────
ALTER TABLE public._backup_fase0_cuarto_frio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._backup_fase0_cuarto_frio FROM anon, authenticated;

COMMIT;

-- ============================================================================
-- Verificación (debe dar: 401/permiso denegado o 0 filas):
--   GET  https://db.orbitacac.com/rest/v1/servicios?select=id&limit=1        (clave anon)
--   POST https://db.orbitacac.com/rest/v1/rpc/servicios_sin_cuadrar_tecnico  (clave anon)
--   GET  https://db.orbitacac.com/rest/v1/_backup_fase0_cuarto_frio           (clave anon)
-- Y que siga funcionando: portal /#/fotos/CODIGO, /#/solicitud, recibo del
-- técnico y cuadre en Finanzas (con sesión).
--
-- ROLLBACK (solo si algo legítimo dependía de esto):
--   CREATE POLICY anon_select_con_codigo ON public.servicios FOR SELECT TO anon USING (codigo_fotos IS NOT NULL);
--   GRANT EXECUTE ON FUNCTION <firma> TO PUBLIC;   -- por función
-- ============================================================================
