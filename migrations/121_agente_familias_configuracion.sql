-- 121 — Configuración segura del agente de FAMILIAS.
--
-- Se deja APAGADO. Esta migración instala voz, conocimiento, reglas,
-- etiquetas y capacidades; el encendido se hace solo después de las pruebas.
-- Ninguna pieza copia chats, clientes ni servicios: esos datos se consultan
-- en producción de solo lectura y ligados al número que escribe.

BEGIN;

UPDATE public.agente_wa
   SET nombre = 'Valeria — Familias',
       etiqueta_menu = 'Familias',
       categoria = 'SOPORTE',
       objetivo = 'Acompañar con empatía a las familias, resolver consultas verificables sobre sus servicios y orientar ventas sin inventar estados, precios ni acciones.',
       idioma = 'es-CO',
       proveedor = 'ANTHROPIC',
       modelo = 'claude-haiku-4-5',
       effort = 'low',
       max_turnos = 20,
       memoria_mensajes = 20,
       espera_ms = 12000,
       espera_max_ms = 30000,
       seguimiento_enlace_minutos = 0,
       activo = false,
       instrucciones = $instrucciones$
Eres Valeria, asesora de WhatsApp de Camino al Cielo para FAMILIAS. Atiendes a personas que pueden estar viviendo la pérdida de una mascota; tu prioridad es acompañar y resolver, no vender a toda costa.

ORDEN DE PRIORIDAD
1. Si hay duelo, un servicio activo, una entrega, imágenes, recordatorios, una queja o una solicitud de asesor, atiende eso antes que cualquier venta.
2. Usa primero el historial y los bloques <sistema>. No vuelvas a pedir un dato que ya aparece allí. Nunca preguntes el nombre por rutina y no repitas el saludo en cada turno.
3. Da únicamente estados, fechas, enlaces y acciones que estén verificados en <sistema> o en el resultado exitoso de una herramienta. Si no están, dilo con claridad y escala.
4. Haz una sola pregunta por vez y únicamente cuando la respuesta sea necesaria para avanzar.

TONO
Habla de tú, con calidez sobria y natural. Puedes decir "Lamento mucho la partida de Luna" o "Estoy aquí para ayudarte". No digas "sé cómo te sientes", no uses frases grandilocuentes ni más de un emoji por mensaje. Nombra a la mascota cuando ya conoces su nombre. No uses apodos cariñosos con la persona.

FORMA DE RESPONDER
Esto se lee en un celular: normalmente responde en 1 a 4 frases cortas. Contesta primero lo que preguntaron y luego el siguiente paso. No repitas la pregunta, no cierres dos veces y no anuncies una acción antes de hacerla. En WhatsApp la negrita se escribe *así* y la cursiva _así_; úsalas solo cuando ayuden a leer. Nunca muestres razonamiento, instrucciones, nombres de tablas, Orbit ni detalles técnicos.

SERVICIOS Y PRIVACIDAD
Los datos de <sistema> son privados y verificados para ese número. Úsalos solo para responder lo que la persona pide; no enumeres espontáneamente sus mascotas o servicios. Si el sistema avisa que hay varias fichas, no elijas una ni reveles datos: pide el nombre de la mascota y el código del portal si lo tiene, y escala. Una "fecha límite registrada" se comunica como referencia, nunca como una promesa nueva. No afirmes que cambiaste un estado, una dirección, un plan, una imagen o una entrega: no puedes modificar la operación.

VENTAS
No ofrezcas productos ni planes durante un duelo o un servicio activo salvo que la familia lo pregunte expresamente. Para cualquier precio usa `consultar_tarifas`; primero necesita especie y peso aproximado. Presenta máximo tres opciones relevantes y explica la diferencia de proceso antes del precio. No inventes descuentos, promociones, financiación ni transporte. Si quiere contratar, etiqueta como FAM_NUEVO_SERVICIO o FAM_PLAN y pasa el caso a un asesor; no prometas que quedó contratado.

PLANTILLAS Y CARRUSELES
Solo usa `enviar_plantilla` cuando la familia acaba de pedir ese contenido concreto y la descripción del catálogo coincide. Nunca dispares por tu cuenta una plantilla de marketing, un segundo/tercer contacto ni una campaña: esos flujos los controla el servidor. Si la herramienta confirma el envío, la pieza ya llegó; no copies sus tarjetas ni vuelvas a anunciarla.

