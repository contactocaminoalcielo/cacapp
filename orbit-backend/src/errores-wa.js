// Traduce los errores de WhatsApp/Meta a algo que una persona entienda y sepa
// qué hacer.
//
// Pedido de David el 2026-09-18: en el seguimiento de automatizaciones el error
// salía tal cual lo devuelve Meta («131049 · This message was not delivered to
// maintain healthy ecosystem engagement…») y el equipo «queda perdido y no sabe
// qué significa». Aquí vive el catálogo, en un solo sitio, para que cualquier
// pantalla que enseñe un fallo de envío hable en el mismo idioma.
//
// El catálogo sale de lo que HAY en producción (medido el 18-sep-2026: 9 códigos
// de Meta, timeouts y dos mensajes propios), no de la documentación entera de
// Meta. Un error sin traducción no se esconde: se enseña el texto técnico con
// una explicación genérica. Cuando aparezca uno nuevo repetido, se agrega aquí.
//
// Cada entrada: `prueba` (regex sobre el texto crudo), `titulo` (qué pasó, en
// una frase), `hacer` (qué hacer ahora), `culpa` (de quién depende:
// NUMERO | META | CUENTA | PLANTILLA | PASAJERO | ORBIT) y `reintentar`
// (si vale la pena relanzar tal cual).

