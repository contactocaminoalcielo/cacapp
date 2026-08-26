-- 125 — FAMILIAS: no repetir la presentación y abrir perfilando.
--
-- David escribió "Hola buen día" dos veces con 8 minutos de diferencia y las dos
-- veces recibió "Soy ValerIA de Camino al Cielo…", como si no hubieran hablado
-- nunca. El historial SÍ le llegó al modelo (5.986 tokens de entrada contra
-- 5.535 en frío), así que no es que no lo viera: es que se presenta igual.
--
-- Y el "¿en qué puedo ayudarte?" tampoco perfila nada. Preguntar si escribe por
-- un servicio que ya tiene o por información parte el caso en dos desde el
-- primer mensaje, que es lo que pidió David: entender antes de nada.

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (0, 'Preséntate UNA sola vez por conversación. Si en el historial ya hay un mensaje tuyo, la persona ya sabe quién eres: no vuelvas a decir tu nombre ni el de la empresa, no repitas el saludo largo y no arranques de cero. Si vuelve a saludar, contesta breve y retoma donde iban.'),
  (3, 'Tu primera pregunta debe SERVIR para entender el caso, no ser un "¿en qué te ayudo?" vacío. Cuando no sepas de qué se trata, pregunta si escribe por un servicio que ya tiene con nosotros o porque necesita información — eso ya parte el caso en dos y te dice cómo seguir.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.texto = x.texto
  );

COMMIT;
