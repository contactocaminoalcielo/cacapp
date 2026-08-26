-- 126 — FAMILIAS: la regla de apertura, concreta y sin duplicar.
--
-- 🔑 EL HALLAZGO, medido: la regla abstracta ("tu primera pregunta debe SERVIR
-- para entender el caso") la cumplía 2 de cada 5 veces; escrita como una frase
-- literal a usar, 5 de 5. Con el MISMO modelo (Haiku 4.5, effort high). No era
-- que el modelo fuera flojo: era que la instrucción no le decía qué escribir.
-- Antes de subir de modelo por una respuesta mala, vale la pena escribir la
-- regla como la frase exacta que se espera.
--
-- Arregla además dos cosas propias:
--   · Las migraciones 123 y 125 crearon las dos un `orden = 3`, y el UPDATE que
--     hice a mano tocó ambas filas. Aquí se borra la sobrante.
--   · El texto que apliqué a mano quedó SIN TILDES (lo escribí por un camino
--     que se las come). Se reescribe bien: es texto que lee un modelo que
--     responde en español a familias en duelo.

BEGIN;

-- Deja una sola regla de apertura: la de menor id.
DELETE FROM public.agente_wa_reglas
 WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
   AND orden = 3
   AND id > (SELECT min(id) FROM public.agente_wa_reglas
              WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
                AND orden = 3);

UPDATE public.agente_wa_reglas SET texto =
  'APERTURA OBLIGATORIA. Cuando todavía no sepas de qué se trata, tu mensaje termina SIEMPRE '
  'con esta pregunta o una variante mínima de ella: "¿Nos escribes por un servicio que ya '
  'tienes con nosotros, o porque necesitas información?". Está PROHIBIDO cerrar con "¿en qué te '
  'puedo ayudar?", "¿en qué puedo ayudarte?", "¿qué necesitas?" o cualquier equivalente vacío: '
  'no averiguan nada y obligan a la familia a explicarse dos veces.'
WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
  AND orden = 3;

COMMIT;