const CATALOGO = [
  // ── El número del destinatario ────────────────────────────────────────────
  {
    prueba: /131026|Message Undeliverable|Unable to deliver message/i,
    titulo: 'El número no tiene WhatsApp o bloqueó nuestra línea.',
    hacer: 'Confirma el número con la familia y corrígelo en la ficha del cliente; luego relanza. Si el número es correcto, contáctalos por llamada.',
    culpa: 'NUMERO', reintentar: false,
  },
  {
    prueba: /130472|part of an experiment/i,
    titulo: 'Meta tiene este número en un experimento y no le entrega plantillas de marketing por ahora.',
    hacer: 'No depende de nosotros. Escríbele por wa.me desde el celular o inténtalo en unos días.',
    culpa: 'META', reintentar: false,
  },
  {
    prueba: /131049|healthy ecosystem/i,
    titulo: 'Meta frenó el mensaje: esta persona ya recibió demasiados mensajes de marketing de empresas hoy.',
    hacer: 'No es culpa del número. Relanza mañana o pasado; casi siempre sale al segundo intento. Si es urgente, wa.me.',
    culpa: 'META', reintentar: true,
  },
  {
    prueba: /131056|pair rate limit|too many messages sent to this recipient/i,
    titulo: 'Se le enviaron muchos mensajes seguidos a este mismo número.',
    hacer: 'Espera unas horas y relanza.',
    culpa: 'META', reintentar: true,
  },
  {
    prueba: /131047|re-engagement|more than 24 hours/i,
    titulo: 'Pasaron más de 24 horas desde el último mensaje de la familia: solo se le puede escribir con plantilla aprobada.',
    hacer: 'Este envío debe salir como plantilla. Revisa que el flujo tenga plantilla configurada y relanza.',
    culpa: 'PLANTILLA', reintentar: false,
  },

  // ── La cuenta de WhatsApp Business ────────────────────────────────────────
  {
    prueba: /131042|payment issue|Business eligibility/i,
    titulo: 'Meta bloqueó los envíos por un problema de pago de la cuenta de WhatsApp Business.',
    hacer: 'Revisa el método de pago en el Administrador comercial de Meta (o con Zolutium). Cuando esté al día, relanza: el mensaje no salió.',
    culpa: 'CUENTA', reintentar: true,
  },
  {
    prueba: /#200\)|necessary permissions to send messages on behalf/i,
    titulo: 'La línea no tiene permiso para enviar por esta cuenta de WhatsApp Business (token vencido o permisos retirados).',
    hacer: 'Revisa el token y los permisos de la línea en Configuración → WhatsApp. Cuando vuelva a funcionar, relanza.',
    culpa: 'CUENTA', reintentar: true,
  },
  {
    prueba: /131030|not in allowed list/i,
    titulo: 'La línea está en modo de pruebas: solo puede escribirle a números autorizados.',
    hacer: 'Pide que la línea pase a producción (Meta o Zolutium). Mientras tanto, wa.me.',
    culpa: 'CUENTA', reintentar: false,
  },
  {
    prueba: /131048|spam rate limit|131031|account.*locked|133010|not registered/i,
    titulo: 'La línea está limitada o bloqueada por Meta por calidad de envíos.',
    hacer: 'Revisa el estado de la línea en el Administrador de WhatsApp. No relances en lote hasta que se levante.',
    culpa: 'CUENTA', reintentar: false,
  },
  {
    prueba: /130429|rate limit hit|Too many requests/i,
    titulo: 'Se superó el límite de mensajes por segundo de la línea.',
    hacer: 'Fallo pasajero. Relanza en unos minutos.',
    culpa: 'PASAJERO', reintentar: true,
  },

  // ── La plantilla y sus variables ──────────────────────────────────────────
  {
    prueba: /132005|Translated text too long|demasiado largo para Meta|excede_limite_meta/i,
    titulo: 'Una variable de la plantilla quedó más larga de lo que Meta permite (nombre, enlace o texto muy largo).',
    hacer: 'Acorta el nombre de la mascota o del dueño en la ficha, o revisa el texto que arma el flujo, y relanza.',
    culpa: 'PLANTILLA', reintentar: false,
  },
  {
    prueba: /132001|Template name does not exist|132015|132016|template.*(paused|disabled)|sin_plantilla|plantilla.*no está configurada|sin plantilla/i,
    titulo: 'La plantilla configurada no existe en esta línea, cambió de nombre o idioma, o Meta la pausó.',
    hacer: 'Revisa la plantilla en Configuración → WhatsApp → Plantillas y la configuración del flujo; luego relanza.',
    culpa: 'PLANTILLA', reintentar: false,
  },
  {
    prueba: /132000|132012|parameter.*(mismatch|count|format)|Faltan valores/i,
    titulo: 'Las variables que se mandaron no coinciden con las que espera la plantilla.',
    hacer: 'La plantilla se editó en Meta y el flujo quedó desfasado. Revísala en Plantillas y avisa a soporte de Orbit.',
    culpa: 'ORBIT', reintentar: false,
  },

  // ── Pasajeros: red, tiempo, servidor ──────────────────────────────────────
  {
    prueba: /Request Timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i,
    titulo: 'Meta no respondió a tiempo. El mensaje probablemente no salió.',
    hacer: 'Relanza. Si es un certificado o archivo pesado y vuelve a fallar, revisa el PDF.',
    culpa: 'PASAJERO', reintentar: true,
  },
  {
    prueba: /upstream|Bad Gateway|502|503|504|is not valid JSON/i,
    titulo: 'El servidor de Orbit cortó la conexión a mitad del envío (fallo pasajero).',
    hacer: 'Relanza. Si se repite varias veces seguidas, avisa a soporte de Orbit.',
    culpa: 'PASAJERO', reintentar: true,
  },
  {
    prueba: /131000|Something went wrong|131009|131016|Service unavailable/i,
    titulo: 'Fallo genérico de Meta, casi siempre pasajero.',
    hacer: 'Relanza. Si sigue fallando, prueba con wa.me.',
    culpa: 'PASAJERO', reintentar: true,
  },
  {
    prueba: /131053|media upload|Unsupported.*media|media.*too large/i,
    titulo: 'Meta no aceptó el archivo adjunto (formato o tamaño).',
    hacer: 'Revisa el archivo (PDF o imagen) del envío y relanza.',
    culpa: 'ORBIT', reintentar: false,
  },

  // ── Mensajes propios de Orbit ─────────────────────────────────────────────
  {
    prueba: /no tiene un WhatsApp válido|sin_whatsapp|WhatsApp registrado|no tiene WhatsApp/i,
    titulo: 'El cliente no tiene un número de WhatsApp válido en su ficha.',
    hacer: 'Completa o corrige el WhatsApp en la ficha del cliente y relanza.',
    culpa: 'NUMERO', reintentar: false,
  },
  {
    prueba: /quedó en ENVIANDO|Envío interrumpido/i,
    titulo: 'El envío se interrumpió a mitad de camino (Orbit se reinició o se cayó la conexión).',
    hacer: 'Relanza: el mensaje no salió.',
    culpa: 'PASAJERO', reintentar: true,
  },
  {
    prueba: /Meta reportó fallo de entrega/i,
    titulo: 'Se envió, pero Meta avisó después que no pudo entregarlo.',
    hacer: 'Mira el motivo del acuse en la misma fila y relanza si aplica.',
    culpa: 'META', reintentar: true,
  },
  {
    prueba: /envío automático de WhatsApp no está configurado|usar_plantilla/i,
    titulo: 'El envío automático de digitales no está configurado (falta la plantilla o las credenciales).',
    hacer: 'Configúralo en Configuración → Digitales, o envíalo manual desde Digitales.',
    culpa: 'ORBIT', reintentar: false,
  },
  {
    prueba: /No hay PDF generado/i,
    titulo: 'El certificado de este lote no tiene PDF generado.',
    hacer: 'Genera el PDF desde Certificados y envíalo desde allí.',
    culpa: 'ORBIT', reintentar: false,
  },
  {
    prueba: /apagado|enciéndelo primero/i,
    titulo: 'El flujo está apagado.',
    hacer: 'Enciéndelo con el botón de la tarjeta y vuelve a relanzar.',
    culpa: 'ORBIT', reintentar: false,
  },
]

const GENERICO = {
  titulo: 'Error técnico al enviar.',
  hacer: 'Relanza una vez. Si vuelve a fallar, copia el detalle técnico y avísale a soporte de Orbit.',
  culpa: 'DESCONOCIDO', reintentar: true,
}

/**
 * Traduce un texto de error (de Meta, de la red o propio) a algo que se pueda
 * enseñar. Devuelve null si no hay error.
 */
export function explicarErrorWa(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo) return null
  const e = CATALOGO.find(c => c.prueba.test(crudo)) || GENERICO
  return {
    titulo: e.titulo, hacer: e.hacer, culpa: e.culpa, reintentar: e.reintentar,
    tecnico: crudo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300),
  }
}
