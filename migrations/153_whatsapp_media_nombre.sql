-- 153 — El nombre con el que salió un adjunto de WhatsApp.
-- Fecha: 2026-09-10
--
-- Contexto: al bajar un adjunto del hilo, el nombre se adivinaba del texto del
-- mensaje (`[documento] NOMBRE.pdf`). Un CERTIFICADO sale como plantilla, y su
-- texto es `[plantilla certificado_proceso] …`, así que caía al respaldo
-- `whatsapp-<id>.pdf`: abre bien, pero nadie sabe de quién es el certificado que
-- acaba de guardar. Ya pasó una vez que el nombre del archivo hiciera parecer
-- que la descarga estaba rota (por eso existe EXT_POR_MIME en el front).
--
-- Nullable a propósito: las 12.700 filas que ya existen se quedan en NULL y
-- siguen resolviendo el nombre como hoy. No hay backfill posible ni necesario.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.whatsapp_media
  ADD COLUMN IF NOT EXISTS nombre text;

COMMENT ON COLUMN public.whatsapp_media.nombre
  IS 'Nombre del archivo tal como salió o llegó (p. ej. "Certificado NN.pdf"). Es el que usa la bandeja al descargarlo; NULL en las filas anteriores a la migración 153, que lo deducen del texto del mensaje.';

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name='whatsapp_media' AND column_name='nombre';
