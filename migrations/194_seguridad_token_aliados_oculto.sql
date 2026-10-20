-- ============================================================================
-- 194 — Seguridad: la llave del portal de cada veterinaria (aliados.token_acceso)
--       deja de ser legible desde el navegador
-- ----------------------------------------------------------------------------
-- ⚠️ APLICAR DESPUÉS del push del frontend que usa ALIADOS_COLUMNAS
--    (src/lib/aliados.js): con esta migración, `select('*')` sobre aliados falla.
-- Requiere la 193 (columna tiene_acceso).
--
-- Con token_acceso cualquier sesión (y el realtime del Kanban, también para el
-- productor) podía entrar al portal de cualquier veterinaria y pedir servicios
-- a su nombre. Solo el backend la usa (orbit-backend/src/aliados.js y crm.js),
-- y el backend no pasa por estos permisos.
--
-- Permiso por COLUMNAS: todas menos token_acceso.
-- 🪤 Una columna NUEVA en aliados no será legible por `authenticated` hasta
--    agregarla a este GRANT (y a ALIADOS_COLUMNAS): la consulta da 42501.
-- anon conserva lo de la 189 (id_aliado, nombre, ciudad, activo).
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE SELECT ON public.aliados FROM authenticated;
GRANT SELECT (
  id_aliado, nombre, identificacion_nit, email, telefono, whatsapp, contacto_nombre,
  tipo_establecimiento_id, ciudad, localidad, barrio, direccion, vip, numero_sedes,
  rut_url, logo_url, modalidad_comision, saldo_comision, facturacion_mensual, notas,
  activo, created_at, updated_at, horario, estado, validado_por, validado_at,
  telefono_2, contacto_cargo, contacto_email, contacto_2_nombre, contacto_2_telefono,
  instagram, sitio_web, atiende_24h, num_veterinarios, servicios_clinica,
  referencia_ubicacion, lat, lng, comercial_id, notas_comerciales, ficha_actualizada_en,
  ficha_actualizada_por, no_contactar, no_contactar_motivo, no_contactar_desde,
  no_contactar_por, tiene_acceso
) ON public.aliados TO authenticated;

COMMIT;

-- ROLLBACK: GRANT SELECT ON public.aliados TO authenticated;
