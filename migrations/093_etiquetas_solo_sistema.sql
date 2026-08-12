-- 093 — Etiquetas que pone el sistema, no el agente
--
-- Dos cosas, y las dos nacen del mismo descuido:
--
-- 1) `construirHerramientas()` arma el enum de `clasificar_conversacion` con
--    TODAS las etiquetas activas. Eso metió en la lista del modelo una que no es
--    suya: FALLO_AGENTE la pone el servidor cuando el agente revienta. Nada
--    impide que el modelo la elija mientras responde con toda normalidad — y
--    entonces coordinación ve "el agente no pudo responder" en una conversación
--    que está perfectamente atendida. Se pierde la confianza en la única señal
--    que avisa de los fallos mudos.
--
-- 2) Hacía falta una etiqueta para lo que el agente NO puede leer (notas de voz,
--    fotos, documentos). También la pone el servidor.
--
-- La columna `solo_sistema` separa las dos poblaciones. Las etiquetas siguen
-- viéndose y filtrándose igual en la bandeja: lo único que cambia es que el
-- modelo ya no puede elegirlas.

BEGIN;

ALTER TABLE public.whatsapp_etiquetas
  ADD COLUMN IF NOT EXISTS solo_sistema boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_etiquetas.solo_sistema IS
  'true = la pone el servidor, no el modelo. Se excluye del enum de la herramienta clasificar_conversacion.';

UPDATE public.whatsapp_etiquetas SET solo_sistema = true WHERE clave = 'FALLO_AGENTE';

INSERT INTO public.whatsapp_etiquetas (clave, nombre, grupo, color, orden, solo_sistema, descripcion) VALUES
('AUDIO_O_IMAGEN', 'Nota de voz, foto o documento', 'NOVEDAD', '#0F766E', 0, true,
 'La pone el sistema: llegó una nota de voz, una foto o un documento. El agente no puede oírlo ni verlo, así que le avisó a la veterinaria que lo atiende una persona. Hay que abrir la conversación y responderle.')
ON CONFLICT (clave) DO UPDATE
  SET nombre       = EXCLUDED.nombre,
      grupo        = EXCLUDED.grupo,
      color        = EXCLUDED.color,
      solo_sistema = EXCLUDED.solo_sistema,
      descripcion  = EXCLUDED.descripcion,
      activo       = true;

COMMIT;
