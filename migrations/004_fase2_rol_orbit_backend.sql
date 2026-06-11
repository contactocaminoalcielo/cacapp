-- ============================================================================
-- 004 — Fase 2: rol dedicado para orbit-backend
-- Fecha: 2026-06-11 — YA EJECUTADO en producción (documentación/re-ejecución)
--
-- Contexto: POSTGRES_PASSWORD del .env de Supabase NO coincide con el password
-- real del rol postgres (el stack interno usa trust en localhost). En lugar de
-- tocar roles existentes, orbit-backend usa su propio rol:
--   - LOGIN con password aleatorio (vive solo en /opt/orbit-backend/.env)
--   - BYPASSRLS: el backend es la capa de confianza; sus permisos se controlan
--     en código (src/auth.js), no via RLS (arquitectura objetivo)
--   - DML sobre public (sin DDL: las migraciones siguen siendo manuales por SSH)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbit_backend') THEN
    CREATE ROLE orbit_backend;
  END IF;
END $$;

-- El password real se setea por SSH y NUNCA se versiona:
--   ALTER ROLE orbit_backend LOGIN PASSWORD '<openssl rand -hex 24>' BYPASSRLS;

GRANT USAGE ON SCHEMA public TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orbit_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orbit_backend;
-- Tablas futuras creadas por postgres también quedan accesibles:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orbit_backend;

-- ROLLBACK:
--   REASSIGN OWNED BY orbit_backend TO postgres;
--   DROP OWNED BY orbit_backend;
--   DROP ROLE IF EXISTS orbit_backend;
