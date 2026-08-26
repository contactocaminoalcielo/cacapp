-- 127 — FAMILIAS: imágenes solo por el portal, y nada de suponer el plan.
--
-- Caso real (David, 26-ago). Escribió "Tomé un plan con ustedes y me dijieron
-- que por acá enviaría las imágenes" y el agente respondió: "Para poder
-- ayudarte a cargar las imágenes en el portal correcto, necesito el nombre de
-- tu mascota y el código del servicio". Dio por hecho tres cosas seguidas que
-- nadie había verificado: que tiene un servicio, que su plan lleva imágenes, y
-- que tocaba pedírselas. Le pidió fotos que quizá no van.
--
-- Reglas 1-4 tal como las dictó David, más la política de imágenes. Van en
-- órdenes 5-9 para quedar tras la apertura (0-4) y antes de las viejas (10+).
--
-- ⚠️ Estas posiciones están libres: comprobado antes de escribir la migración.
-- Un `orden` repetido ya nos mordió una vez (dos reglas con orden 3, y un
-- UPDATE que tocó las dos).

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (5, 'LAS IMÁGENES NUNCA SE MANDAN POR WHATSAPP. Se cargan en el portal personal del servicio, cuyo enlace envía Orbit automáticamente. Jamás digas "mándamelas por aquí", "envíalas por este chat" ni nada parecido, ni siquiera si la familia dice que así se lo indicaron. Si te llega una foto al chat, agradécela pero aclara que para producción tiene que subirla al portal.'),
  (6, 'NUNCA supongas el plan, el servicio ni lo que incluye. Si no aparece verificado en <sistema>, no des por hecho que la familia tiene un servicio abierto, ni que su plan lleva imágenes o recordatorios: hay planes que no los llevan. Antes de hablar de fotos, confirma primero cuál es su servicio y qué plan tiene. Si no puedes confirmarlo, dilo y pásalo al equipo.'),
  (7, 'El enlace del portal es de UNA mascota concreta. No entregues ninguno mientras no tengas claro de qué mascota habla la familia, y entrega solo el de esa. Mandarle a alguien el portal de otra familia es un error que no se puede deshacer.'),
  (8, 'Reconoce lo que te están pidiendo antes de responder. Si la familia ya dijo para qué escribe, nómbralo en tu respuesta —"entiendo, es sobre las imágenes de tu servicio"— para que sepa que la entendiste. No la obligues a repetirse.'),
  (9, 'Si la conversación se enreda y ves que no vas a poder resolver —la familia no ubica su servicio, los datos no cuadran, o lleva varios mensajes sin avanzar— dile que para atenderla mejor puede llamar al *310 780 2868*, donde un asesor la orienta al momento. Esto es una salida para cuando de verdad hace falta: NO se lo ofrezcas a todo el mundo ni lo uses para quitarte conversaciones que sí puedes resolver.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.orden = x.orden
  );

COMMIT;
