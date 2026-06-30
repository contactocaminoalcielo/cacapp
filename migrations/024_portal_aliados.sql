-- 024 — Portal de aliados (pre-registro de servicios por veterinaria)
-- =====================================================================
-- Fase 1 del portal de aliados. Agrega, sobre tablas EXISTENTES:
--
--   aliados.token_acceso   → token del enlace personal del aliado (Flujo A).
--                            NUNCA se expone a anon (no se agrega al GRANT
--                            por columnas del hardening 04). Se valida y se
--                            genera SOLO desde orbit-backend.
--   aliados.estado         → 'activo' | 'pendiente_validacion' | 'inactivo'.
--                            Una veterinaria nueva que se registra sola desde
--                            el portal entra como 'pendiente_validacion'
--                            (sin token) hasta que Coordinador/Admin la aprueba.
--   aliados.validado_por   → personal.id que la aprobó (trazabilidad).
--   aliados.validado_at    → cuándo se aprobó.
--
--   solicitudes_servicio.origen → 'CLIENTE' | 'ALIADO'. Distingue una solicitud
--                            originada por el cliente final (/solicitud) de una
--                            originada por un aliado validado (/aliado). aliado_id
--                            por sí solo no basta: un cliente puede elegir una vet
--                            como punto de recogida sin que la haya enviado la vet.
--
-- El valor de estado 'INCOMPLETA' para solicitudes_servicio se maneja en el
-- bloque OPCIONAL del final (depende de si estado es text o enum).
--
-- Aplicar en producción (VPS Contabo, NUNCA por MCP/Cloud):
--   cd /opt/supabase/docker
--   docker compose exec -T db psql -U postgres -d postgres -f - < 024_portal_aliados.sql
--
-- Nota: son ALTER sobre tablas existentes → heredan GRANTs/RLS de aliados y
-- solicitudes_servicio. No se otorgan columnas nuevas a anon (token_acceso y
-- estado quedan invisibles para anon por defecto, que es lo que queremos).
-- =====================================================================

BEGIN;

-- ── aliados ──────────────────────────────────────────────────────────
ALTER TABLE public.aliados
  ADD COLUMN IF NOT EXISTS token_acceso text,
  ADD COLUMN IF NOT EXISTS estado       text NOT NULL DEFAULT 'activo',
  ADD COLUMN IF NOT EXISTS validado_por uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS validado_at  timestamptz;

-- Unicidad del token (permite múltiples NULL: solo los aliados aprobados lo tienen)
CREATE UNIQUE INDEX IF NOT EXISTS aliados_token_acceso_key
  ON public.aliados (token_acceso) WHERE token_acceso IS NOT NULL;

-- Estado válido. NOT VALID: no revalida filas históricas (que el UPDATE de abajo
-- ya deja en 'activo'), no bloquea el deploy.
ALTER TABLE public.aliados
  DROP CONSTRAINT IF EXISTS aliados_estado_check;
ALTER TABLE public.aliados
  ADD CONSTRAINT aliados_estado_check
  CHECK (estado IN ('activo','pendiente_validacion','inactivo')) NOT VALID;

-- Aliados existentes: todos quedan activos (la columna nace con default 'activo',
-- este UPDATE es por si alguna fila quedara con NULL en una corrida parcial previa).
UPDATE public.aliados SET estado = 'activo' WHERE estado IS NULL;

-- Índice para la cola de aprobación (Configuración filtra pendiente_validacion)
CREATE INDEX IF NOT EXISTS aliados_estado_idx
  ON public.aliados (estado) WHERE estado = 'pendiente_validacion';

COMMENT ON COLUMN public.aliados.token_acceso IS
  'Token del enlace personal del aliado (/#/aliado?c=token). Solo aliados aprobados. NUNCA se expone a anon; se valida/genera en orbit-backend.';
COMMENT ON COLUMN public.aliados.estado IS
  'activo | pendiente_validacion (vet auto-registrada, sin token, espera aprobación) | inactivo.';
COMMENT ON COLUMN public.aliados.validado_por IS
  'personal.id que aprobó la veterinaria pendiente. NULL en aliados de alta manual.';