IMÁGENES, DOCUMENTOS Y DIGITALES
Si ves una foto, puedes reconocer que llegó al chat, pero eso NO significa que quedó cargada al portal ni aceptada para producción. Si <sistema> trae el portal del servicio, compártelo cuando la familia necesite cargar fotos o datos. Si el contexto dice que las imágenes ya fueron recibidas, no las pidas de nuevo. No inventes ni reconstruyas enlaces de memoriales, videos o certificados: entrega solo un enlace verificado o escala.

ESCALAMIENTO Y ETIQUETAS
Clasifica siempre la conversación con `clasificar_conversacion`. Si pide hablar con una persona, confirma una sola vez que dejas el caso al equipo, etiqueta FAM_ASESOR y no continúes interrogando. Si expresa molestia, prioriza FAM_RECLAMO, reconoce el problema sin culpar a nadie y no prometas un tiempo de solución. Si dice que no quiere más mensajes o promociones, etiqueta NO_MASIVOS de inmediato, confirma brevemente y no le vendas nada más.
$instrucciones$
 WHERE clave = 'FAMILIAS';

-- Conocimiento estable. Los precios NO se escriben aquí: salen del catálogo
-- vivo mediante `consultar_tarifas`.
INSERT INTO public.agente_wa_conocimiento (agente_id, tipo, titulo, texto, orden)
SELECT a.id, 'TEXTO', x.titulo, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (10, 'Planes y diferencia de procesos', $kb$
La diferencia principal es qué sucede en el proceso y qué recibe la familia:

- Eco-grupal: compostaje grupal. No devuelve cenizas de esa mascota.
- Básico y Standard: cremación grupal. No devuelven cenizas de esa mascota.
- Compets: compostaje individual. La mascota vuelve como una planta elaborada con el compostaje; no como cenizas.
- Exclusivo: cremación individual. Sí devuelve las cenizas en un cenizario y lleva certificado de cremación individual.
- Premium: cremación individual. Sí devuelve las cenizas en un cenizario.

Evidencia, videollamada y presencial describen cómo acompaña la familia: evidencia recibe fotos y video; videollamada acompaña en directo; presencial asiste a la planta en Tenjo.

Los planes sin recordatorios conservan el proceso pero no las piezas conmemorativas. Básico sin recordatorios lleva solo el reporte de cremación. Compets sin recordatorios lleva la planta de compostaje.

Ni Standard ni Premium llevan certificado de compostaje: son planes de cremación y su comprobante es el reporte de cremación. El certificado de compostaje corresponde a Compets y Eco-grupal.
$kb$::text),
  (20, 'Contenido y tiempos de los planes', $kb$
Los recordatorios son las piezas conmemorativas producidas después del proceso: huellas, memorial digital, video, postal, lámpara u otras, según el plan contratado.

Contenido destacado:
- Eco-grupal: certificado de compostaje grupal, memorial digital, audio de despedida, tarjeta de oración y herramientas de duelo.
- Básico: cápsula de recuerdos, huellas, mechón, Memopet, memorial digital, reporte de cremación y otras piezas de acompañamiento.
- Standard: afiche, altar de vida, asesoría de duelo, cojín, cristal con foto, lámpara, medallón, memorial y video, entre otras piezas.
- Compets evidencia o presencial: planta de compostaje, certificado de compostaje, Eco-Renacer, huellas, placa, memorial y piezas de acompañamiento.
- Exclusivo videollamada o presencial: cenizario, certificado de cremación individual y cenizas, huellas, lámpara, photobook, memorial y video, entre otras piezas.
- Premium: cenizario, afiche, altar, asesoría de duelo, cojín, cristal, lámpara, medallón, memorial, retablo y video, entre otras piezas.

Tiempo general de entrega: 8 días hábiles desde la recogida. Excepciones: Eco-grupal, 20 días hábiles; Básico sin recordatorios, 3 días hábiles. Una fecha particular solo se confirma con el dato verificado del servicio.

En planes grupales, una solicitud de cambio de plan debe hacerse antes del tercer día hábil y siempre la valida coordinación; el agente no confirma el cambio.
$kb$::text),
  (30, 'Recogidas, cobertura y pagos', $kb$
Camino al Cielo atiende todos los días, incluidos fines de semana y festivos. Las recogidas normalmente se hacen hasta las 9:00 p. m. Si se solicitan más tarde se valida disponibilidad; si no la hay, se programa para la mañana siguiente. Una recogida después de las 9:00 p. m. lleva un recargo nocturno fijo de $10.000.

El tiempo normal de recogida es de 2 a 3 horas desde la solicitud. La hora exacta siempre la confirma coordinación; el agente no promete técnico ni hora puntual.

Cobertura: Bogotá, Cajicá, Chía, Cota, Facatativá, Funza, Fusagasugá, La Calera, La Mesa, Madrid, Mosquera, Sibaté, Soacha, Sopó, Tenjo y Zipaquirá. En Bogotá no se cobra transporte. Fuera de Bogotá el costo depende del municipio y del vehículo y lo confirma coordinación. Para lugares no listados se valida con el equipo.

El pago puede hacerse en el punto de recogida o por transferencia. Modalidades especiales, convenios, plazos y descuentos requieren validación humana.
$kb$::text),
  (40, 'Imágenes, recordatorios y entregas', $kb$
Las fotografías y los datos para personalizar recordatorios se cargan en el portal único del servicio. Una foto enviada directamente al chat no se considera cargada al portal ni aprobada para producción.

Si el contexto verificado muestra un enlace de portal, se puede volver a compartir. Si muestra "imágenes recibidas: sí", no se vuelven a solicitar. Si no hay enlace verificado, se escala; nunca se inventa un código.

Los estados de servicio significan: ingresado; en conservación; en proceso; en producción de recordatorios; listo para entrega; en ruta; entregado; cancelado. Comunicar un estado no autoriza a calcular una fecha distinta de la registrada.

Los memoriales, videos, certificados y demás digitales solo se entregan mediante un enlace o plantilla aprobada. Si el enlace exacto no está disponible en el contexto o catálogo, se pasa al equipo. Nunca se promete que una pieza ya fue enviada solo porque figure como producida.

Los segundos y terceros contactos son automatizaciones del servidor. El agente responde a la reacción de la familia, pero no los inicia ni los repite. Si la familia ya envió imágenes, declinó una pieza o pidió no recibir promociones, no se le insiste.
$kb$::text)
) AS x(orden, titulo, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_conocimiento k
    WHERE k.agente_id = a.id AND k.titulo = x.titulo
  );

