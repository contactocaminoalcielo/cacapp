-- ============================================================================
-- 167 — PQR de una mascota, registradas desde su tarjeta
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-09-17): cuando a coordinación le dicen algo sobre una
-- mascota —una queja por la demora, un reclamo por el recordatorio, también un
-- agradecimiento— hoy no hay dónde dejarlo. Termina en la cabeza de quien
-- atendió la llamada, o como mucho en una nota suelta de la bitácora, donde
-- nadie lo puede contar ni volver a leer por tipo.
--
-- Decisión de alcance (David, 2026-09-17): esto REGISTRA, no gestiona. No hay
-- estado, ni responsable, ni cierre: una PQR aquí es constancia de lo que dijo
-- la familia, con su tipo, su canal y quién la recibió. Si algún día hace falta
-- hacerle seguimiento, se añaden las columnas de estado sin tocar lo guardado.
--
-- Por qué tabla propia y no un `tipo_novedad` más en `novedades_servicio`:
-- esa tabla es el rastro interno de lo que Orbit le HACE al servicio (pagos,
-- ajustes de valor, cambios de plan) y su CHECK la limita a NOTA/PAGO_RECIBIDO
-- en varias pantallas. Una PQR es la voz del cliente, se cuenta aparte y se
-- lista aparte; mezclarlas obligaría a filtrar la bitácora en todas partes para
-- que una queja no pareciera un movimiento de plata.
--
-- Aditiva, idempotente, reversible. No pisa datos ni toca ninguna tabla viva.
-- Aplicar en VPS (Contabo) — el archivo se PIPEA desde local; no vive en el VPS:
--   cat migrations/167_pqrs_servicio.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
-- `tipo` es el PQRSF colombiano completo: las felicitaciones también se
-- registran, y son las que nadie apunta cuando solo se guardan quejas.
-- `canal` dice por dónde llegó; nulo cuando quien registra no lo sabe.
-- `descripcion` es obligatoria: una PQR sin el relato no sirve de nada.
-- `registrado_por` es quien la RECIBIÓ, no el técnico del servicio.
CREATE TABLE IF NOT EXISTS public.pqrs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id    uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  tipo           text NOT NULL
                 CHECK (tipo IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  canal          text
                 CHECK (canal IS NULL OR canal IN ('WHATSAPP','LLAMADA','PRESENCIAL','CORREO','REDES','OTRO')),
  descripcion    text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  registrado_por uuid REFERENCES public.personal(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.pqrs IS
  'Peticiones, quejas, reclamos, sugerencias y felicitaciones que la familia deja sobre un servicio. Solo registro: no tiene estado ni cierre (migr. 167).';
COMMENT ON COLUMN public.pqrs.registrado_por IS
  'Quién la RECIBIÓ y la anotó (coordinación), no el técnico del servicio.';

-- La bandeja lista por fecha descendente y la tarjeta pregunta por servicio.
CREATE INDEX IF NOT EXISTS idx_pqrs_servicio ON public.pqrs (servicio_id);
CREATE INDEX IF NOT EXISTS idx_pqrs_fecha    ON public.pqrs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_tipo     ON public.pqrs (tipo);

-- ─── 2. GRANTs + RLS (patrón del proyecto) ──────────────────────────────────
-- Creada con SQL raw ⇒ los GRANT van a mano (Supabase no los pone solo).
-- Sin DELETE a propósito: una PQR registrada no se borra desde la app.
GRANT SELECT, INSERT, UPDATE ON TABLE public.pqrs TO authenticated;
GRANT SELECT                 ON TABLE public.pqrs TO orbit_backend;
GRANT ALL                    ON TABLE public.pqrs TO postgres, service_role;

ALTER TABLE public.pqrs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.pqrs;
CREATE POLICY "auth_full" ON public.pqrs FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Verificación (no destructiva):
--   select to_regclass('public.pqrs');
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'pqrs' order by grantee;
--   select relrowsecurity from pg_class where relname = 'pqrs';
-- Revertir:
--   DROP TABLE public.pqrs;
-- ============================================================================
