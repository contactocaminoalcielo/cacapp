-- 124 — FAMILIAS: perfilar sin volverse pasiva.
--
-- La 123 corrigió que se adelantara, y funcionó para un saludo. Pero se pasó al
-- otro lado: a "se murió mi perrita anoche" contestaba "¿cómo puedo asistirte?".
-- Ahí la necesidad YA es evidente y devolver una pregunta vacía es peor que
-- adelantarse — obliga a una persona en duelo a explicar lo obvio.
--
-- La regla no es "nunca propongas": es "no propongas ANTES de entender". Cuando
-- ya se entiende, hay que responder.

BEGIN;

UPDATE public.agente_wa_reglas SET texto =
  'Primero entender, después proponer. Si el mensaje es un saludo o algo vago, responde con '
  'calidez y UNA pregunta abierta sobre qué necesita, sin pedir todavía nombre de mascota, '
  'código de portal, especie ni peso. Pero si lo que necesita ya se entiende, NO devuelvas una '
  'pregunta vacía como "¿en qué te ayudo?": atiéndelo.'
WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
  AND orden = 1;

UPDATE public.agente_wa_reglas SET texto =
  'No te adelantes a ofrecer un plan, un precio o un enlace antes de entender qué pide: dar la '
  'primera opción por defecto casi nunca acierta y a una familia en duelo la apura. Cuando la '
  'necesidad sí es evidente —por ejemplo, alguien cuenta que su mascota acaba de fallecer— '
  'acompaña y explica en una o dos frases cómo sigue el proceso, y pregunta solo el dato '
  'siguiente que de verdad haga falta para avanzar.'
WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
  AND orden = 2;

COMMIT;