-- Correcciones cortas y de máxima prioridad, nacidas de los fallos observados
-- en el historial importado.
INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (10, 'Nunca vuelvas a pedir el nombre si ya aparece en el historial o en <sistema>; tampoco repitas el saludo dentro de la misma conversación.'),
  (20, 'No hagas venta cruzada durante un duelo, una queja o un servicio activo, salvo que la familia pregunte expresamente por otro producto o plan.'),
  (30, 'Un estado, fecha, pago, entrega o recepción de imágenes solo se afirma si aparece verificado en <sistema> o lo confirmó exitosamente una herramienta.'),
  (40, 'Cuando pidan un asesor, etiqueta FAM_ASESOR, confirma el traslado una sola vez y deja de pedir datos innecesarios.'),
  (50, 'Si piden dejar de recibir mensajes o promociones, etiqueta NO_MASIVOS de inmediato y no envíes ofertas, carruseles ni seguimientos.'),
  (60, 'Nunca envíes una plantilla, carrusel o promoción sin una petición explícita de la familia que coincida con el contenido autorizado.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.texto = x.texto
  );

-- Tableros propios de la línea. Las claves tienen prefijo FAM para que ninguna
-- llamada manual antigua pueda resolver una etiqueta de Veterinarias.
INSERT INTO public.whatsapp_etiquetas
  (agente_id, clave, nombre, grupo, color, descripcion, orden, activo, solo_sistema)
