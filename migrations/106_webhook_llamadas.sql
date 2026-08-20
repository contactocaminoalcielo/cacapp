-- 106 — Dejar entrar los eventos de LLAMADA al log crudo
--
-- La app ya está suscrita al campo `calls` del webhook (2026-08-20). Sin esto,
-- un evento de llamada llega y se descarta: el CHECK de `event_type` solo
-- admitía 'message' y 'status', así que el INSERT reventaría y el evento se
-- perdería con él.
--
-- ⚠️ Esto NO enciende las llamadas. El botón de llamar sigue apagado en el
-- número (`calling.status = NOT_SET`) y nadie puede llamar todavía. Esto es
-- solo la parte que ESCUCHA, para poder estudiar qué manda Meta de verdad —
-- oferta SDP, quién llama, cuándo cuelga— antes de diseñar quién contesta.
-- Encender el botón sin nada al otro lado es peor que no tenerlo: la clínica
-- llama y suena en el vacío.

BEGIN;

ALTER TABLE public.whatsapp_webhook_events
  DROP CONSTRAINT IF EXISTS whatsapp_webhook_events_tipo_check;

ALTER TABLE public.whatsapp_webhook_events
  ADD CONSTRAINT whatsapp_webhook_events_tipo_check
  CHECK (event_type IN ('message', 'status', 'call'));

COMMIT;
