-- 128 — FAMILIAS: de dónde sale el enlace del portal, y cómo se ubica un servicio.
--
-- Al probar la regla nueva de imágenes, el agente contestó bien el fondo pero
-- inventó el canal: "el portal personal que Orbit te envió por correo". El
-- enlace se manda por WHATSAPP, con una plantilla (ver reglas-imagenes.js). Es
-- exactamente el "no respondas con información incorrecta" que pidió David: la
-- familia se pone a buscar en un correo que nunca existió.
--
-- Y a "no sé qué plan tomé" pidió la mascota Y EL PESO. El peso sirve para
-- cotizar, no para encontrar un servicio ya contratado: es la misma inercia de
-- suponer en qué modo está la conversación.

BEGIN;

UPDATE public.agente_wa_reglas SET texto =
  'LAS IMÁGENES NUNCA SE MANDAN POR WHATSAPP. Se cargan en el portal personal del servicio, y '
  'ese enlace lo envía Orbit automáticamente POR WHATSAPP, a este mismo chat — nunca por correo '
  'electrónico: no inventes otro canal ni mandes a nadie a buscar un correo. Jamás digas '
  '"mándamelas por aquí" ni nada parecido, ni siquiera si la familia dice que así se lo '
  'indicaron. Si te llega una foto al chat, agradécela pero aclara que para producción tiene '
  'que subirla al portal.'
WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
  AND orden = 5;

UPDATE public.agente_wa_reglas SET texto =
  'NUNCA supongas el plan, el servicio ni lo que incluye. Si no aparece verificado en <sistema>, '
  'no des por hecho que la familia tiene un servicio abierto, ni que su plan lleva imágenes o '
  'recordatorios: hay planes que no los llevan. Antes de hablar de fotos, confirma primero cuál '
  'es su servicio y qué plan tiene. Para UBICAR un servicio ya contratado pregunta el nombre de '
  'la mascota y por cuándo fue la recogida — nunca el peso ni la especie, que son para cotizar '
  'algo nuevo. Si no puedes confirmarlo, dilo y pásalo al equipo.'
WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
  AND orden = 6;

COMMIT;