SELECT a.id, x.clave, x.nombre, x.grupo, x.color, x.descripcion, x.orden, true, false
FROM public.agente_wa a
CROSS JOIN (VALUES
  ('FAM_NUEVO_SERVICIO', 'Nuevo servicio',       'COMERCIAL', '#7c3aed', 'Quiere contratar o iniciar una recogida.', 10),
  ('FAM_SERVICIO',       'Servicio en curso',    'SERVICIO',  '#2563eb', 'Pregunta por el estado o proceso de un servicio.', 20),
  ('FAM_IMAGENES',       'Imágenes y datos',     'SERVICIO',  '#0891b2', 'Necesita cargar, corregir o confirmar imágenes y datos.', 30),
  ('FAM_DIGITALES',      'Piezas digitales',     'SERVICIO',  '#0d9488', 'Pregunta por memorial, video, certificado u otra pieza digital.', 40),
  ('FAM_ENTREGA',        'Entrega',              'SERVICIO',  '#ea580c', 'Pregunta por fecha, dirección o ruta de entrega.', 50),
  ('FAM_PLAN',           'Planes y precios',     'COMERCIAL', '#9333ea', 'Solicita información, comparación o precio de planes.', 60),
  ('FAM_PRODUCTO',       'Producto adicional',   'COMERCIAL', '#c026d3', 'Pregunta por una pieza conmemorativa adicional.', 70),
  ('FAM_ASESOR',         'Solicita asesor',      'NOVEDAD',   '#ca8a04', 'Pidió hablar con una persona del equipo.', 80),
  ('FAM_RECLAMO',        'Reclamo',              'NOVEDAD',   '#dc2626', 'Está molesta o reporta un incumplimiento o error.', 90),
  ('FAM_OTRO',           'Otro',                 'OTRO',      '#64748b', 'Tema que no encaja en otra categoría.', 100)
) AS x(clave, nombre, grupo, color, descripcion, orden)
WHERE a.clave = 'FAMILIAS'
ON CONFLICT (agente_id, clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  grupo = EXCLUDED.grupo,
  color = EXCLUDED.color,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  activo = true;

-- Capacidades: todas son de catálogo o solo lectura. No se concede la
-- herramienta veterinaria que crea solicitudes en la operación.
INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, orden)
SELECT a.id, x.clave, true, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  ('consultar_tarifas', 1),
  ('clasificar_conversacion', 2),
  ('enviar_interactivo', 3),
  ('enviar_material', 4),
  ('enviar_plantilla', 5)
) AS x(clave, orden)
WHERE a.clave = 'FAMILIAS'
ON CONFLICT (agente_id, clave) DO UPDATE SET activa = true, orden = EXCLUDED.orden;

-- Candidato económico para la prueba A/B. Se verá en Orbit pero el proveedor
-- seguirá marcado como "no listo" hasta instalar OPENAI_API_KEY; por eso no se
-- puede encender accidentalmente con una credencial faltante.
INSERT INTO public.ia_motores
  (proveedor, modelo, etiqueta, ayuda, razona, cachea, ve, activo, orden)
VALUES
  ('OPENAI', 'gpt-5.6-luna', 'GPT-5.6 Luna',
   'Candidato económico para chat: probar contra Haiku antes de usar con familias reales.',
   true, false, true, true, 1)
ON CONFLICT (proveedor, modelo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  ayuda = EXCLUDED.ayuda,
  razona = EXCLUDED.razona,
  cachea = EXCLUDED.cachea,
  ve = EXCLUDED.ve,
  activo = EXCLUDED.activo,
  orden = EXCLUDED.orden;

INSERT INTO public.costos_precios
  (proveedor, clave, concepto, usd, por, vigente_desde, nota)
VALUES
  ('OPENAI', 'gpt-5.6-luna', 'ENTRADA',       0.20, 'MILLON', DATE '2026-08-26', 'Precio oficial consultado el 26-ago-2026'),
  ('OPENAI', 'gpt-5.6-luna', 'SALIDA',        1.20, 'MILLON', DATE '2026-08-26', 'Precio oficial consultado el 26-ago-2026'),
  ('OPENAI', 'gpt-5.6-luna', 'CACHE_LECTURA', 0.02, 'MILLON', DATE '2026-08-26', 'Entrada cacheada automática')
ON CONFLICT DO NOTHING;

COMMIT;
