-- 091 — Las dos etiquetas de NOVEDAD que faltaban en el catálogo
--
-- Por qué: estas dos entraron en producción con un INSERT a mano (el catálogo es
-- una tabla justamente para eso, y fue lo correcto en el momento). El problema es
-- que quedaron SOLO en prod: una base levantada desde migrations/ no las tiene, y
-- el código sí las nombra por clave.
--
-- Lo que se pierde si faltan es lo peor de todo: nada visible.
--   · FALLO_AGENTE  la pone `avisarQueQuedoSinRespuesta()` cuando el agente
--     revienta o llega al tope de turnos. `etiquetar()` NO lanza por diseño (un
--     agente caído no puede tumbar la recepción), así que sin la fila de catálogo
--     la vet se queda sin respuesta Y sin que nadie se entere. El aviso muere en
--     silencio: exactamente lo que la etiqueta venía a evitar.
--   · SIN_RESPUESTA la pone el agente al escalar por no saber algo. Es la materia
--     prima de "lo que no supo responder" en la pantalla de configuración.
--
-- Idempotente: en prod ya existen, así que aquí solo se actualiza el texto.
-- La `descripcion` es el criterio que lee el agente — se deja igual al de prod.

BEGIN;

INSERT INTO public.whatsapp_etiquetas (clave, nombre, grupo, color, orden, descripcion) VALUES
('SIN_RESPUESTA', 'No supe responder', 'NOVEDAD', '#EA580C', 0,
 'Te preguntaron algo que NO está en tu base de conocimiento y tuviste que escalar. Ponla siempre que escales por no saber — no por un reclamo ni por un caso que necesite a una persona por otra razón. En el motivo escribe LA PREGUNTA tal como te la hicieron: de ahí sale lo que hay que agregarte para que la próxima sí la sepas.'),

-- Esta NO la elige el modelo: la pone el servidor. Se describe igual de claro
-- porque la descripción es lo que ve el coordinador en la bandeja.
('FALLO_AGENTE', 'El agente no pudo responder', 'NOVEDAD', '#7F1D1D', 0,
 'La pone el sistema, no el agente: hubo un error tecnico y la veterinaria se quedo sin respuesta. Hay que contestarle a mano.')

ON CONFLICT (clave) DO UPDATE
  SET nombre      = EXCLUDED.nombre,
      grupo       = EXCLUDED.grupo,
      color       = EXCLUDED.color,
      descripcion = EXCLUDED.descripcion,
      activo      = true;

COMMIT;
