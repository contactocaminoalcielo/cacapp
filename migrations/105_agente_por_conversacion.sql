-- 105 — Un interruptor del agente por conversación
--
-- Hasta ahora el agente se apartaba solo por reglas automáticas: 12 horas si
-- una persona escribía, 10 minutos tras una plantilla, nunca en un envío
-- masivo. Todas son buenas por defecto, pero ninguna cubre "de ESTA clínica me
-- encargo yo, y punto": un reclamo delicado, una negociación de convenio, un
-- caso en el que el agente ya se equivocó.
--
-- Sin esto la única salida era escribirle cada 12 horas para renovar la pausa,
-- que es exactamente el tipo de truco que la gente acaba usando y nadie
-- documenta.
--
-- ⚠️ Es un interruptor MANUAL y no caduca: si alguien lo apaga y se olvida, esa
-- clínica se queda sin agente para siempre. Por eso la bandeja lo pinta en la
-- lista y no solo dentro de la conversación — un apagado invisible es una
-- conversación desatendida que nadie ve.

BEGIN;

ALTER TABLE public.whatsapp_contactos
  ADD COLUMN IF NOT EXISTS agente_activo boolean NOT NULL DEFAULT true,
  -- Quién y cuándo: al encontrar una conversación muda, lo primero que se
  -- pregunta es quién la apagó.
  ADD COLUMN IF NOT EXISTS agente_cambiado_por uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agente_cambiado_en timestamptz;

COMMENT ON COLUMN public.whatsapp_contactos.agente_activo IS
  'Interruptor MANUAL del agente para esta conversación. No caduca: si se apaga, se queda apagado hasta que alguien lo encienda.';

COMMIT;
