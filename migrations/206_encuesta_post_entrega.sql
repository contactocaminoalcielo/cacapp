-- ============================================================================
-- 206 — Encuesta de satisfacción post-entrega (automática, por WhatsApp)
-- Fecha: 2026-11-09 · Reporte Orbit (nueva funcionalidad, media-alta)
--
-- Coordinación pidió: cuando el servicio queda ENTREGADO, Orbit le pregunta a
-- la familia cómo fue su experiencia con tres botones (😊 Bueno · 😐 Regular ·
-- ☹️ Malo) y registra la respuesta. Bueno → se le ofrece dejar reseña en Google.
-- Regular / Malo → un formulario corto para contar qué pasó, alerta interna y
-- caso pendiente de seguimiento; Malo además abre una PQR tipo QUEJA.
--
-- Decisiones de David (2026-11-09):
--   · La reseña de Google SOLO se ofrece a quien responde Bueno (se le advirtió
--     que la política de reseñas de Google prohíbe pedirlas selectivamente).
--   · Sale al día siguiente de la entrega a las 10 a. m.; domingo y festivo
--     pasan al siguiente día hábil.
--   · La dispara CUALQUIER servicio que pase a ENTREGADO (no solo el mensajero).
--   · El comentario de Regular/Malo se deja en una página web corta.
--
-- 🔑 NO se crea una tabla nueva: se llena la fila POST_ENTREGA que el trigger
-- `crear_nps_al_entregado` (migr. 037) ya crea al pasar a ENTREGADO. Así /nps,
-- su contador de pendientes y el Dashboard siguen leyendo lo mismo.
--
-- 🪤 Al escribir esto había 1384 POST_ENTREGA en PENDIENTE (desde el 22-jun) y
-- NINGUNO realizado: el seguimiento manual nunca se usó. Por eso el job exige
-- `arranque_desde` (sin él no envía) y solo mira entregas de los últimos días.
-- Sin ese candado la primera corrida le escribiría a 1384 familias.
--
-- ⚠️ ORDEN: esta migración → backend → frontend (git push).
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de REVERSA al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. La respuesta, el envío y el seguimiento, en la fila POST_ENTREGA ─────
ALTER TABLE public.nps_seguimiento
  ADD COLUMN IF NOT EXISTS satisfaccion     varchar(10)
        CHECK (satisfaccion IN ('BUENA', 'REGULAR', 'MALA')),
  ADD COLUMN IF NOT EXISTS respondido_en    timestamptz,
  -- NULL = esta fila no la tocó la automatización (las 1384 viejas, 3M y 6M).
  ADD COLUMN IF NOT EXISTS envio_estado     varchar(12)
        CHECK (envio_estado IN ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'ERROR')),
  ADD COLUMN IF NOT EXISTS envio_en         timestamptz,
  ADD COLUMN IF NOT EXISTS envio_intentos   smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS envio_error      text,
  ADD COLUMN IF NOT EXISTS mensaje_id       text,
  ADD COLUMN IF NOT EXISTS whatsapp_destino text,
  -- Secreto del formulario /#/opinion/CODIGO. Propio de la encuesta: NO se
  -- reusa `codigo_fotos`, que abre el portal de fotos de esa familia.
  ADD COLUMN IF NOT EXISTS codigo           text,
  ADD COLUMN IF NOT EXISTS comentario_en    timestamptz,
  ADD COLUMN IF NOT EXISTS seguimiento      varchar(10)
        CHECK (seguimiento IN ('PENDIENTE', 'ATENDIDO')),
  ADD COLUMN IF NOT EXISTS seguimiento_nota text,
  ADD COLUMN IF NOT EXISTS atendido_por     uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS atendido_en      timestamptz,
  ADD COLUMN IF NOT EXISTS pqr_id           uuid REFERENCES public.pqrs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.nps_seguimiento.satisfaccion IS
  'Respuesta a la encuesta post-entrega (migr. 206). nps se llena en espejo: BUENA=5, REGULAR=3, MALA=1.';
COMMENT ON COLUMN public.nps_seguimiento.envio_estado IS
  'Envío automático de la encuesta (migr. 206). NULL = la fila no la tocó la automatización.';
