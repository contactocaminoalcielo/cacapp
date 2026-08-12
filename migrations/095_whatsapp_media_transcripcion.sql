-- 095 — Transcripción de las notas de voz
--
-- Claude no oye audio (acepta texto, imágenes y PDF, y nada más), así que las
-- notas de voz pasan por Whisper corriendo en el propio VPS — no salen del
-- servidor: son veterinarias y familias hablando de su mascota muerta.
--
-- La transcripción se guarda APARTE del texto del mensaje aunque el mensaje
-- también se actualice con ella. Parece redundante y no lo es: `whatsapp_mensajes.texto`
-- es lo que leen la bandeja y el agente, y puede corregirse a mano; esta columna
-- es lo que dijo la máquina, sin tocar. Cuando alguien discuta lo que entendió
-- el agente, esta es la evidencia.

BEGIN;

ALTER TABLE public.whatsapp_media
  ADD COLUMN IF NOT EXISTS transcripcion text;

COMMENT ON COLUMN public.whatsapp_media.transcripcion IS
  'Lo que Whisper entendió, literal y sin editar. `error` explica por qué está NULL cuando lo está.';

COMMIT;
