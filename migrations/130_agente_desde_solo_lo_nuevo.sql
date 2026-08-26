-- 130 — Un agente que se enciende contesta SOLO lo que llegue desde ese momento.
--
-- Pedido de David antes de pasar la línea de familias: "que empiece a responder
-- a partir de lo nuevo, que no se vaya hacia conversaciones viejas; no podemos
-- descontrolar esa línea que es de alto flujo".
--
-- 🩸 Sin esto, encender el agente en esa línea era una avalancha. `barrerPendientes`
-- busca conversaciones cuyo ÚLTIMO mensaje sea entrante dentro de las **24 horas**
-- anteriores y las retoma a 5 por barrido, con un barrido por minuto: 300 a la
-- hora. En una línea con ~28 personas escribiendo al día, encenderla a las 3 de
-- la tarde significaba contestarle de golpe a todo el que hubiera escrito desde
-- las 3 del día anterior — gente que ya fue atendida por una persona, o que
-- escribió y se le pasó el momento.
--
-- `agente_desde` es esa línea de corte. La pone un TRIGGER en el instante en que
-- el agente pasa de apagado a encendido, así vale igual si se enciende por SQL o
-- desde la pantalla de Agentes IA — no depende de que quien lo encienda se
-- acuerde.
--
-- NULL = sin corte, que es el comportamiento de siempre. VETERINARIAS se queda
-- en NULL a propósito: lleva semanas andando y no se le cambia la conducta por
-- una migración pensada para otra línea.

BEGIN;

ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS agente_desde timestamptz;

COMMENT ON COLUMN public.agente_wa.agente_desde IS
  'El agente ignora los mensajes anteriores a esta marca. La pone el trigger al encenderlo. NULL = sin corte.';

CREATE OR REPLACE FUNCTION public.marcar_agente_desde()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Solo en el filo apagado → encendido. Un UPDATE cualquiera sobre un agente ya
  -- encendido NO debe correr la marca hacia adelante: eso le haría olvidar los
  -- mensajes que llegaron mientras alguien editaba su prompt.
  IF NEW.activo AND NOT COALESCE(OLD.activo, false) THEN
    NEW.agente_desde := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_agente_desde ON public.agente_wa;
CREATE TRIGGER trg_agente_desde
  BEFORE UPDATE OF activo ON public.agente_wa
  FOR EACH ROW
  EXECUTE FUNCTION public.marcar_agente_desde();

COMMIT;
