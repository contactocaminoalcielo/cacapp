-- ============================================================================
-- Recibos del Técnico — robustez del flujo recibo → medio de pago → comprobante
-- Fecha: 2026-06-16
--
-- Objetivo: formalizar medios de pago y comprobantes en tablas propias
-- (fuente de verdad nueva), conservando `recibos_tecnico.medios_pago` (jsonb)
-- SOLO como compatibilidad. NO destruye datos existentes.
--
-- Aplicar por SSH en Contabo (producción):
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < este_archivo
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS.
-- Se puede correr más de una vez sin error.
-- ============================================================================

BEGIN;

-- ─── 1. recibos_tecnico: clave de idempotencia + estado (si falta) ──────────
-- idempotency_key evita duplicados por doble-click / reintento / reinicio:
-- el cliente genera un UUID estable por borrador y lo reenvía en cada intento.
-- DEFAULT gen_random_uuid() garantiza unicidad si alguien inserta sin pasarla
-- (camino de respaldo del front cuando la RPC aún no está desplegada).
ALTER TABLE public.recibos_tecnico
  ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();

-- `estado` ya se usa en el código ('GUARDADO'); lo aseguramos por si la tabla
-- de algún entorno no lo tuviera.
ALTER TABLE public.recibos_tecnico
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'GUARDADO';

-- Unicidad de la clave de idempotencia (permite ON CONFLICT en la RPC).
CREATE UNIQUE INDEX IF NOT EXISTS recibos_tecnico_idempotency_key_uidx
  ON public.recibos_tecnico (idempotency_key);

CREATE INDEX IF NOT EXISTS recibos_tecnico_servicio_id_idx
  ON public.recibos_tecnico (servicio_id);

-- ─── 2. recibo_medios_pago (fuente formal de los medios) ────────────────────
CREATE TABLE IF NOT EXISTS public.recibo_medios_pago (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recibo_id   uuid NOT NULL REFERENCES public.recibos_tecnico(id) ON DELETE CASCADE,
  servicio_id uuid NOT NULL REFERENCES public.servicios(id),
  metodo      text NOT NULL,
  monto       numeric NOT NULL DEFAULT 0 CHECK (monto >= 0),
  referencia  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recibo_medios_pago_recibo_id_idx   ON public.recibo_medios_pago (recibo_id);
CREATE INDEX IF NOT EXISTS recibo_medios_pago_servicio_id_idx ON public.recibo_medios_pago (servicio_id);

-- ─── 3. recibo_comprobantes (fuente formal de los comprobantes) ─────────────
-- Asociación por medio_pago_id (NO por índice visual). Estado formal del
-- comprobante (pendiente / subido / en revisión / aprobado / rechazado / error).
CREATE TABLE IF NOT EXISTS public.recibo_comprobantes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recibo_id     uuid NOT NULL REFERENCES public.recibos_tecnico(id) ON DELETE CASCADE,
  medio_pago_id uuid REFERENCES public.recibo_medios_pago(id) ON DELETE SET NULL,
  servicio_id   uuid NOT NULL REFERENCES public.servicios(id),
  bucket        text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  estado        text NOT NULL DEFAULT 'PENDIENTE_REVISION'
                CHECK (estado IN ('PENDIENTE','SUBIDO','PENDIENTE_REVISION','APROBADO','RECHAZADO','ERROR')),
  error         text,
  uploaded_by   uuid REFERENCES public.personal(id),
  reviewed_by   uuid REFERENCES public.personal(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recibo_comprobantes_recibo_id_idx     ON public.recibo_comprobantes (recibo_id);
CREATE INDEX IF NOT EXISTS recibo_comprobantes_servicio_id_idx   ON public.recibo_comprobantes (servicio_id);
CREATE INDEX IF NOT EXISTS recibo_comprobantes_medio_pago_id_idx ON public.recibo_comprobantes (medio_pago_id);
CREATE INDEX IF NOT EXISTS recibo_comprobantes_estado_idx        ON public.recibo_comprobantes (estado);

-- Un solo comprobante "activo" por medio de pago: si se vuelve a subir, primero
-- se marca el anterior como RECHAZADO/ERROR o se borra (lo maneja la app).
-- Parcial: solo cuenta los estados vivos (no RECHAZADO/ERROR).
CREATE UNIQUE INDEX IF NOT EXISTS recibo_comprobantes_medio_activo_uidx
  ON public.recibo_comprobantes (medio_pago_id)
  WHERE medio_pago_id IS NOT NULL
    AND estado IN ('PENDIENTE','SUBIDO','PENDIENTE_REVISION','APROBADO');

-- ─── 4. GRANTs + RLS (patrón establecido del proyecto) ──────────────────────
-- Regla del proyecto: toda tabla creada con SQL raw necesita GRANT manual y RLS.
-- Por ahora se replica el modelo baseline `auth_full` (igual que las 43 tablas).
-- El endurecimiento por-técnico está preparado, OPCIONAL y COMENTADO, en
-- supabase/security/05_recibos_hardening.sql (requiere backfill de
-- personal.auth_user_id antes de activarlo para no bloquear técnicos).
GRANT ALL ON TABLE public.recibo_medios_pago  TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.recibo_comprobantes TO postgres, anon, authenticated, service_role;

ALTER TABLE public.recibo_medios_pago  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recibo_comprobantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON public.recibo_medios_pago;
DROP POLICY IF EXISTS "auth_full" ON public.recibo_comprobantes;
CREATE POLICY "auth_full" ON public.recibo_medios_pago  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.recibo_comprobantes FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- \d+ public.recibo_medios_pago
-- \d+ public.recibo_comprobantes
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='recibos_tecnico' AND column_name IN ('idempotency_key','estado');
