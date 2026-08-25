-- 119 — Canal operativo de WhatsApp configurable (GHL → Meta directo)
--
-- El despliegue conserva GHL por defecto. El corte se hace únicamente con
-- WHATSAPP_OPERATIONAL_TRANSPORT=META después de probar webhook y plantillas.

BEGIN;

ALTER TABLE public.digitales_envios
  DROP CONSTRAINT IF EXISTS digitales_envios_canal_check;

ALTER TABLE public.digitales_envios
  ADD CONSTRAINT digitales_envios_canal_check
  CHECK (canal IN ('WHATSAPP_MANUAL', 'ZOLUTIUM', 'WHATSAPP_META'));

COMMENT ON COLUMN public.digitales_envios.canal IS
  'Canal real del envío: WHATSAPP_MANUAL, ZOLUTIUM (GHL histórico/transición) o WHATSAPP_META (Cloud API directo).';

COMMIT;