COMMENT ON COLUMN public.nps_seguimiento.seguimiento IS
  'REGULAR/MALA quedan PENDIENTE hasta que coordinación los marque ATENDIDO en /nps.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_nps_codigo
  ON public.nps_seguimiento (codigo) WHERE codigo IS NOT NULL;
-- El webhook busca "la última encuesta enviada a este número sin respuesta".
CREATE INDEX IF NOT EXISTS idx_nps_encuesta_enviada
  ON public.nps_seguimiento (envio_en DESC) WHERE envio_estado = 'ENVIADO';
CREATE INDEX IF NOT EXISTS idx_nps_seguimiento_pendiente
  ON public.nps_seguimiento (seguimiento) WHERE seguimiento = 'PENDIENTE';

-- ─── 2. Configuración (arranca APAGADA) ─────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('ENCUESTA_ENTREGA', 'activo', 'false'::jsonb,
   'Interruptor de la encuesta post-entrega. Arranca APAGADO: encender cuando Meta apruebe la plantilla.'),
  ('ENCUESTA_ENTREGA', 'plantilla', 'null'::jsonb,
   'Plantilla HSM aprobada con 3 botones de respuesta rápida: {"nombre","idioma","categoria"}. NULL → no envía.'),
  ('ENCUESTA_ENTREGA', 'arranque_desde', 'null'::jsonb,
   'Solo se encuestan entregas desde esta fecha (anti-blast de las 1384 viejas). NULL → el job NO envía. La fija el script de la plantilla al sembrarla.'),
  ('ENCUESTA_ENTREGA', 'google_resena_url', 'null'::jsonb,
   'Enlace de reseñas de Google (g.page/r/…/review). NULL → a quien responde Bueno solo se le agradece.'),
  ('ENCUESTA_ENTREGA', 'max_envios_por_corrida', '40'::jsonb,
   'Tope de encuestas por ejecución del job.'),
  ('ENCUESTA_ENTREGA', 'dias_max_atraso', '7'::jsonb,
   'Una entrega de hace más de estos días ya no se encuesta (el job estuvo apagado o caído).')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── 3. GRANTs para el backend (rol orbit_backend; sin GRANT falla mudo) ────
GRANT SELECT, UPDATE ON TABLE public.nps_seguimiento TO orbit_backend;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pqrs     TO orbit_backend;

COMMIT;

-- ============================================================================
-- Verificación (no destructiva):
--   \d public.nps_seguimiento
--   SELECT clave, valor FROM config_operativa WHERE modulo = 'ENCUESTA_ENTREGA';
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'orbit_backend' AND table_name IN ('nps_seguimiento','pqrs');
--   -- Nada debe haber cambiado en las filas viejas:
--   SELECT count(*) FROM nps_seguimiento WHERE envio_estado IS NOT NULL;   -- 0
--
-- REVERSA:
--   BEGIN;
--     DELETE FROM public.config_operativa WHERE modulo = 'ENCUESTA_ENTREGA';
--     DROP INDEX IF EXISTS public.ux_nps_codigo;
--     DROP INDEX IF EXISTS public.idx_nps_encuesta_enviada;
--     DROP INDEX IF EXISTS public.idx_nps_seguimiento_pendiente;
--     ALTER TABLE public.nps_seguimiento
--       DROP COLUMN IF EXISTS satisfaccion, DROP COLUMN IF EXISTS respondido_en,
--       DROP COLUMN IF EXISTS envio_estado, DROP COLUMN IF EXISTS envio_en,
--       DROP COLUMN IF EXISTS envio_intentos, DROP COLUMN IF EXISTS envio_error,
--       DROP COLUMN IF EXISTS mensaje_id, DROP COLUMN IF EXISTS whatsapp_destino,
--       DROP COLUMN IF EXISTS codigo, DROP COLUMN IF EXISTS comentario_en,
--       DROP COLUMN IF EXISTS seguimiento, DROP COLUMN IF EXISTS seguimiento_nota,
--       DROP COLUMN IF EXISTS atendido_por, DROP COLUMN IF EXISTS atendido_en,
--       DROP COLUMN IF EXISTS pqr_id;
--   COMMIT;
-- ============================================================================
