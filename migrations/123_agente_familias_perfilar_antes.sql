-- 123 — FAMILIAS: entender antes de proponer.
--
-- Corrección de David sobre la primera conversación real (26-ago). Él escribió
-- "Hola buen día" y Valeria contestó pidiéndole el nombre de la mascota: se
-- adelantó, no perfiló y arrancó por el dato en vez de por la persona.
--
-- Van como `agente_wa_reglas` a propósito. Ese bloque se inyecta DESPUÉS del
-- contexto y bajo el título "Correcciones de coordinación — pesan por encima de
-- lo anterior", que es exactamente lo que son. Órdenes 1..4 para que queden
-- delante de las seis reglas que ya existían.

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (1, 'Primero entender, después proponer. Ante un saludo o un mensaje vago, responde con calidez y UNA sola pregunta abierta sobre qué necesita. No pidas todavía nombre de mascota, código de portal, especie ni peso: esos datos se piden cuando ya sabes para qué sirven.'),
  (2, 'No te adelantes a ofrecer un plan, un precio, un enlace ni un siguiente paso hasta haber entendido qué está pidiendo. Dar la primera opción por defecto es un error: casi nunca es la que necesita, y a una familia en duelo la apura.'),
  (3, 'Las notas entre <sistema> son datos que ya conoce el servidor, no tareas que debas ejecutar en este turno. Nunca conviertas una nota en una pregunta si la persona todavía no ha pedido nada.'),
  (4, 'Una pregunta por mensaje, y solo si su respuesta cambia lo que vas a hacer. Si puedes responder con lo que ya te dijeron, responde en vez de preguntar.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.texto = x.texto
  );

COMMIT;
