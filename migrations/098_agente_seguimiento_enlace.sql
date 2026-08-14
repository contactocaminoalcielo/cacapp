-- 098 — El agente vuelve sobre el enlace de registro que nadie contestó
--
-- El agente manda el enlace del portal y ahí se muere el hilo: no sabe si lo
-- llenaron y no vuelve a preguntar. Es justo el punto donde se pierde el
-- registro — y con él la comisión de la veterinaria, que es para lo que existe
-- esta línea.
--
-- Esto NO se puede resolver con un temporizador en memoria como la agrupación
-- de mensajes: aquella dura 12 segundos y aquí se espera un cuarto de hora, así
-- que cualquier despliegue o reinicio se llevaría por delante el seguimiento
-- sin dejar rastro. Va a la base.
--
-- Un seguimiento se CANCELA solo (no se envía) si antes de que venza:
--   · la veterinaria contestó cualquier cosa
--   · entró la solicitud de esa clínica (llenaron el enlace)
--   · la conversación la tomó una persona
--   · el agente se apagó
-- El barrido lo comprueba al vencer, no al programar: en 15 minutos cambia todo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agente_wa_seguimientos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agente_id         integer     NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  contacto          text        NOT NULL,
  motivo            text        NOT NULL DEFAULT 'ENLACE_REGISTRO',
  programado_para   timestamptz NOT NULL,
  estado            text        NOT NULL DEFAULT 'PENDIENTE',
  desenlace         text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  resuelto_en       timestamptz,
  CONSTRAINT agente_wa_seguimientos_estado_chk
    CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'CANCELADO'))
);

-- Un solo seguimiento vivo por conversación y motivo. Sin esto, tres enlaces
-- mandados en la misma charla producirían tres recordatorios encima.
CREATE UNIQUE INDEX IF NOT EXISTS agente_wa_seguimientos_vivo_uq
  ON public.agente_wa_seguimientos (contacto, motivo)
  WHERE estado = 'PENDIENTE';

-- El barrido pregunta por lo vencido cada minuto: que no recorra la tabla.
CREATE INDEX IF NOT EXISTS agente_wa_seguimientos_pendientes_idx
  ON public.agente_wa_seguimientos (programado_para)
  WHERE estado = 'PENDIENTE';

-- Configurables desde la pantalla del agente, no en el código: el texto es de
-- David y los minutos se ajustan viendo qué pasa de verdad.
ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS seguimiento_enlace_minutos integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS seguimiento_enlace_texto   text;

-- 0 = apagado. Es la forma de desactivarlo sin desplegar nada.
ALTER TABLE public.agente_wa
  DROP CONSTRAINT IF EXISTS agente_wa_seguimiento_minutos_chk;
ALTER TABLE public.agente_wa
  ADD CONSTRAINT agente_wa_seguimiento_minutos_chk
  CHECK (seguimiento_enlace_minutos >= 0 AND seguimiento_enlace_minutos <= 1440);

UPDATE public.agente_wa
   SET seguimiento_enlace_texto = COALESCE(seguimiento_enlace_texto,
       '¿Pudiste registrar la recogida con el enlace? Si te queda más fácil, '
       || 'dime los datos por aquí y la dejo lista yo.')
 WHERE clave = 'VETERINARIAS';

-- ⚠️ El backend NO es `postgres`: sin este GRANT falla en silencio.
GRANT SELECT, INSERT, UPDATE ON public.agente_wa_seguimientos TO orbit_backend;

-- Nada de esto se expone por PostgREST: la UI habla con el backend propio.
REVOKE ALL ON public.agente_wa_seguimientos FROM anon, authenticated;

COMMIT;