-- ── solicitudes_servicio ─────────────────────────────────────────────
ALTER TABLE public.solicitudes_servicio
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'CLIENTE';

ALTER TABLE public.solicitudes_servicio
  DROP CONSTRAINT IF EXISTS solicitudes_servicio_origen_check;
ALTER TABLE public.solicitudes_servicio
  ADD CONSTRAINT solicitudes_servicio_origen_check
  CHECK (origen IN ('CLIENTE','ALIADO')) NOT VALID;

COMMENT ON COLUMN public.solicitudes_servicio.origen IS
  'CLIENTE (formulario /solicitud) | ALIADO (portal /aliado, enviada por una veterinaria validada).';

COMMIT;

-- PostgREST: recargar el schema cache para que tome las columnas nuevas
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- BLOQUE OPCIONAL — valor de estado 'INCOMPLETA' en solicitudes_servicio
-- =====================================================================
-- Solo se necesita si solicitudes_servicio.estado es un ENUM. Si es text
-- (lo más probable: el cliente setea 'PENDIENTE'/'CONVERTIDO'/'DESCARTADO'
-- libremente y SolicitudCliente ni envía estado), NO hace falta DDL alguno.
--
-- Este bloque detecta el tipo y, solo si es enum, agrega el valor. NO va dentro
-- de la transacción de arriba a propósito (ALTER TYPE ... ADD VALUE no admite
-- estar en un bloque que ya use el tipo). Correr por separado si aplica.
--
-- DO $$
-- DECLARE v_typtype char; v_typname text;
-- BEGIN
--   SELECT t.typtype, t.typname INTO v_typtype, v_typname
--   FROM pg_attribute a
--   JOIN pg_class c     ON c.oid = a.attrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   JOIN pg_type t      ON t.oid = a.atttypid
--   WHERE n.nspname = 'public'
--     AND c.relname = 'solicitudes_servicio'
--     AND a.attname = 'estado';
--
--   IF v_typtype = 'e' THEN
--     IF NOT EXISTS (
--       SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--       WHERE t.typname = v_typname AND e.enumlabel = 'INCOMPLETA'
--     ) THEN
--       EXECUTE format('ALTER TYPE public.%I ADD VALUE %L', v_typname, 'INCOMPLETA');
--       RAISE NOTICE 'estado es enum %, valor INCOMPLETA agregado', v_typname;
--     END IF;
--   ELSE
--     RAISE NOTICE 'estado es text (typtype=%): no requiere DDL para INCOMPLETA', v_typtype;
--   END IF;
-- END $$;

-- =====================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- =====================================================================
-- \d public.aliados                  -- token_acceso, estado, validado_por, validado_at
-- \d public.solicitudes_servicio     -- origen
-- SELECT estado, count(*) FROM public.aliados GROUP BY estado;   -- todos 'activo'
-- -- Tipo real de solicitudes_servicio.estado (para decidir el bloque opcional):
-- SELECT atttypid::regtype FROM pg_attribute
--   WHERE attrelid = 'public.solicitudes_servicio'::regclass AND attname = 'estado';
-- -- anon NO debe ver el token (debe fallar 42501 o devolver vacío):
-- --   curl 'https://db.orbitacac.com/rest/v1/aliados?select=token_acceso' -H "apikey: $ANON"

-- =====================================================================
-- ROLLBACK (solo si algo se rompe)
-- =====================================================================
-- BEGIN;
-- ALTER TABLE public.solicitudes_servicio
--   DROP CONSTRAINT IF EXISTS solicitudes_servicio_origen_check,
--   DROP COLUMN IF EXISTS origen;
-- DROP INDEX IF EXISTS public.aliados_estado_idx;
-- DROP INDEX IF EXISTS public.aliados_token_acceso_key;
-- ALTER TABLE public.aliados
--   DROP CONSTRAINT IF EXISTS aliados_estado_check,
--   DROP COLUMN IF EXISTS validado_at,
--   DROP COLUMN IF EXISTS validado_por,
--   DROP COLUMN IF EXISTS estado,
--   DROP COLUMN IF EXISTS token_acceso;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
