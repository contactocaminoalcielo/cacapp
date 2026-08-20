// Motor del agente conversacional de WhatsApp (migración 088).
//
// El agente es AISLADO: no consulta la operación. Su mundo entero es
// `agente_wa.instrucciones` + `agente_wa_conocimiento`. Lo único que escribe es
// una fila en `solicitudes_servicio`, que cae en la columna Solicitudes del
// Kanban para que el coordinador apruebe o descarte.
//
// ⛔ LÍMITE DE ESCRITURA — regla de David (2026-08-12), auditada ese día.
// El agente CONSULTA; no cambia nada en Orbit. Todo lo que puede escribir:
//   1. `solicitudes_servicio` — la solicitud. Es su razón de ser, y nace
//      PENDIENTE para que la apruebe un humano.
//   2. `agente_wa_ejecuciones` — su propia bitácora.
//   3. `whatsapp_conversacion_etiquetas` — la etiqueta de la conversación.
//   4. `whatsapp_mensajes` — el mensaje que responde.
// Los cuatro son la conversación y la solicitud, nada de la operación: ni
// servicios, ni aliados, ni precios, ni planes, ni estados, ni afiliaciones.
// `enlacePersonalAliado()` era la excepción (creaba el token si faltaba) y dejó
// de serlo con la migración 096, que se los generó a los 198 aliados.
// **Antes de darle una herramienta nueva, comprobar que no rompe esta lista.**
//
// ⚠️ NO confundir con `ia.js`: aquel es una llamada suelta para sugerencias
// internas. Este mantiene conversación, usa herramientas y le habla a un
// tercero en nombre de Camino al Cielo.
import Anthropic from '@anthropic-ai/sdk'
import { pool, log } from './db.js'
import { enviarTexto, enviarSobre, etiquetar, acusarLectura } from './whatsapp-cloud.js'
import { catalogoParaAgente, enviarInteractivo } from './whatsapp-interactivos.js'
import { catalogoDeMateriales, enviarMaterial } from './whatsapp-materiales.js'
import { imagenesRecientes, revisarImagenes, revisarAudios } from './whatsapp-media.js'
import { enlacePersonalAliado, enlaceAfiliacion } from './aliados.js'

const MOD = '[agente-wa]'

/** Cuántos mensajes previos se le dan como memoria de la conversación. */
const HISTORIAL = 20

/** Tope de vueltas del ciclo de herramientas dentro de UNA respuesta. */
const MAX_VUELTAS = 5

/**
 * Cuántas fotos de la conversación se le ponen delante al modelo.
 *
 * Dos, y no más, por dinero: cada imagen son ~1.500 tokens y el historial **no
 * se cachea** (lo cacheado es el contexto fijo), así que una foto no se paga una
 * vez — se vuelve a pagar en cada turno que siga viva en la ventana. Con las dos
 * últimas alcanza: la veterinaria pregunta por lo que acaba de mandar.
 */
const MAX_IMAGENES = 2

/**
 * Cuánto se espera, tras el último mensaje, a que la veterinaria termine de
 * escribir. Nadie escribe un párrafo en WhatsApp: escribe "Hola" / "buenas" /
 * "necesito una recogida" / "es un labrador de 30 kilos". Sin esta espera cada
 * renglón disparaba una respuesta propia, todas a la vez y cada una calculada
 * sobre un pedazo distinto de la conversación.
 *
 * Subido de 8 a 12 s con tráfico real (David, 12-ago): con 8 el agente contestaba
 * mientras él seguía escribiendo el siguiente mensaje. En esa prueba los huecos
 * dentro de una misma idea fueron de 3, 5, 7 y 11 segundos — 8 partía la ráfaga
 * justo en el hueco de 11. Más largo empieza a sentirse abandono.
 */
const ESPERA_MS = Math.max(0, Number(process.env.AGENTE_WA_ESPERA_MS || 12000))

/**
 * Techo de la espera, contado desde el PRIMER mensaje sin responder.
 *
 * Sin esto la espera se renueva con cada renglón: alguien que escriba sin pausas
 * largas no recibiría respuesta nunca, y el agente parecería muerto justo con
 * quien más está escribiendo. A los 30 s se contesta con lo que haya llegado.
 */
const ESPERA_MAX_MS = Math.max(ESPERA_MS, Number(process.env.AGENTE_WA_ESPERA_MAX_MS || 30000))

/**
 * Los tiempos configurables de la fila del agente. Un NULL o una basura no
 * pueden dejar el agente respondiendo al instante ni sin responder nunca: se
 * cae al valor de siempre. `0` SÍ es válido —responder sin esperar— y por eso
 * no vale un `||`.
 */
function tiempoDe(valor, porDefecto) {
  const n = Number(valor)
  return Number.isFinite(n) && n >= 0 ? n : porDefecto
}

/**
 * El tope de turnos es por VENTANA, no de por vida.
 *
 * Antes se contaban todas las respuestas dadas a ese contacto desde siempre, sin
 * filtro de fecha: una veterinaria activa gastaba sus 20 en la primera semana y
 * el agente no le volvía a contestar nunca. El freno existe para cortar un bucle
 * (que quema 20 en minutos), no para caducar a un cliente.
 */
const VENTANA_TOPE_HORAS = 24

/**
 * Cuando una persona del equipo escribe en la conversación, el agente se aparta.
 * Dos voces del mismo negocio contestando a la vez —y pudiendo contradecirse— es
 * lo peor que puede ver una clínica.
 *
 * Apartarse no es desatender: la conversación sigue contando como NO leída en la
 * bandeja (el agente nunca apaga ese badge), así que quien la tomó la ve.
 *
 * ⏱️ Eran 12 HORAS, y se bajó a 30 minutos el 2026-08-19. El medio día tenía
 * sentido cuando escribir a mano era la ÚNICA forma de decir "de esta clínica me
 * encargo yo". Ahora eso lo dice el interruptor de la conversación (migración
 * 105), así que la pausa automática solo tiene que cubrir la ida y vuelta de
 * quien está escribiendo en ese momento. Con 12 h, un "buenas tardes" dejaba la
 * conversación sin agente hasta el día siguiente — pasó de verdad, y la clínica
 * se quedó esperando.
 */
const PAUSA_TRAS_HUMANO_MIN = 30

/**
 * Una PLANTILLA enviada a mano no es lo mismo: casi nunca es "yo atiendo a esta
 * clínica", es un aviso —los recordatorios están listos, la línea nueva— y lo
 * que venga después lo contesta el agente como cualquier otra conversación.
 *
 * Diez minutos de margen por si quien la mandó iba a escribir algo más detrás.
 * Pasados, el agente vuelve a estar al mando. Con las 12 horas de una persona
 * escribiendo, mandar una plantilla dejaba la conversación sin respuesta el
 * resto del día — que es como se descubrió todo esto (Davidvet, 19-ago).
 */
const PAUSA_TRAS_PLANTILLA_MIN = 10

/**
 * Cada cuánto se refresca el "escribiendo…" durante una espera larga. El
 * indicador de Meta dura 25 s; 20 deja margen para la latencia de la llamada.
 */
const ESCRIBIENDO_MS = 20000

/**
 * `thinking: adaptive` y `output_config.effort` son de la familia Claude 5
 * (y Opus/Sonnet 4.6+). **Haiku 4.5 rechaza los dos con un 400**, y la pantalla
 * ofrece Haiku como la opción barata — que es justo la que uno prueba primero.
 * Mandarlos siempre dejaba al agente mudo: recibía el mensaje, fallaba al
 * llamar a Claude y la veterinaria no veía respuesta ninguna.
 *
 * Se decide por modelo, no por una lista de modelos "malos": así un modelo
 * nuevo de la familia 5 funciona sin tocar esto.
 */
function razonamientoPara(modelo, effort) {
  const familia5 = /^claude-(opus|sonnet|fable|mythos)-5\b/.test(modelo)
  const cuatroSeis = /^claude-(opus|sonnet)-4-(6|7|8)\b/.test(modelo)
  if (!familia5 && !cuatroSeis) return {}
  return { thinking: { type: 'adaptive' }, output_config: { effort } }
}

let cliente = null
function anthropic() {
  if (!cliente) {
    const apiKey = process.env.CLAUDE_KEY
    if (!apiKey) throw new Error('CLAUDE_KEY no configurada en el backend')
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}

// ─────────────────────────────────────────────────────────────────────────────
// Herramienta: registrar la solicitud
// ─────────────────────────────────────────────────────────────────────────────
// Es la ÚNICA escritura del agente sobre la operación, y no confirma nada: deja
// la solicitud pendiente para que decida un humano.

const HERRAMIENTAS = [{
  name: 'enviar_enlace_registro',
  description:
    'Consigue el enlace con el que la veterinaria registra ella misma el servicio. ' +
    'Úsala en cuanto quede claro que quieren una recogida, ANTES de ponerte a pedir ' +
    'datos uno por uno: por el enlace la vet elige el plan viendo los precios y la ' +
    'solicitud llega completa.\n\n' +
    'Tú NO sabes si el número está registrado como aliado — lo comprueba el sistema y ' +
    'te lo dice en la respuesta:\n' +
    '- `PERSONAL`: la clínica ya es aliada. El enlace es SUYO y queda atado a ella.\n' +
    '- `AFILIACION`: el número no está registrado. **Pega igualmente el enlace** — es el ' +
    'de afiliación — y explícale que coordinación la revisa. Y ADEMÁS ofrécele tomarle ' +
    'los datos de la recogida por aquí para no hacerla esperar. Las dos cosas en el ' +
    'mismo mensaje: sin el enlace no puede afiliarse nunca.\n' +
    '- `ESCALAR`: algo no cuadra con esa clínica; pásalo a coordinación sin mandar nada.\n\n' +
    '⚠️ Copia el enlace EXACTAMENTE como te llega, carácter por carácter. Nunca lo ' +
    'reconstruyas de memoria ni te inventes uno: un enlace mal copiado no abre, y el ' +
    'personal lleva la credencial de esa veterinaria.\n' +
    '⚠️ El enlace va DENTRO del mismo mensaje en que lo anuncias. Nunca escribas ' +
    '"te envío el enlace" o "ya te lo mando" sin pegarlo ahí mismo: no hay un segundo ' +
    'mensaje: si no lo pegas, la veterinaria se queda esperando algo que no va a llegar.',
  input_schema: { type: 'object', properties: {}, required: [] },
}, {
  name: 'registrar_solicitud',
  description:
    'Registra una solicitud de recogida para que coordinación la revise y confirme.\n\n' +
    '⚠️ Llámala SOLO cuando tengas TODOS los datos obligatorios y se los hayas repetido a ' +
    'la veterinaria para que los confirme. Por el enlace de registro el sistema obliga a ' +
    'elegir plan y a llenarlo todo; por chat no hay quien obligue, y lo normal es que se ' +
    'olvide el plan, el peso, la especie o el teléfono. Ese hueco lo tapas tú.\n\n' +
    'Si te falta algo, NO la llames: pregunta lo que falte. Si la llamas incompleta te lo ' +
    'devuelve diciendo qué falta — pero es mejor preguntar antes que hacer esperar.\n\n' +
    'No confirma horario ni asignación: después de usarla, dile que coordinación confirma ' +
    'la hora directamente.\n\n' +
    'EXCEPCIÓN DESAMPARADO: en ese plan la mascota está abandonada en la clínica y NO hay ' +
    'familia dueña. No pidas nombre ni WhatsApp de la familia —deja los dos campos vacíos— y ' +
    'a cambio pregunta si quieren la prioridad de 24 h, que es un cobro aparte.',
  input_schema: {
    type: 'object',
    properties: {
      cliente_nombre:   { type: 'string', description: 'SOLO el NOMBRE de pila de quien responde por la mascota. El apellido va aparte. No metas aquí el nombre de la veterinaria ni el de quien escribe: eso va en `veterinaria` y en `notas`. En un DESAMPARADO déjalo vacío: la mascota está abandonada y el servidor pone a la clínica.' },
      cliente_apellido: { type: 'string', description: 'Apellido, SOLO si te dan nombre y apellido por separado ("Marta Gómez" → nombre "Marta", apellido "Gómez"). Si solo dicen "la familia Ruiz", eso va entero en `cliente_nombre` y este campo se deja vacío: los dos se concatenan al crear el cliente y repetirlo produce "Familia Ruiz Ruiz".' },
      cliente_whatsapp: { type: 'string', description: 'WhatsApp de la FAMILIA, solo dígitos con indicativo. Ej: 573001234567. Es a ese número al que se le mandan las fotos y el memorial: no pongas el de la clínica. En un DESAMPARADO déjalo vacío: no hay familia.' },
      prioridad:        { type: 'boolean', description: 'Solo para el plan DESAMPARADO: ¿pagan la prioridad para que se recoja en las primeras 24 horas? Pregúntalo, porque su recogida normal va de 24 a 48 h. En los demás planes no lo mandes.' },
      mascota_nombre:   { type: 'string', description: 'Nombre de la mascota.' },
      mascota_especie:  { type: 'string', description: 'Perro, Gato, Conejo, Ave, Hámster, Cobayo, Reptil, Pez u Otro. Se valida contra el catálogo: la especie decide si la tarifa es por peso o única.' },
      mascota_peso_kg:  { type: 'number', description: 'Peso aproximado en kilogramos. Si no lo saben exacto, pide un aproximado — de esto sale el precio, no lo inventes ni lo dejes en blanco.' },
      plan:             { type: 'string', description: 'Plan elegido. Se valida contra el catálogo; si es ambiguo (p. ej. "Exclusivo", que tiene cuatro variantes) te lo devuelve con las opciones para que preguntes cuál.' },
      recogida_en:      { type: 'string', enum: ['veterinaria', 'domicilio'], description: 'Dónde se recoge: en la clínica ("veterinaria") o en la casa de la familia ("domicilio"). De esto depende la dirección a la que va el técnico.' },
      quien_paga:       { type: 'string', enum: ['veterinaria', 'propietario'], description: 'Quién paga el servicio. Pregúntalo SIEMPRE, no lo asumas: cambia toda la operación posterior.' },
      refrigeracion:    { type: 'boolean', description: '¿La clínica tiene posibilidad de refrigeración? Determina cuánto puede esperar el cuerpo.' },
      murio_de_cancer:  { type: 'boolean', description: '¿La mascota falleció por cáncer? Si fue así hay que notificarlo.' },
      mascota_sexo:     { type: 'string', enum: ['macho', 'hembra'], description: 'Sexo de la mascota. Se usa al escribirle a la familia y en el certificado; si te lo dicen de pasada ("la gata", "el perrito"), tómalo de ahí sin volver a preguntar.' },
      mascota_raza:     { type: 'string', description: 'Raza, si la mencionan. No la deduzcas.' },
      direccion:        { type: 'string', description: 'Dirección exacta de la recogida. OBLIGATORIA si la recogida es a domicilio.' },
      ciudad:           { type: 'string', description: 'Ciudad o municipio de la recogida. OBLIGATORIA a domicilio: de ella sale el cobro del transporte, y si falta el sistema asume Bogotá y cobra $0. Pregúntala aunque parezca obvia.' },
      barrio:           { type: 'string', description: 'Barrio o punto de referencia.' },
      localidad:        { type: 'string', description: 'Localidad, si es en Bogotá y la mencionan.' },
      hora_aproximada:  { type: 'string', description: 'Hora o franja que pidan ("hoy antes de las 6", "mañana temprano"). No la prometas tú: solo recoge lo que ellos digan.' },
      veterinaria:      { type: 'string', description: 'Nombre de la clínica desde la que escriben, tal como lo digan.' },
      notas:            { type: 'string', description: 'Indicaciones especiales, horarios preferidos, cualquier detalle relevante.' },
    },
    // `cliente_nombre` y `cliente_whatsapp` NO van aquí: en un DESAMPARADO no
    // hay familia y exigirlos en el esquema obligaría al modelo a inventárselos.
    // La compuerta real es el servidor, que ya sabe el plan y devuelve la lista
    // exacta de lo que falta según cuál sea.
    required: [
      'mascota_nombre', 'mascota_especie',
      'mascota_peso_kg', 'plan', 'recogida_en', 'quien_paga', 'refrigeracion',
      'murio_de_cancer',
    ],
  },
}]

/**
 * Las herramientas se arman por ejecución porque una de ellas depende del
 * catálogo de etiquetas, que es una tabla editable. Si se cablearan aquí, un
 * cambio de categorías obligaría a desplegar.
 */
async function construirHerramientas() {
  // `solo_sistema` fuera: esas las pone el servidor (FALLO_AGENTE cuando el
  // agente revienta, AUDIO_O_IMAGEN cuando llega algo que no puede leer). Si
  // entraran en el enum, el modelo podría marcar "el agente no pudo responder"
  // en una conversación que está atendiendo bien, y coordinación dejaría de
  // creerle a la única señal que avisa de los fallos mudos. Ver migración 093.
  const { rows: etiquetas } = await pool.query(
    `SELECT clave, nombre, descripcion FROM public.whatsapp_etiquetas
      WHERE activo AND NOT solo_sistema ORDER BY orden, id`
  )
  // Los interactivos (migración 100) también salen de un catálogo editable: la
  // `descripcion` de cada uno es lo que el modelo lee para saber cuándo usarlo.
  // Añadir un menú nuevo NO exige tocar el motor ni desplegar.
  const interactivos = await catalogoParaAgente().catch(() => [])
  const extra = []
  if (interactivos.length) {
    extra.push({
      name: 'enviar_interactivo',
      description:
        'Manda un mensaje con BOTONES, un MENÚ o un BOTÓN DE ENLACE, en vez de escribirlo. ' +
        'A la veterinaria le sale algo que se toca: es más rápido para ella y evita que ' +
        'conteste algo que no esperabas.\n\n' +
        '⚠️ El mensaje se envía TAL CUAL está configurado, así que no repitas su contenido en ' +
        'tu respuesta ni anuncies que lo vas a mandar. Y no lo uses para cualquier cosa: solo ' +
        'cuando encaje con lo que estás preguntando.\n\n' +
        'Disponibles:\n'
        + interactivos.map(i => `- ${i.clave} (${i.nombre}): ${i.descripcion || ''}`).join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          clave: {
            type: 'string', enum: interactivos.map(i => i.clave),
            description: 'Cuál de los de arriba encaja con lo que necesitas ahora.',
          },
        },
        required: ['clave'],
      },
    })
  }

  // Los materiales (migración 101) son el mismo catálogo editable: brochure,
  // tarifario, instructivos. Si no hay ninguno cargado, la herramienta NO se
  // ofrece — un enum vacío es un 400 de la API, y prometer un archivo que no
  // existe es peor que decir que no se tiene.
  const materiales = await catalogoDeMateriales().catch(() => [])
  if (materiales.length) {
    extra.push({
      name: 'enviar_material',
      description:
        'Manda un ARCHIVO del catálogo: el brochure, el tarifario o lo que haya cargado ' +
        'coordinación. Úsalo cuando te pidan material para enseñárselo a una familia, o ' +
        'cuando un documento explique mejor que un párrafo lo que te están preguntando.\n\n' +
        '⚠️ Solo puedes mandar los de esta lista. Si te piden otra cosa, no la inventes ni ' +
        'prometas mandarla: dilo y pásalo a coordinación.\n\n' +
        'Disponibles:\n'
        + materiales.map(m => `- ${m.clave} (${m.nombre}): ${m.descripcion || ''}`).join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          clave: {
            type: 'string', enum: materiales.map(m => m.clave),
            description: 'Cuál de los de arriba es el que te piden.',
          },
        },
        required: ['clave'],
      },
    })
  }

  if (!etiquetas.length) return [...HERRAMIENTAS, ...extra]

  return [...HERRAMIENTAS, ...extra, {
    name: 'clasificar_conversacion',
    description:
      'Etiqueta esta conversación para que coordinación sepa qué necesita atención. ' +
      'Úsala en cuanto entiendas de qué va el mensaje, y SIEMPRE que escales algo a una ' +
      'persona: la etiqueta es lo único que hace visible la conversación en el tablero. ' +
      'No la repitas si ya pusiste esa misma etiqueta antes en la conversación.\n\n' +
      'Etiquetas disponibles:\n'
      + etiquetas.map(e => `- ${e.clave} (${e.nombre}): ${e.descripcion || ''}`).join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        etiqueta: { type: 'string', enum: etiquetas.map(e => e.clave), description: 'La que mejor describa lo que necesita esta conversación.' },
        motivo:   { type: 'string', description: 'Una línea de contexto para el coordinador. Ej: "espera al técnico, cierran a las 7".' },
      },
      required: ['etiqueta'],
    },
  }]
}

/**
 * Decide y devuelve el enlace. **Quién es la veterinaria lo dice el número, no
 * el agente.** Si el enlace personal se entregara por el nombre que alguien
 * escribe en el chat, cualquiera podría pedir el de otra clínica — y ese enlace
 * es su credencial: con él se registran servicios a su nombre y su comisión.
 */
async function enviarEnlaceRegistro({ contacto }) {
  const num = String(contacto || '').replace(/\D/g, '')
  const { rows: [conv] } = num
    ? await pool.query(
        `SELECT aliado_id FROM public.v_whatsapp_conversaciones WHERE contacto = $1`, [num]
      )
    : { rows: [] }

  if (!conv?.aliado_id) {
    log(MOD, `enlace de AFILIACION a ${contacto} (número no registrado)`)
    return {
      ok: true, tipo: 'AFILIACION', enlace: enlaceAfiliacion(),
      nota: 'Este número no está registrado como aliado. El enlace es para afiliarse; coordinación revisa y aprueba. Ofrécele tomarle los datos de la recogida por chat mientras tanto.',
    }
  }

  const datos = await enlacePersonalAliado(conv.aliado_id)
  if (!datos) {
    // Existe el aliado pero no está activo (desactivado o pendiente de
    // validación). Activarlo es decisión de coordinación, no del agente.
    log(MOD, `enlace NO entregado a ${contacto}: aliado ${conv.aliado_id} inactivo`)
    return { ok: true, tipo: 'ESCALAR', nota: 'La clínica figura en el sistema pero no está habilitada. No mandes ningún enlace: pásalo a coordinación.' }
  }

  log(MOD, `enlace PERSONAL a ${contacto} (${datos.nombre})`)
  return { ok: true, tipo: 'PERSONAL', veterinaria: datos.nombre, enlace: datos.enlace }
}

async function clasificarConversacion({ entrada, contacto }) {
  // En el panel de prueba no hay conversación real que etiquetar.
  if (!/^\d+$/.test(String(contacto || ''))) {
    return { ok: true, mensaje: `(prueba) se habría etiquetado como ${entrada.etiqueta}` }
  }
  const r = await etiquetar({
    contacto, clave: entrada.etiqueta, origen: 'AGENTE',
    motivo: entrada.motivo ? String(entrada.motivo).slice(0, 300) : null,
  })
  if (!r.body?.ok) return { ok: false, error: r.body?.error || 'No se pudo etiquetar' }
  log(MOD, `conversación ${contacto} etiquetada ${entrada.etiqueta} por el agente`)
  return { ok: true, mensaje: 'Etiquetada. Sigue atendiendo con normalidad.' }
}

/** Quita tildes y mayúsculas para poder comparar lo que escriben con el catálogo. */
const sinTildes = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * La especie que dijeron, contra el catálogo real.
 *
 * No es un capricho de limpieza: la especie decide si la tarifa es POR PESO o
 * ÚNICA (`especies.tarifa_peso`), así que guardarla como texto suelto —que es lo
 * que se hacía— deja el precio en manos de quien convierta la solicitud.
 */
async function resolverEspecie(dicho) {
  const q = sinTildes(dicho)
  if (!q) return { falta: true }

  const { rows } = await pool.query(`SELECT id, nombre FROM public.especies`)
  const norm = rows.map(r => ({ ...r, n: sinTildes(r.nombre) }))

  const exacta = norm.find(r => r.n === q)
  if (exacta) return { id: exacta.id, nombre: exacta.nombre }

  // "gata", "gatico", "perrita", "canino"… Se compara por la raíz porque la
  // gente escribe la especie en femenino y en diminutivo casi siempre.
  const SINONIMOS = {
    gato: ['gat', 'felin', 'michi'], perro: ['perr', 'canin', 'cachorr'],
    conejo: ['conej'], ave: ['ave', 'pajar', 'loro', 'periquit'],
    hamster: ['hamst'], cobayo: ['cobay', 'curi', 'cuy'],
    reptil: ['reptil', 'iguan', 'tortug', 'serpient'], pez: ['pez', 'pec'],
  }
  for (const r of norm) {
    const raices = SINONIMOS[r.n] || [r.n.slice(0, 4)]
    if (raices.some(raiz => q.startsWith(raiz))) return { id: r.id, nombre: r.nombre }
  }
  return { desconocida: true, opciones: rows.map(r => r.nombre) }
}

/**
 * El plan que dijeron, contra el catálogo de planes ACTIVOS.
 *
 * Devuelve las opciones cuando es ambiguo en vez de elegir por su cuenta:
 * "Exclusivo" son cuatro planes con precios distintos, y adivinar uno sería
 * inventar el precio del servicio.
 */
// Exportada para poder comprobarla de verdad: al armar el menú de planes se
// verificó con un emparejamiento escrito aparte y daba ambiguos donde no los
// hay, porque no replicaba la coincidencia exacta. Comprobar con la función
// real, no con una copia.
export async function resolverPlan(dicho) {
  const q = sinTildes(dicho).replace(/^plan\s+/, '').replace(/\s+plan$/, '')
  if (!q) return { falta: true }

  const { rows } = await pool.query(
    `SELECT id, nombre, codigo FROM public.planes WHERE activo ORDER BY nombre`
  )
  const norm = rows.map(r => ({ ...r, n: sinTildes(r.nombre), c: sinTildes(r.codigo) }))

  const exacto = norm.find(r => r.n === q || r.c === q || r.c === q.replace(/[\s-]+/g, '_'))
  if (exacto) return { id: exacto.id, nombre: exacto.nombre, codigo: exacto.codigo }

  const candidatos = norm.filter(r => r.n.includes(q) || q.includes(r.n))
  if (candidatos.length === 1) return { id: candidatos[0].id, nombre: candidatos[0].nombre, codigo: candidatos[0].codigo }
  if (candidatos.length > 1) {
    return { ambiguo: true, opciones: candidatos.map(r => r.nombre) }
  }
  return { desconocido: true, opciones: rows.map(r => r.nombre) }
}

async function registrarSolicitud({ entrada, agente, contacto }) {
  // El aliado NO se lo preguntamos al agente ni se lo dejamos elegir: se deriva
  // del número desde el que escriben, que la bandeja ya cruza contra `aliados`.
  // Así el agente sigue aislado (no consulta la operación) y la solicitud llega
  // con vet asociada. Sin esto el Kanban convierte con `aliado_origen_id` NULL
  // y `canal_entrada='DIRECTO'` (Kanban.jsx:865-867): la veterinaria pierde su
  // comisión en silencio, que es justo lo contrario de para qué existe la línea.
  //
  // Va lo PRIMERO porque la validación de abajo lo necesita: con recogida en la
  // clínica, la ciudad la aporta el aliado y no hay que pedirla.
  const { rows: [conv] } = await pool.query(
    `SELECT aliado_id, aliado_nombre FROM public.v_whatsapp_conversaciones WHERE contacto = $1`,
    [String(contacto || '').replace(/\D/g, '')]
  )

  // El plan se resuelve ANTES que nada porque decide qué es obligatorio: en un
  // DESAMPARADO no hay familia a la que pedirle nombre ni WhatsApp. Ojo con el
  // orden — moverlo abajo lo dejaría usándose antes de declararse (mismo patrón
  // de TDZ que ya mordió con la derivación del aliado).
  const plan = await resolverPlan(entrada.plan)

  // 🐾 DESAMPARADO — el plan de apoyo a la clínica cuando le dejan una mascota
  // abandonada. NO tiene familia dueña: exigirle nombre y WhatsApp de la familia
  // haría que la herramienta rechazara para siempre el caso más frecuente de
  // esta línea (78 servicios en los últimos 70 días). Como `cliente_nombre` y
  // `cliente_whatsapp` son NOT NULL, se rellenan con la clínica —que es lo que
  // coordinación viene haciendo a mano: de los 78, el "cliente" es la propia
  // veterinaria en todos salvo un puñado.
  const esDesamparado = plan.codigo === 'DESAMPARADO'

  // ── La compuerta que el enlace de registro tiene y el chat no ──
  // Por el portal el sistema OBLIGA a elegir plan y a llenarlo todo. Por chat no
  // hay quien obligue, y lo que pasa de verdad es que se olvida el plan, el
  // peso, la especie o el teléfono (David, 12-ago). Antes esto se registraba
  // igual y el hueco aparecía después, en coordinación. Ahora se devuelve al
  // agente con la lista exacta de lo que falta para que lo pregunte.
  const falta = []
  const telDicho = String(entrada.cliente_whatsapp || '').replace(/\D/g, '')
  const contactoDigitos = String(contacto || '').replace(/\D/g, '')
  // Sin familia, el "cliente" es la clínica y su WhatsApp es el número desde el
  // que están escribiendo. Nunca queda vacío: las dos columnas son NOT NULL.
  const tel = esDesamparado ? (telDicho.length >= 10 ? telDicho : contactoDigitos) : telDicho
  const nombreCliente = esDesamparado
    ? (String(entrada.cliente_nombre || '').trim()
       || conv?.aliado_nombre
       || String(entrada.veterinaria || '').trim()
       || 'VETERINARIA')
    : String(entrada.cliente_nombre || '').trim()

  if (!esDesamparado && !nombreCliente) falta.push('el nombre de la familia dueña de la mascota')
  if (!esDesamparado && tel.length < 10) falta.push('el WhatsApp de la familia (con indicativo, solo dígitos)')
  if (!String(entrada.mascota_nombre || '').trim()) falta.push('el nombre de la mascota')

  const peso = Number(entrada.mascota_peso_kg)
  if (!Number.isFinite(peso) || peso <= 0 || peso > 200) {
    falta.push('el peso aproximado en kilos (de ahí sale el precio; pide un aproximado si no lo tienen exacto)')
  }
  if (!['veterinaria', 'domicilio'].includes(entrada.recogida_en)) {
    falta.push('dónde se recoge: en la clínica o en la casa de la familia')
  }
  if (entrada.recogida_en === 'domicilio' && !String(entrada.direccion || '').trim()) {
    falta.push('la dirección exacta de la casa, con punto de referencia')
  }

  // 🩸 CIUDAD — bug de dinero, silencioso. Al convertir, `Kanban.jsx` hace
  // `convForm.ciudad || 'Bogotá'`: sin ciudad la recogida se da por bogotana y
  // **el transporte se cobra en $0**. Es el mismo agujero de
  // `bug_transporte_ciudad_sin_tarifa`, ahora por la puerta del agente.
  //
  // Recogiendo en la clínica la ciudad sale del aliado, así que solo hace falta
  // preguntarla cuando no hay aliado que la aporte.
  // Al convertir, el Kanban arma el nombre del cliente como `nombre + apellido`.
  // Si vienen "Familia Ruiz" y "Ruiz" —que es lo que sale cuando la vet solo
  // dice el apellido— el cliente queda como "Familia Ruiz Ruiz". Se descarta el
  // apellido cuando ya está contenido en el nombre.
  const nombrePila = nombreCliente
  const apellidoDicho = esDesamparado ? '' : String(entrada.cliente_apellido || '').trim()
  const apellido = apellidoDicho
    && !sinTildes(nombrePila).includes(sinTildes(apellidoDicho))
    ? apellidoDicho.slice(0, 120)
    : null

  const esDomicilio = entrada.recogida_en === 'domicilio'
  const ciudadLaPoneElAliado = !esDomicilio && !!conv?.aliado_id
  const ciudad = String(entrada.ciudad || '').trim().slice(0, 120) || null
  if (!ciudadLaPoneElAliado && !ciudad) {
    falta.push('la ciudad o municipio de la recogida (de ahí sale el cobro del transporte)')
  }
  if (!['veterinaria', 'propietario'].includes(entrada.quien_paga)) {
    falta.push('quién paga: la clínica o el propietario')
  }
  if (typeof entrada.refrigeracion !== 'boolean') falta.push('si la clínica tiene posibilidad de refrigeración')
  if (typeof entrada.murio_de_cancer !== 'boolean') falta.push('si la mascota falleció por cáncer')

  const especie = await resolverEspecie(entrada.mascota_especie)
  if (especie.falta) falta.push('la especie de la mascota')
  else if (especie.desconocida) falta.push(`la especie (no reconocí "${entrada.mascota_especie}"; las válidas son: ${especie.opciones.join(', ')})`)

  if (plan.falta) {
    falta.push('el PLAN que eligieron — por chat casi nunca lo dicen y sin él no se puede cotizar ni procesar')
  } else if (plan.ambiguo) {
    falta.push(`cuál de estos planes exactamente: ${plan.opciones.join(' / ')}`)
  } else if (plan.desconocido) {
    falta.push(`el plan (no reconocí "${entrada.plan}"; los activos son: ${plan.opciones.join(', ')})`)
  }

  if (falta.length) {
    log(MOD, `solicitud incompleta de ${contacto} — falta: ${falta.join(' · ')}`)
    return {
      ok: false,
      error: 'Todavía no se puede registrar: falta información.',
      falta,
      instruccion: 'Pregúntale a la veterinaria SOLO lo que falta, en un mensaje corto y '
        + 'natural, sin repetir lo que ya te dio. Cuando lo tengas, repítele el resumen '
        + 'completo para que lo confirme y vuelve a llamar esta herramienta.',
    }
  }

  // `origen` se queda en ALIADO — la solicitud viene de una veterinaria. Meter
  // un valor nuevo rompería el aviso a coordinación y, al convertir, la
  // comisión del aliado. El canal va en `agente_id`. Ver migración 088.
  // Plan y especie van a SUS columnas (`plan_id`, `especie_id`), no como texto
  // suelto en las notas: así la conversión del Kanban los toma resueltos y nadie
  // tiene que releer un párrafo y volver a teclearlos. La especie además decide
  // si la tarifa es por peso o única.
  const { rows } = await pool.query(
    `INSERT INTO public.solicitudes_servicio
       (cliente_nombre, cliente_apellido, cliente_whatsapp,
        mascota_nombre, mascota_peso_kg, mascota_sexo, mascota_raza,
        especie_id, plan_id,
        ciudad, localidad, barrio, direccion, hora_aproximada,
        cliente_ciudad, cliente_barrio, cliente_direccion,
        notas_cliente, origen, estado, agente_id, aliado_id,
        aliado_nombre_otro, tipo_recogida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             'ALIADO','PENDIENTE',$19,$20,$21,$22)
     RETURNING id`,
    [
      nombreCliente.slice(0, 120),
      apellido,
      tel.slice(0, 25),
      String(entrada.mascota_nombre).slice(0, 120),
      peso,
      ['macho', 'hembra'].includes(entrada.mascota_sexo) ? entrada.mascota_sexo : null,
      entrada.mascota_raza ? String(entrada.mascota_raza).slice(0, 120) : null,
      especie.id,
      plan.id,
      ciudad,
      entrada.localidad ? String(entrada.localidad).slice(0, 120) : null,
      entrada.barrio ? String(entrada.barrio).slice(0, 120) : null,
      entrada.direccion ? String(entrada.direccion).slice(0, 250) : null,
      entrada.hora_aproximada ? String(entrada.hora_aproximada).slice(0, 120) : null,
      // Los `cliente_*` son los datos de la FAMILIA, y solo se conocen cuando la
      // recogida es en su casa. Recogiendo en la clínica, esa dirección es la de
      // la veterinaria: copiarla al cliente le inventaría un domicilio.
      esDomicilio ? ciudad : null,
      esDomicilio && entrada.barrio ? String(entrada.barrio).slice(0, 120) : null,
      esDomicilio && entrada.direccion ? String(entrada.direccion).slice(0, 250) : null,
      [
        // El Desamparado va explícito arriba del todo: cambia el tiempo de
        // recogida (24-48 h, no 2-3 h) y no comisiona a la vet. Que el
        // coordinador lo lea en la primera línea, no deducido del plan.
        esDesamparado
          ? (entrada.prioridad
              ? '🐾 DESAMPARADO CON PRIORIDAD PAGADA — recoger dentro de las primeras 24 h. Recargo: $16.000 (o $20.000 si cae domingo o festivo).'
              : '🐾 DESAMPARADO — recogida de 24 a 48 h, se acomoda en la ruta. Sin prioridad pagada.')
          : null,
        esDesamparado ? 'Mascota abandonada en la clínica: no hay familia dueña. El "cliente" es la propia veterinaria.' : null,
        `Paga: ${entrada.quien_paga === 'veterinaria' ? 'la veterinaria' : 'el propietario'}.`,
        `Refrigeración en la clínica: ${entrada.refrigeracion ? 'SÍ' : 'NO'}.`,
        entrada.murio_de_cancer ? '⚠️ Falleció por CÁNCER — hay que notificarlo.' : 'No falleció por cáncer.',
        entrada.notas || null,
        `Tomada por el agente de WhatsApp desde ${contacto} (la vet no usó el enlace de registro).`,
        conv?.aliado_id ? null : 'Este número NO está asociado a ninguna veterinaria en el sistema: verificar la vet antes de convertir, o la comisión se pierde.',
      ].filter(Boolean).join('\n').slice(0, 2000),
      agente.id,
      conv?.aliado_id || null,
      // Solo si el número no resolvió: con `aliado_id` la vet ya está
      // identificada y el nombre suelto duplicaría la nota en el Kanban.
      !conv?.aliado_id && entrada.veterinaria ? String(entrada.veterinaria).slice(0, 160) : null,
      entrada.recogida_en === 'veterinaria' ? 'veterinaria' : 'domicilio',
    ]
  )
  log(MOD, `solicitud ${rows[0].id} creada por el agente desde ${contacto}`
    + ` — ${plan.nombre}, ${especie.nombre} ${peso}kg`
    + (conv?.aliado_id ? ` (aliado ${conv.aliado_id})` : ' — SIN aliado asociado'))
  return {
    ok: true,
    registrado: { plan: plan.nombre, especie: especie.nombre, peso_kg: peso },
    mensaje: 'Solicitud registrada. Coordinación la revisa y confirma la hora. '
      + 'Confírmaselo a la veterinaria nombrando el plan y la mascota, para que vea que quedó bien.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// El contexto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arma el prefijo estable: instrucciones + base de conocimiento.
 * Va marcado con `cache_control` porque es idéntico en cada mensaje de cada
 * conversación — cachearlo es lo que hace que el costo por respuesta sea bajo.
 * Por eso mismo NADA volátil (fecha, nombre del contacto) puede entrar aquí:
 * cambiaría el prefijo y anularía la caché.
 */
export async function construirSistema(agente) {
  const { rows: piezas } = await pool.query(
    `SELECT tipo, titulo, texto, archivo, mime
       FROM public.agente_wa_conocimiento
      WHERE agente_id = $1 AND activo
      ORDER BY orden, id`,
    [agente.id]
  )

  // Nunca un bloque vacío: la API los rechaza con un 400 que habla de
  // "content blocks" y no menciona al agente por ningún lado. Si alguien trae
  // una fila incompleta, que el agente responda regular — no que reviente.
  const bloques = []
  if (String(agente.instrucciones || '').trim()) {
    bloques.push({ type: 'text', text: agente.instrucciones })
  }

  // ── Reglas aprobadas (migración 099) ──
  // Salen de corregir respuestas concretas en el chat, pero NINGUNA llega aquí
  // sola: coordinación las asciende una por una. Van DESPUÉS del contexto y
  // marcadas como correcciones para que pesen sobre él — son, literalmente, "lo
  // que hiciste mal la última vez".
  const { rows: reglas } = await pool.query(
    `SELECT texto FROM public.agente_wa_reglas
      WHERE agente_id = $1 AND activo ORDER BY orden, id`,
    [agente.id]
  )
  if (reglas.length) {
    bloques.push({
      type: 'text',
      text: '# Correcciones de coordinación\n\n'
        + 'Cada una viene de una respuesta tuya que salió mal y que una persona del equipo '
        + 'corrigió. Pesan por encima de lo anterior: si algo aquí contradice al resto, manda '
        + 'esto.\n\n'
        + reglas.map((r, i) => `${i + 1}. ${r.texto}`).join('\n'),
    })
  }

  const textos = piezas.filter(p => p.tipo !== 'IMAGEN' && p.texto)
  if (textos.length) {
    bloques.push({
      type: 'text',
      text: '# Base de conocimiento\n\n'
        + 'Responde únicamente con lo que esté aquí. Si algo no aparece, dilo y ofrece '
        + 'pasar la conversación a una persona del equipo.\n\n'
        + textos.map(p => `## ${p.titulo}\n\n${p.texto}`).join('\n\n---\n\n'),
    })
  }

  // Nota operativa, no de negocio: va aquí (dentro del prefijo cacheado) y no en
  // el contexto editable, porque es del motor y no algo que David deba mantener.
  bloques.push({
    type: 'text',
    text: 'UN SOLO MENSAJE. Todo lo que escribas en este turno le llega a la veterinaria '
      + 'junto, como un único mensaje de WhatsApp — también lo que escribas ANTES de usar '
      + 'una herramienta. Eso no es un borrador ni un pensamiento en voz alta: ella lo lee. '
      + 'Así que redacta tu respuesta UNA sola vez: usa primero las herramientas que '
      + 'necesites y escribe después, con el resultado en la mano. Y si ya habías escrito '
      + 'algo antes de llamarlas, en la vuelta siguiente añade solo lo que falte en vez de '
      + 'volver a decirlo — un mensaje que repite lo mismo dos veces se lee como un error '
      + 'del sistema.\n\n'
      + 'Cuando necesites más de una herramienta, pídelas JUNTAS en la misma '
      + 'respuesta en vez de una por turno. Cada turno extra vuelve a procesar toda '
      + 'la conversación desde el principio, así que agruparlas es más rápido para '
      + 'la veterinaria que está esperando.\n\n'
      + 'En el historial verás mensajes tuyos que empiezan por "[coordinación]". Esos '
      + 'NO los escribiste tú: los escribió una persona del equipo por esta misma '
      + 'línea. Trátalos como lo que son —lo que el equipo ya le dijo a la clínica— y '
      + 'nunca los contradigas ni los repitas: si coordinación ya resolvió algo, das '
      + 'eso por bueno.\n\n'
      + 'La veterinaria suele escribir en varios mensajes cortos seguidos. Te llegan '
      + 'todos juntos: léelos como un solo mensaje y responde UNA vez a todo, no una '
      + 'vez por línea.\n\n'
      // Va aquí, en el bloque del motor, y no en el contexto editable: sin una
      // línea que lo pida, el modelo dejó de usar la herramienta —12 respuestas
      // seguidas sin una sola etiqueta— y nadie se enteró, porque no etiquetar no
      // se le nota a la veterinaria. Es la herramienta más fácil de olvidar
      // precisamente porque no produce nada que ella vea.
      + 'CLASIFICA SIEMPRE. Antes de dar por terminada tu respuesta, usa '
      + '`clasificar_conversacion` con la etiqueta que mejor describa lo que esta '
      + 'conversación necesita. No es opcional ni es solo para cuando escalas: la '
      + 'etiqueta es LO ÚNICO que hace que coordinación vea esta conversación en su '
      + 'tablero, y sin ella, para el equipo, esto no ha pasado. A la veterinaria no '
      + 'le llega nada por etiquetar, así que no la anuncies ni la menciones — y como '
      + 'no le llega nada, tampoco tienes excusa para saltártela.\n\n'
      + 'Pídela JUNTO con las demás herramientas, en la misma respuesta. Una vez por '
      + 'asunto basta: si ya pusiste esa misma etiqueta antes en esta conversación no '
      + 'la repitas, pero si el tema cambia —pedían precios y ahora reclaman por una '
      + 'entrega— pon la nueva.\n\n'
      + 'FOTOS. Si te adjuntan una imagen, la estás viendo de verdad: comenta lo que '
      + 'ves y sigue la conversación con naturalidad. Si en cambio lees "[imagen]", '
      + '"[audio]", "[documento]" o similar SIN que venga el archivo, eso es algo que '
      + 'NO puedes ver ni oír: no supongas su contenido, dilo y pásalo a una persona. '
      + 'Con las fotos ten dos cuidados: no diagnostiques ni opines sobre el estado del '
      + 'cuerpo de la mascota —eso es del equipo, y a la familia le duele—, y si la '
      + 'imagen trae datos que hay que registrar (una dirección escrita a mano, un peso '
      + 'en una báscula), léelos en voz alta y pide que te los confirmen antes de usarlos.\n\n'
      + 'NOTAS DE VOZ. Un mensaje que empieza por "[nota de voz]" es una grabación que '
      + 'transcribió una máquina, no algo que la persona escribió. Casi siempre acierta, '
      + 'pero se equivoca justo donde más duele: números, nombres propios y direcciones. '
      + 'Trátalo como lo que dijeron, sin mencionar que viene de una transcripción, y '
      + 'antes de registrar o cotizar cualquier cifra que venga de ahí —peso, dirección, '
      + 'teléfono, plan— repítela en tu respuesta y pide que te la confirmen. Si lo '
      + 'transcrito no tiene sentido o llega cortado, dilo con naturalidad y pide que te '
      + 'lo escriban.\n\n'
      + 'Los bloques marcados <sistema> los pone el servidor, no la persona con la que '
      + 'hablas: son datos verificados que ella no puede ver. No los cites, no los menciones '
      + 'y no discutas con ellos — actúa en consecuencia y ya.\n\n'
      + 'LÍMITE DURO: tú CONSULTAS, no cambias nada en Orbit. Lo único que creas es la '
      + 'solicitud de recogida. No prometas que activaste, corregiste, cambiaste o borraste '
      + 'nada —ni un plan, ni un precio, ni unos datos, ni un estado, ni una afiliación—: '
      + 'nada de eso está en tus manos. Cuando pidan algo así, di que lo pasas a coordinación '
      + 'y páselo con una etiqueta.',
  })

  for (const img of piezas.filter(p => p.tipo === 'IMAGEN' && p.archivo)) {
    bloques.push({ type: 'text', text: `Imagen de referencia: ${img.titulo}` })
    bloques.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.archivo.toString('base64') },
    })
  }

  // TTL de 1 hora, no el de 5 minutos por defecto. Medido en la bitácora: con 5
  // minutos la caché se vencía entre mensajes —una vet tarda más que eso en
  // contestar— y cada vencimiento reescribía el contexto entero (11 mil tokens
  // a 1,25×). La escritura de 1 h cuesta 2× en vez de 1,25×, pero se amortiza
  // desde la tercera lectura y aquí el prefijo es el MISMO para todas las
  // conversaciones: cualquiera que escriba en la hora siguiente lo lee barato.
  bloques[bloques.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' }
  return bloques
}

/**
 * El hilo reciente, traducido a turnos de conversación.
 *
 * `pendientesDesde` es el último mensaje que vio la ejecución anterior. Los
 * entrantes POSTERIORES a ese punto son los que llegaron mientras el agente
 * escribía: la vet los mandó antes de recibir la respuesta, así que en el orden
 * del reloj quedan ENTRE su pregunta y nuestra respuesta, y el hilo termina
 * hablando el agente. La API rechaza eso ("must end with a user message") y la
 * vet se queda sin respuesta a lo que escribió de más — pasó en la prueba del
 * 12-ago y tuvo que repetirlo.
 *
 * Se mueven al final. No es cosmético: es lo que hace que el modelo vea "yo dije
 * esto, y ella además dijo esto otro" y conteste lo que falta, en vez de repetir
 * lo que ya había dicho.
 */
/**
 * Un interactivo, contado como lo que es: algo que YA se envió.
 *
 * En la bandeja los botones y menús se guardan como `cuerpo` + una marca final
 * `[botón: …]` / `[menú "…": N opciones]`, que es como los PINTA la pantalla.
 * Esa marca entraba tal cual en el historial del modelo, al final del mensaje —
 * justo donde él pondría un cierre— y la aprendió como estilo propio: el 16-ago
 * le mandó a una veterinaria un mensaje de TEXTO que acababa en
 * `[botón: https://orbit.orbitacac.com/#/aliado?c=…]`. Lo vio tal cual, con los
 * corchetes, y el enlace de su clínica crudo dentro.
 *
 * La marca pasa al PRINCIPIO y en pasado. Ahí lee como metadato —igual que
 * `[coordinación]`, que lleva dos semanas sin que la copie— y no como el final
 * de un mensaje que se pueda imitar.
 */
function narrarInteractivo(texto) {
  const t = String(texto || '')
  const corte = t.lastIndexOf('\n[')
  if (corte < 0) return t
  const marca = t.slice(corte + 2).replace(/\]\s*$/, '').trim()
  const cuerpo = t.slice(0, corte).trim()
  return `[le enviaste ${marca} — ya lo recibió] ${cuerpo}`
}

async function construirHistorial(contacto, pendientesDesde = null) {
  const { rows: crudas } = await pool.query(
    `SELECT id, direccion, texto, tipo, enviado_por FROM public.whatsapp_mensajes
      WHERE contacto = $1 AND texto IS NOT NULL AND texto <> ''
      ORDER BY ocurrido_en DESC, id DESC
      LIMIT $2`,
    [contacto, HISTORIAL]
  )

  const ordenadas = crudas.slice().reverse()
  const desde = Number(pendientesDesde) || 0
  const esPendiente = m => desde > 0 && m.direccion === 'IN' && Number(m.id) > desde
  const rows = desde > 0
    ? [...ordenadas.filter(m => !esPendiente(m)), ...ordenadas.filter(esPendiente)]
    : ordenadas

  // Lo último que se leyó, para que la siguiente vuelta sepa qué quedó pendiente.
  const hastaId = ordenadas.length ? Number(ordenadas[ordenadas.length - 1].id) : 0

  // Las fotos que el modelo puede mirar, indexadas por mensaje. Vienen ya
  // limitadas a las últimas: cada imagen son ~1.500 tokens y el historial NO se
  // cachea, así que una foto vieja se vuelve a pagar en CADA turno siguiente.
  const fotos = new Map()
  for (const f of await imagenesRecientes(contacto, MAX_IMAGENES)) {
    fotos.set(Number(f.mensaje_id), {
      type: 'image',
      source: { type: 'base64', media_type: f.mime, data: f.archivo.toString('base64') },
    })
  }

  const mensajes = []
  for (const m of rows) {
    const role = m.direccion === 'IN' ? 'user' : 'assistant'
    // Por la misma línea salen dos voces: el agente y el coordinador. Sin
    // marcarlo, el modelo lee lo que escribió una persona como si lo hubiera
    // dicho él — y da por suyos compromisos que no hizo, o repite lo que
    // coordinación acaba de resolver. El prefijo es la única forma de que
    // distinga, porque la API solo tiene dos roles.
    let texto = role === 'assistant' && m.tipo === 'interactive'
      ? narrarInteractivo(m.texto)
      : m.texto
    if (role === 'assistant' && m.enviado_por) texto = `[coordinación] ${texto}`

    const foto = fotos.get(Number(m.id))
    // Con foto, el turno deja de ser una cadena y pasa a ser bloques. Van
    // imagen primero y pie después: es el orden que recomienda la API y el que
    // lee natural — se mira la foto y luego lo que dijeron de ella.
    const partes = foto
      ? [foto, { type: 'text', text: texto }]
      : texto

    // La API rechaza turnos consecutivos del mismo rol; se fusionan. Con
    // bloques de por medio, fusionar es concatenar listas, no cadenas: sumar
    // una imagen a un string la convertiría en "[object Object]" y el turno se
    // enviaría sin la foto y sin un solo error.
    const ultimo = mensajes[mensajes.length - 1]
    if (ultimo && ultimo.role === role) {
      ultimo.content = [...aBloques(ultimo.content), ...aBloques(partes)]
    } else {
      mensajes.push({ role, content: partes })
    }
  }
  // Tiene que empezar por el usuario.
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift()

  // Y tiene que TERMINAR hablando el usuario. Si acaba en el agente es que no
  // hay nada nuevo que contestar: la vuelta anterior ya respondió todo. Se
  // devuelve vacío para no llamar al modelo — llamarlo devolvería un 400
  // ("does not support assistant message prefill") que además se registraría
  // como un fallo del agente cuando en realidad no había nada que hacer.
  while (mensajes.length && mensajes[mensajes.length - 1].role !== 'user') mensajes.pop()

  return { mensajes, hastaId }
}

/**
 * Lo que el SERVIDOR sabe de quien escribe y el agente no puede averiguar solo.
 *
 * Nació de una prueba real (David, 12-ago): la conversación entera transcurrió
 * sin que el agente ofreciera el enlace de registro, que es **lo primero que
 * debe hacer**. La causa no era el prompt —la instrucción está y es explícita—
 * sino que **el agente no tenía forma de saber si el número estaba registrado**:
 * solo lo descubría si llamaba la herramienta, y no la llamó.
 *
 * Esto NO rompe el aislamiento: el agente sigue sin consultar la operación. Es
 * el servidor quien deriva un único dato del número y se lo pone delante, igual
 * que ya hace con el aliado al registrar una solicitud.
 *
 * Va en el turno del usuario y no en el prefijo del sistema a propósito: el
 * prefijo está cacheado y es idéntico para todas las conversaciones; meter aquí
 * algo que cambia por contacto lo invalidaría entero, en cada mensaje.
 */
async function contextoDeLaConversacion(contacto) {
  const num = String(contacto || '').replace(/\D/g, '')
  if (!num) return null

  const { rows: [c] } = await pool.query(
    `SELECT v.aliado_id, a.nombre, a.activo, a.estado
       FROM public.v_whatsapp_conversaciones v
       LEFT JOIN public.aliados a ON a.id_aliado = v.aliado_id
      WHERE v.contacto = $1`,
    [num]
  )
  if (!c) return null

  if (!c.aliado_id) {
    return 'Este número NO está registrado como veterinaria aliada. En cuanto se hable de '
      + 'una recogida, lo PRIMERO que haces es usar `enviar_enlace_registro`: le llegará el '
      + 'enlace de afiliación. Mándaselo y, en el mismo mensaje, ofrécele tomarle los datos '
      + 'por aquí para que no espere a que coordinación la apruebe.'
  }
  if (!c.activo || c.estado === 'pendiente_validacion') {
    return `Este número figura como "${c.nombre}" pero esa clínica NO está habilitada en el `
      + 'sistema. No le mandes ningún enlace y no le prometas nada: pásalo a coordinación.'
  }
  return `Este número es de la veterinaria aliada "${c.nombre}", ya registrada y habilitada. `
    + 'En cuanto se hable de una recogida, lo PRIMERO que haces es usar '
    + '`enviar_enlace_registro` para pasarle SU enlace, con el que registra el servicio ella '
    + 'misma eligiendo el plan con los precios a la vista.'
}

/** Un turno puede ser texto suelto o una lista de bloques; aquí siempre lista. */
function aBloques(contenido) {
  if (Array.isArray(contenido)) return contenido
  return [{ type: 'text', text: String(contenido) }]
}

/**
 * El texto de un turno, venga como cadena o como bloques. Sin esto, un turno con
 * foto se guardaba en la bitácora como "[object Object]" — que es exactamente el
 * turno que uno querría poder leer al revisar qué entendió el agente.
 */
function textoDe(contenido) {
  if (contenido == null) return null
  if (typeof contenido === 'string') return contenido
  if (!Array.isArray(contenido)) return String(contenido)
  const partes = contenido.filter(b => b?.type === 'text').map(b => b.text)
  const fotos = contenido.filter(b => b?.type === 'image').length
  return [fotos ? `[${fotos} imagen(es)]` : null, ...partes].filter(Boolean).join(' ') || null
}

// ─────────────────────────────────────────────────────────────────────────────
// Responder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide si el agente debe intervenir. Fail-closed en todo:
 * apagado, línea no asignada o tope alcanzado ⇒ no responde y no cuesta nada.
 */
async function agenteParaLinea(phoneNumberId) {
  const { rows } = await pool.query(
    `SELECT id, clave, activo, instrucciones, modelo, effort, max_turnos, phone_number_ids,
            seguimiento_enlace_minutos, espera_ms, espera_max_ms
       FROM public.agente_wa
      WHERE activo AND $1 = ANY(phone_number_ids)
      LIMIT 1`,
    [phoneNumberId]
  )
  return rows[0] || null
}

/**
 * Conversaciones esperando respuesta, por número.
 *
 * ⚠️ Vive en memoria del proceso, y eso impone dos límites que hay que tener
 * presentes:
 *  1. **Un solo proceso.** Si algún día el backend corre con dos réplicas, cada
 *     una tendría su propio mapa y la veterinaria recibiría dos respuestas. Hoy
 *     es un contenedor único (`orbit-backend`); si eso cambia, esto se muda a la
 *     base de datos ANTES.
 *  2. **Un reinicio en mitad de la espera pierde ese turno.** La ventana son
 *     segundos y el mensaje queda SIN LEER en la bandeja —el agente nunca apaga
 *     ese badge—, así que lo ve un humano. Es una red de seguridad real, no una
 *     suposición.
 */
const enEspera = new Map()

/**
 * Punto de entrada desde el webhook. NUNCA lanza: si algo falla, la bandeja
 * sigue funcionando y el coordinador responde a mano — un agente caído no
 * puede tumbar la recepción de mensajes.
 *
 * No responde aquí: acusa recibo y programa. Lo que responde es `atender()`,
 * cuando la veterinaria lleva `ESPERA_MS` sin escribir.
 */
export async function responderSiAplica({ phoneNumberId, contacto, tipo, waMessageId, mensajeId }) {
  try {
    const num = String(contacto || '').replace(/\D/g, '')
    if (!num) return

    // Las dos comprobaciones van ANTES de acusar recibo, y ese orden importa:
    // marcar leído pinta el doble check AZUL en el teléfono de la veterinaria.
    // Si después el agente se callara, ella vería su mensaje leído y sin
    // respuesta — peor que no haberlo marcado. Solo se acusa lo que se va a
    // contestar.
    const agente = await agenteParaLinea(phoneNumberId)
    if (!agente) return

    const laLleva = await laLlevaUnHumano(num)
    if (laLleva) {
      log(MOD, `${num}: ${laLleva} — el agente ni acusa recibo`)
      return
    }

    // Inmediato y sin await: el doble check azul y el "escribiendo…" son lo que
    // convierte la espera en atención. Es cosmético — si falla, da igual.
    acusarLectura({ phoneNumberId, contacto: num, waMessageId }).catch(() => {})

    const p = enEspera.get(num) || { tipos: new Set(), ids: [], ejecutando: false, timer: null }
    p.phoneNumberId = phoneNumberId
    if (waMessageId) p.waMessageId = waMessageId
    if (!p.desde) p.desde = Date.now()
    p.tipos.add(tipo || 'text')
    // Los ids de ESTA tanda: con ellos se sabe qué fotos concretas llegaron y
    // cuáles se pudieron bajar, en vez de preguntar "¿hay alguna foto reciente?"
    // y acertar por casualidad.
    if (mensajeId) p.ids.push(mensajeId)
    enEspera.set(num, p)

    // Si ya está respondiendo, no se programa nada: lo que llegue ahora se
    // atiende en cuanto termine (ver el `finally` de `atender`). Sin esto se
    // solaparían dos ejecuciones sobre la misma conversación.
    if (p.ejecutando) return

    if (p.timer) clearTimeout(p.timer)
    // Los tiempos salen de la fila del agente (migración 099), no del `.env`:
    // ajustarlos era recrear el contenedor. Se guardan en la entrada porque al
    // terminar de responder hay que reprogramar y allí ya no hay agente a mano.
    p.esperaMs    = tiempoDe(agente.espera_ms, ESPERA_MS)
    p.esperaMaxMs = Math.max(p.esperaMs, tiempoDe(agente.espera_max_ms, ESPERA_MAX_MS))
    // El silencio de siempre, pero sin pasarse del techo desde el primer
    // mensaje: quien escribe sin pausas también merece respuesta.
    const espera = Math.max(0, Math.min(p.esperaMs, p.desde + p.esperaMaxMs - Date.now()))
    p.timer = setTimeout(() => { atender(num).catch(() => {}) }, espera)
    // Que un temporizador pendiente no impida al proceso apagarse limpio.
    p.timer.unref?.()
  } catch (e) {
    log(MOD, 'ERROR programando respuesta a', contacto, '—', e.message)
  }
}

/**
 * Sostiene el "escribiendo…" mientras el servidor hace algo lento ANTES de que
 * el agente pueda siquiera empezar: bajar el archivo y, sobre todo, transcribir
 * una nota de voz, que tarda varias veces lo que dura el audio.
 *
 * Sin esto la veterinaria manda una nota de voz y no ve absolutamente nada
 * durante un minuto largo — ni leído, ni escribiendo. El indicador de Meta dura
 * 25 s, así que se refresca en bucle hasta que quien llamó lo suelte.
 *
 * Se aplican las mismas dos compuertas que al responder: si no hay agente en la
 * línea o la conversación la lleva una persona, no se acusa nada — un doble
 * check azul sin respuesta detrás es peor que el silencio.
 *
 * @returns {Promise<() => void>} la función que apaga el latido. Llamarla SIEMPRE.
 */
export async function mantenerEscribiendo({ phoneNumberId, contacto, waMessageId }) {
  const parar = () => {}
  try {
    const num = String(contacto || '').replace(/\D/g, '')
    if (!num || !waMessageId) return parar

    const agente = await agenteParaLinea(phoneNumberId)
    if (!agente) return parar
    if (await laLlevaUnHumano(num)) return parar

    acusarLectura({ phoneNumberId, contacto: num, waMessageId }).catch(() => {})
    const latido = setInterval(() => {
      acusarLectura({ phoneNumberId, contacto: num, waMessageId }).catch(() => {})
    }, ESCRIBIENDO_MS)
    latido.unref?.()
    return () => clearInterval(latido)
  } catch (e) {
    log(MOD, 'no se pudo sostener el escribiendo —', e.message)
    return parar
  }
}

/**
 * Atiende todo lo acumulado de un número. Nunca corre dos veces a la vez para
 * el mismo contacto, y lo que llegue mientras responde se atiende después.
 */
async function atender(num) {
  const p = enEspera.get(num)
  if (!p || p.ejecutando) return

  p.timer = null
  p.ejecutando = true
  // Se toma lo acumulado y se vacía: lo que entre a partir de ahora pertenece
  // a la siguiente vuelta, no a esta — incluido el reloj del techo de espera.
  const tipos = new Set(p.tipos)
  const mensajeIds = p.ids.slice()
  p.tipos.clear()
  p.ids.length = 0
  p.desde = null

  try {
    // `hastaId` es hasta dónde leyó esta vuelta. La siguiente lo usa para saber
    // qué entró mientras respondíamos y ponerlo al final del hilo.
    const hastaId = await responder({
      num, tipos, mensajeIds, pendientesDesde: p.hastaId || null,
      phoneNumberId: p.phoneNumberId, waMessageId: p.waMessageId,
    })
    if (hastaId) p.hastaId = hastaId
  } catch (e) {
    log(MOD, 'ERROR atendiendo', num, '—', e.message)
    await avisarQueQuedoSinRespuesta(num, e.message).catch(() => {})
  } finally {
    p.ejecutando = false
    if (p.tipos.size) {
      // Llegó algo mientras respondíamos. Se vuelve a esperar el silencio: si la
      // vet sigue escribiendo, no la interrumpimos a media frase. Con el mismo
      // techo que en la programación normal.
      const esperaMs    = p.esperaMs    ?? ESPERA_MS
      const esperaMaxMs = p.esperaMaxMs ?? ESPERA_MAX_MS
      const espera = Math.max(0, Math.min(esperaMs, (p.desde || Date.now()) + esperaMaxMs - Date.now()))
      p.timer = setTimeout(() => { atender(num).catch(() => {}) }, espera)
      p.timer.unref?.()
    } else {
      enEspera.delete(num)
    }
  }
}

/** Una respuesta completa a lo que se acumuló de un número. */
async function responder({ num, tipos, mensajeIds = [], phoneNumberId, waMessageId, pendientesDesde = null }) {
  const agente = await agenteParaLinea(phoneNumberId)
  if (!agente) return

  // ── ¿La lleva una persona? ──
  // Se vuelve a preguntar aquí, aunque ya se preguntó al programar: entre una
  // cosa y otra pasan los segundos de espera, que es JUSTO cuando el coordinador
  // ve el mensaje entrar y contesta. Sin esta segunda comprobación, el caso más
  // probable de todos —los dos contestando— se colaría.
  const laTomaron = await laLlevaUnHumano(num)
  if (laTomaron) {
    log(MOD, `${num}: ${laTomaron} mientras esperábamos — el agente se aparta`)
    return
  }

  // ── Lo que el agente no puede leer ──
  // Antes se descartaba con un `return` mudo: la veterinaria mandaba una nota de
  // voz y no pasaba absolutamente nada, ni respuesta ni rastro. Ahora se le
  // contesta y la conversación entra en Novedades.
  //
  // Las FOTOS son la excepción desde la migración 094: el modelo sí las ve, así
  // que no se piden disculpas por ellas — se responden. Pero solo si de verdad
  // se pudo bajar el archivo: si la descarga falló, la foto no está delante del
  // modelo y hay que tratarla como lo que es, algo que no puede ver. Dar por
  // hecho que está sería la peor versión de esto: contestar sobre una imagen
  // imaginaria.
  let noTexto = [...tipos].filter(t => t && t !== 'text')
  let veLaFoto = false
  if (noTexto.includes('image')) {
    const { visibles, fallidas } = await revisarImagenes(mensajeIds).catch(() => ({ visibles: 0, fallidas: 1 }))
    veLaFoto = visibles > 0
    // Solo se pide perdón por las que NO se pudieron bajar. Si de dos fotos una
    // llegó y la otra no, pasan las dos cosas: se responde sobre la que se ve y
    // se avisa de la que no.
    if (!fallidas) noTexto = noTexto.filter(t => t !== 'image')
  }

  // Las notas de voz siguen la misma regla desde la migración 095: si Whisper
  // la entendió, su texto ya está en el historial y el agente responde; si no,
  // se trata como lo que es —algo que nadie pudo oír— y se pasa a una persona.
  let oyeLaVoz = false
  if (noTexto.includes('audio')) {
    const { transcritos, fallidos } = await revisarAudios(mensajeIds).catch(() => ({ transcritos: 0, fallidos: 1 }))
    oyeLaVoz = transcritos > 0
    if (!fallidos) noTexto = noTexto.filter(t => t !== 'audio')
  }

  if (noTexto.length) {
    // `etiquetar` NO lanza si la etiqueta no existe: devuelve un 404 en el
    // cuerpo. Sin mirarlo, una migración sin aplicar dejaría esto sin efecto y
    // sin rastro — el mismo fallo mudo que estamos persiguiendo.
    const et = await etiquetar({
      contacto: num, clave: 'AUDIO_O_IMAGEN', origen: 'AGENTE',
      motivo: `Llegó ${nombrarTipos(noTexto)} — el agente no puede leerlo`,
    }).catch(e => ({ body: { ok: false, error: e.message } }))
    if (!et.body?.ok) log(MOD, `NO se pudo marcar el adjunto de ${num} —`, et.body?.error)

    const env = await enviarTexto({ contacto: num, texto: acuseDeAdjunto(noTexto), personalId: null })
      .catch(e => ({ body: { ok: false, error: e.message } }))
    if (!env.body?.ok) log(MOD, `NO se pudo avisar del adjunto a ${num} —`, env.body?.error)

    log(MOD, `${num} envió ${nombrarTipos(noTexto)} — avisado y marcado para coordinación`)
  }

  // Si solo mandó adjuntos que nadie puede leer, ya está: el resto es cosa de la
  // persona que abra la conversación. Una foto que el modelo SÍ ve, o una nota
  // de voz transcrita, no cuentan como eso — ahí hay conversación que seguir
  // aunque no venga una sola letra escrita.
  if (!tipos.has('text') && !veLaFoto && !oyeLaVoz) return

  // ── Tope de turnos, dentro de la ventana ──
  const { rows: [{ n }] } = await pool.query(
    `SELECT count(*)::int AS n FROM public.agente_wa_ejecuciones
      WHERE agente_id = $1 AND contacto = $2 AND origen = 'WHATSAPP'
        AND error IS NULL
        AND creado_en > now() - ($3 || ' hours')::interval`,
    [agente.id, num, VENTANA_TOPE_HORAS]
  )
  if (n >= agente.max_turnos) {
    // Callarse sin más dejaba a la vet esperando: para ella el agente
    // simplemente dejó de contestar. La etiqueta la pone en Novedades.
    log(MOD, `tope de ${agente.max_turnos}/${VENTANA_TOPE_HORAS}h alcanzado en ${num} — queda para un humano`)
    await avisarQueQuedoSinRespuesta(num,
      `Llegó al tope de ${agente.max_turnos} respuestas en ${VENTANA_TOPE_HORAS} horas`)
    return
  }

  // Refresca el "escribiendo…" (dura 25 s) justo antes de la parte lenta.
  acusarLectura({ phoneNumberId, contacto: num, waMessageId }).catch(() => {})

  let r = await ejecutar({ agente, contacto: num, origen: 'WHATSAPP', pendientesDesde })

  // Un reintento, y solo uno, y SOLO si tiene sentido reintentar. Un 400 es un
  // error nuestro en la petición: repetirlo da exactamente el mismo 400, hace
  // esperar de más a la vet y ensucia la bitácora con el doble de ruido —
  // pasó en la prueba del 12-ago. Los pasajeros (429, 5xx, red) sí se reintentan.
  if (r.error && esReintentable(r.error)) {
    log(MOD, `reintentando ${num} tras: ${r.error}`)
    await new Promise(res => setTimeout(res, 1500))
    r = await ejecutar({ agente, contacto: num, origen: 'WHATSAPP', pendientesDesde })
  }

  // No había nada nuevo que contestar. Silencio correcto, no fallo.
  if (r.nadaQueResponder) {
    log(MOD, `${num} sin nada nuevo que responder`)
    return r.hastaId || null
  }

  if (r.texto) {
    await enviarTexto({ contacto: num, texto: r.texto, personalId: null })
    return r.hastaId || null
  }

  // Llegar aquí es el fallo mudo: la vet escribió y no va a recibir nada.
  // ANTES no dejaba rastro fuera de la bitácora, que nadie mira.
  await avisarQueQuedoSinRespuesta(num, r.error || 'El agente no produjo respuesta')
  return r.hastaId || null
}

/**
 * ¿Vale la pena repetir esta llamada? Los 4xx los provoca la petición y volver
 * a mandarla da el mismo error; el resto (429, 5xx, red) suele ser pasajero.
 * El 429 es un 4xx y sí se reintenta: ahí el problema es el ritmo, no la forma.
 */
function esReintentable(error) {
  const m = String(error || '').match(/\b(4\d\d|5\d\d)\b/)
  if (!m) return true              // sin código: red o algo raro — se intenta
  const codigo = Number(m[1])
  if (codigo === 429) return true
  return codigo >= 500
}

/**
 * ¿Está esta conversación en manos de una persona? Devuelve el motivo (texto,
 * para el log) o `null` si el agente puede responder.
 *
 * Hay DOS formas de que la lleve alguien, y la segunda es la que importa el día
 * que esta línea conviva con otro panel:
 *
 * 1. **Desde Orbit.** Lo distingue `enviado_por`: el agente envía con NULL y el
 *    coordinador con su id. Es el mismo campo que usa la bandeja.
 *
 *    Con dos matices, y los dos salieron de la práctica: una **plantilla**
 *    enviada a mano solo aparta al agente `PAUSA_TRAS_PLANTILLA_MIN` minutos
 *    (es un aviso, no una conversación tomada), y un **envío masivo** no lo
 *    aparta en absoluto.
 *
 * 2. **Desde FUERA de Orbit** — el panel de Zolutium, WhatsApp Manager, o
 *    cualquier otra app suscrita a la misma WABA. Aquí no hay `enviado_por` que
 *    mirar: **Meta no nos manda como mensaje lo que sale por otra app, solo el
 *    acuse**. El único rastro es un acuse de SALIDA cuyo `wa_message_id` no
 *    corresponde a ningún mensaje nuestro — el que la bandeja descarta
 *    logueando "acuse sin mensaje en la bandeja". Si hay uno reciente para este
 *    contacto, alguien ya contestó desde otro lado y el agente se calla.
 *
 * Sin el punto 2, el día del plan B la veterinaria recibiría DOS respuestas: la
 * del panel y la del agente, que no puede verse la una a la otra.
 *
 * Se lee de la capa CRUDA a propósito: es la única que conserva esos acuses
 * huérfanos, y por eso existe (ver la arquitectura en dos capas del receptor).
 * `idx_wa_webhook_from (from_number, received_at DESC)` ya cubre la consulta.
 *
 * ⚠️ En un acuse, `from_number` NO es quien escribió: es el `recipient_id` de
 * Meta, o sea la veterinaria a la que le enviamos. Por eso casa con `contacto`.
 */
async function laLlevaUnHumano(contacto) {
  // El interruptor manual (migración 105) manda sobre todo lo demás: si alguien
  // dijo "de esta me encargo yo", no hay regla automática que valga.
  const { rows: [c] } = await pool.query(
    `SELECT agente_activo FROM public.whatsapp_contactos WHERE contacto = $1`, [contacto]
  )
  if (c && c.agente_activo === false) return 'el agente está apagado en esta conversación'

  // ⚠️ Un ENVÍO MASIVO no es una persona atendiendo esta conversación.
  //
  // Lleva `enviado_por` porque alguien lanzó la campaña, y es verdad — pero es
  // un aviso a 200 clínicas, no una voz metida en este chat concreto. Sin esta
  // excepción, una campaña dejaría al agente MUDO durante 12 horas en las 200
  // conversaciones a la vez, justo cuando más van a escribir: el texto del
  // aviso suele ser, literalmente, "escríbanos por esta línea".
  //
  // Se distingue por el `wamid`, que la campaña guarda en sus destinos: no hace
  // falta una marca nueva en la tabla de mensajes, y el rastro de quién lanzó
  // el envío se conserva intacto.
  const { rows: [enOrbit] } = await pool.query(
    `SELECT m.tipo FROM public.whatsapp_mensajes m
      WHERE m.contacto = $1 AND m.direccion = 'OUT' AND m.enviado_por IS NOT NULL
        AND m.ocurrido_en > now() - (CASE WHEN m.tipo = 'template'
                                          THEN ($3 || ' minutes')::interval
                                          ELSE ($2 || ' minutes')::interval END)
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_campana_destinos d
           WHERE d.wa_message_id = m.wa_message_id)
      ORDER BY m.ocurrido_en DESC
      LIMIT 1`,
    [contacto, PAUSA_TRAS_HUMANO_MIN, PAUSA_TRAS_PLANTILLA_MIN]
  )
  if (enOrbit) {
    return enOrbit.tipo === 'template'
      ? `se le acaba de enviar una plantilla a mano (margen de ${PAUSA_TRAS_PLANTILLA_MIN} min)`
      : 'la contestó una persona desde Orbit'
  }

  // Dos filtros, y los dos hacen falta — sin ellos esto calla al agente en
  // conversaciones que está atendiendo bien (comprobado contra prod el 13-ago,
  // donde había 7 acuses huérfanos y NINGUNO era de otro panel):
  //
  //  · `status = 'sent'` — es el instante en que un mensaje SALE. Los `read` y
  //    `delivered` no sirven: llegan cuando a la veterinaria le da por abrir el
  //    chat, y pueden ser de mensajes viejísimos. En prod había 5 `read`
  //    huérfanos de golpe, todos de mensajes NUESTROS cuyas filas se borraron
  //    al limpiar datos de prueba. Nada que ver con otro panel.
  //
  //  · posterior al ÚLTIMO ENTRANTE — lo que importa no es que alguien haya
  //    enviado algo hoy, sino que haya contestado el mensaje que el agente está
  //    a punto de responder. Un envío ANTERIOR a lo que ella escribió no la deja
  //    atendida: la deja esperando, y callarse ahí es el fallo peor de todos.
  //    Si el otro panel sigue contestando, cada mensaje nuevo trae su propio
  //    acuse y la protección se renueva sola, turno a turno.
  //
  // Sin entrante (no debería pasar aquí), `now()` hace que nada califique: ante
  // la duda el agente responde, porque un silencio no tiene quien lo note.
  //
  // No hay carrera con nuestros propios envíos: el `wamid` se guarda en cuanto
  // Meta responde al POST, y esto corre segundos después, tras la espera de
  // agrupación. Un acuse nuestro que llegue antes del INSERT deja de ser
  // huérfano en cuanto la fila existe — la condición se evalúa al vuelo.
  const { rowCount: fuera } = await pool.query(
    `SELECT 1 FROM public.whatsapp_webhook_events e
      WHERE e.event_type = 'status'
        AND e.status = 'sent'
        AND e.from_number = $1
        AND e.wa_message_id IS NOT NULL
        AND e.received_at > COALESCE(
              (SELECT max(ocurrido_en) FROM public.whatsapp_mensajes
                WHERE contacto = $1 AND direccion = 'IN'), now())
        AND NOT EXISTS (
              SELECT 1 FROM public.whatsapp_mensajes m
               WHERE m.wa_message_id = e.wa_message_id)
      LIMIT 1`,
    [contacto]
  )
  return fuera ? 'ya le respondieron desde otro panel (fuera de Orbit)' : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguimiento del enlace de registro (migración 098)
//
// El agente mandaba el enlace y ahí se moría el hilo: no sabía si lo llenaron y
// no volvía. Es justo donde se pierde el registro, y con él la comisión de la
// veterinaria — para lo que existe esta línea.
//
// ⚠️ No se decide nada al programar: se decide AL VENCER. En quince minutos la
// clínica puede haber contestado, haberse registrado o estar hablando con un
// coordinador, y en los tres casos insistir queda mal.
// ─────────────────────────────────────────────────────────────────────────────

const SEGUIMIENTO_CADA_MS = 60_000

/**
 * Anota que hay que volver sobre esta conversación.
 *
 * `ON CONFLICT DO NOTHING` contra el índice parcial de "uno vivo por
 * conversación": si el agente manda el enlace tres veces en la misma charla, el
 * recordatorio sigue siendo uno solo.
 */
async function programarSeguimiento({ agente, contacto, motivo }) {
  // 0 = apagado desde la pantalla del agente, sin desplegar nada.
  const minutos = Number(agente?.seguimiento_enlace_minutos ?? 0)
  if (!minutos || !contacto) return

  await pool.query(
    `INSERT INTO public.agente_wa_seguimientos (agente_id, contacto, motivo, programado_para)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     ON CONFLICT DO NOTHING`,
    [agente.id, contacto, motivo, minutos]
  )
}

/**
 * Los que vencieron. Cada uno se vuelve a evaluar contra la realidad de AHORA,
 * y solo sale el mensaje si sigue teniendo sentido.
 *
 * ⚠️ Asume UN proceso, igual que la agrupación de mensajes: con dos réplicas,
 * las dos barrerían y el recordatorio saldría por duplicado. Hoy `orbit-backend`
 * es un contenedor único; si eso cambia, esto necesita un claim con
 * `FOR UPDATE SKIP LOCKED`.
 */
async function barrerSeguimientos() {
  const { rows } = await pool.query(
    `SELECT s.id, s.contacto, s.creado_en, a.activo, a.seguimiento_enlace_texto
       FROM public.agente_wa_seguimientos s
       JOIN public.agente_wa a ON a.id = s.agente_id
      WHERE s.estado = 'PENDIENTE' AND s.programado_para <= now()
      ORDER BY s.programado_para
      LIMIT 20`
  )

  for (const s of rows) {
    const cerrar = (estado, desenlace) => pool.query(
      `UPDATE public.agente_wa_seguimientos
          SET estado = $2, desenlace = $3, resuelto_en = now()
        WHERE id = $1`,
      [s.id, estado, desenlace]
    ).catch(e => log(MOD, `no se pudo cerrar el seguimiento ${s.id} —`, e.message))

    try {
      if (!s.activo) { await cerrar('CANCELADO', 'el agente está apagado'); continue }

      // ¿Contestó cualquier cosa? Entonces la conversación siguió sola y el
      // recordatorio sobra.
      const { rowCount: contesto } = await pool.query(
        `SELECT 1 FROM public.whatsapp_mensajes
          WHERE contacto = $1 AND direccion = 'IN' AND ocurrido_en > $2 LIMIT 1`,
        [s.contacto, s.creado_en]
      )
      if (contesto) { await cerrar('CANCELADO', 'la veterinaria contestó'); continue }

      // ¿Ya se registró? Es el objetivo del recordatorio: preguntarle si lo
      // llenó cuando acaba de llenarlo es quedar como el que no se entera.
      // Si el número no resuelve contra ningún aliado, `aliado_id` es NULL y
      // esto no casa nunca: no se puede saber, así que no se cancela por aquí.
      const { rowCount: registro } = await pool.query(
        `SELECT 1 FROM public.solicitudes_servicio ss
          WHERE ss.created_at > $2
            AND ss.aliado_id = (SELECT aliado_id FROM public.v_whatsapp_conversaciones
                                 WHERE contacto = $1)
          LIMIT 1`,
        [s.contacto, s.creado_en]
      )
      if (registro) { await cerrar('CANCELADO', 'ya llegó su solicitud'); continue }

      const laLleva = await laLlevaUnHumano(s.contacto)
      if (laLleva) { await cerrar('CANCELADO', laLleva); continue }

      const texto = String(s.seguimiento_enlace_texto || '').trim()
      if (!texto) { await cerrar('CANCELADO', 'no hay texto configurado'); continue }

      // `enviarTexto` valida la ventana de 24 h antes de llamar a Meta: si se
      // cerró (el backend estuvo caído medio día), devuelve error y aquí se
      // cancela en vez de reventar.
      const env = await enviarTexto({ contacto: s.contacto, texto, personalId: null })
        .catch(e => ({ body: { ok: false, error: e.message } }))
      if (!env.body?.ok) {
        await cerrar('CANCELADO', `no se pudo enviar: ${env.body?.error || 'desconocido'}`)
        continue
      }

      await cerrar('ENVIADO', null)
      log(MOD, `seguimiento del enlace enviado a ${s.contacto}`)
    } catch (e) {
      await cerrar('CANCELADO', `error: ${e.message}`)
      log(MOD, `seguimiento ${s.id} falló —`, e.message)
    }
  }
}

/**
 * Lo que quedó esperando mientras el agente estaba en pausa.
 *
 * 🩸 EL AGUJERO QUE ESTO TAPA: el agente es puramente REACTIVO — solo actúa
 * cuando entra un mensaje. Si en ese instante estaba apartado (una persona
 * acababa de escribir, o se envió una plantilla), ese mensaje **se perdía para
 * siempre**: al vencer la pausa no pasaba nada, se quedaba esperando el
 * siguiente. Pasó de verdad el 19-ago: una clínica escribió tres veces durante
 * una pausa y no iba a recibir respuesta nunca.
 *
 * De paso cubre otros dos casos con el mismo síntoma: un **reinicio del
 * backend** (las respuestas programadas viven en memoria y se pierden con el
 * proceso) y un webhook que Meta no consiguiera entregar.
 *
 * Los límites son lo que evita que esto se vuelva un problema:
 *
 *  · **Dentro de las 24 h.** Fuera de la ventana el agente no puede mandar
 *    texto libre, así que retomar sería fabricar un fallo.
 *  · **Más de 2 minutos de antigüedad.** Lo recién llegado ya lo está
 *    atendiendo el camino normal, que agrupa varios mensajes seguidos.
 *  · **Nada en vuelo.** Si la conversación ya está en `enEspera`, se deja.
 *  · **Un intento por conversación cada media hora.** Sin esto, un fallo al
 *    responder se reintentaría cada minuto para siempre.
 */
const REINTENTO_PENDIENTE_MS = 30 * 60_000
const TOPE_PENDIENTES_POR_BARRIDO = 5
const intentados = new Map()

async function barrerPendientes() {
  const { rows } = await pool.query(
    `SELECT u.contacto, u.id AS mensaje_id, u.wa_message_id, u.tipo, u.phone_number_id
       FROM (
         SELECT DISTINCT ON (m.contacto)
                m.contacto, m.id, m.wa_message_id, m.tipo, m.phone_number_id,
                m.direccion, m.ocurrido_en
           FROM public.whatsapp_mensajes m
          WHERE m.ocurrido_en > now() - interval '24 hours'
          ORDER BY m.contacto, m.ocurrido_en DESC, m.id DESC
       ) u
      WHERE u.direccion = 'IN'
        AND u.ocurrido_en < now() - interval '2 minutes'
      ORDER BY u.ocurrido_en
      LIMIT $1`,
    [TOPE_PENDIENTES_POR_BARRIDO]
  )

  for (const p of rows) {
    if (enEspera.has(p.contacto)) continue
    const ultimo = intentados.get(p.contacto)
    if (ultimo && Date.now() - ultimo < REINTENTO_PENDIENTE_MS) continue

    // Las mismas compuertas que en el camino normal: si sigue en pausa o el
    // interruptor está apagado, no se toca.
    const laLleva = await laLlevaUnHumano(p.contacto)
    if (laLleva) continue

    intentados.set(p.contacto, Date.now())
    log(MOD, `${p.contacto}: retomando un mensaje que quedó sin contestar`)
    // Se entra por la puerta de siempre: agrupación, "escribiendo…", acuse de
    // lectura y bitácora salen gratis, y no hay una segunda forma de responder
    // que se quede atrás el día que cambie la primera.
    await responderSiAplica({
      phoneNumberId: p.phone_number_id, contacto: p.contacto,
      tipo: p.tipo, waMessageId: p.wa_message_id, mensajeId: p.mensaje_id,
    })
  }
}

let temporizadorSeguimientos = null

/** Lo arranca `index.js`. Idempotente: dos llamadas no dan dos barridos. */
export function arrancarSeguimientos() {
  if (temporizadorSeguimientos) return
  temporizadorSeguimientos = setInterval(
    () => barrerSeguimientos().catch(e => log(MOD, 'barrido de seguimientos falló —', e.message)),
    SEGUIMIENTO_CADA_MS
  )
  temporizadorSeguimientos.unref?.()
  log(MOD, `seguimiento del enlace: barrido cada ${SEGUIMIENTO_CADA_MS / 1000}s`)

  const pendientes = setInterval(
    () => barrerPendientes().catch(e => log(MOD, 'barrido de pendientes falló —', e.message)),
    SEGUIMIENTO_CADA_MS
  )
  pendientes.unref?.()
  log(MOD, `mensajes sin contestar: barrido cada ${SEGUIMIENTO_CADA_MS / 1000}s`)
}

/** Cómo se llama en cristiano lo que llegó, para el aviso y la etiqueta. */
function nombrarTipos(tipos) {
  const NOMBRES = {
    audio: 'una nota de voz', voice: 'una nota de voz',
    image: 'una imagen', sticker: 'un sticker', video: 'un video',
    document: 'un documento', location: 'una ubicación', contacts: 'un contacto',
  }
  const vistos = [...new Set(tipos.map(t => NOMBRES[t] || 'un archivo'))]
  if (vistos.length === 1) return vistos[0]
  return vistos.slice(0, -1).join(', ') + ' y ' + vistos[vistos.length - 1]
}

/**
 * Lo que se le responde a la veterinaria cuando manda algo que el agente no
 * puede leer. Decir la verdad —"no puedo oírlo"— es mejor que el silencio y
 * mejor que fingir que se entendió.
 */
function acuseDeAdjunto(tipos) {
  const soloVoz = tipos.every(t => t === 'audio' || t === 'voice')
  const que = nombrarTipos(tipos)
  // Sin pronombre de vuelta: "una imagen… no puedo abrirlo" y "un documento… no
  // puedo abrirla" salían mal según lo que llegara. La frase se corta antes.
  return soloVoz
    ? `Recibí ${que}. Por aquí no puedo escucharla, así que ya queda avisado el equipo y te responden `
      + 'en seguida. Si prefieres, escríbeme por texto lo que necesitas y seguimos al momento.'
    : `Recibí ${que}. Por aquí no puedo abrir archivos, así que ya queda avisado el equipo y te responden `
      + 'en seguida. Si prefieres, cuéntame por texto lo que necesitas y seguimos al momento.'
}

/**
 * Marca la conversación para que aparezca en Novedades de la bandeja.
 *
 * Es la diferencia entre "el agente falló" y "una veterinaria se quedó
 * esperando y nadie se enteró". Nunca lanza: si hasta esto falla, al menos
 * queda en el log.
 */
async function avisarQueQuedoSinRespuesta(contacto, motivo) {
  try {
    const r = await etiquetar({
      contacto, clave: 'FALLO_AGENTE', origen: 'AGENTE',
      motivo: String(motivo || '').slice(0, 300),
    })
    // `etiquetar` devuelve el error en el cuerpo en vez de lanzarlo: si la
    // etiqueta no existiera, el `try` pasaría limpio y el aviso se perdería sin
    // una sola línea de log. Justo lo que este aviso viene a evitar.
    if (!r.body?.ok) {
      log(MOD, `NO SE PUDO AVISAR del fallo de ${contacto} —`, r.body?.error, '— motivo original:', motivo)
      return
    }
    log(MOD, `${contacto} marcado para coordinación — ${motivo}`)
  } catch (e) {
    log(MOD, 'no se pudo marcar el fallo de', contacto, '—', e.message)
  }
}

/**
 * Una respuesta completa: arma contexto, llama a Claude, ejecuta herramientas
 * si las pide y devuelve el texto final. Deja rastro en la bitácora pase lo
 * que pase — sin eso no hay forma de ajustar el contexto con evidencia.
 */
export async function ejecutar({ agente, contacto, origen = 'PRUEBA', mensajePrueba = null, pendientesDesde = null }) {
  const inicio = Date.now()
  const usadas = []
  const etiquetas = []
  const textos = []
  let entrada = mensajePrueba
  let salida = null
  let tokIn = 0, tokOut = 0, fallo = null
  const cache = { creados: 0, leidos: 0 }

  try {
    const [system, herramientas] = await Promise.all([
      construirSistema(agente), construirHerramientas(),
    ])
    let hastaId = 0
    let messages
    if (mensajePrueba) {
      messages = [{ role: 'user', content: mensajePrueba }]
    } else {
      const hist = await construirHistorial(contacto, pendientesDesde)
      messages = hist.mensajes
      hastaId = hist.hastaId
    }

    // Sin nada nuevo del otro lado no hay a qué responder. NO es un fallo: no se
    // reintenta y no se etiqueta. Distinguirlo importa — marcarlo como fallo
    // llenaría Novedades de conversaciones que están perfectamente atendidas.
    if (!messages.length) return { texto: null, nadaQueResponder: true, hastaId }
    // `entrada` se calcula ANTES de pegar la nota del servidor: la bitácora debe
    // guardar lo que escribió la veterinaria, no lo que le susurramos al modelo.
    if (!entrada) entrada = textoDe(messages[messages.length - 1]?.content)

    // Lo que el servidor sabe de este número. Va pegado al último turno del
    // usuario, marcado como sistema para que el modelo no lo confunda con algo
    // que dijo la clínica.
    if (!mensajePrueba) {
      const nota = await contextoDeLaConversacion(contacto).catch(() => null)
      if (nota) {
        const ultimo = messages[messages.length - 1]
        ultimo.content = [
          ...aBloques(ultimo.content),
          { type: 'text', text: `<sistema>${nota}</sistema>` },
        ]
      }
    }

    let respuesta
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      respuesta = await anthropic().messages.create({
        model:      agente.modelo,
        max_tokens: 2048,
        system,
        messages,
        tools: herramientas,
        ...razonamientoPara(agente.modelo, agente.effort),
      })
      // `input_tokens` NO incluye lo que vino de la caché: el contexto (que es
      // el grueso) se reporta aparte en cache_creation/cache_read. Sumar solo
      // input_tokens subestima el consumo real varias veces.
      const u = respuesta.usage || {}
      tokIn  += (u.input_tokens || 0)
              + (u.cache_creation_input_tokens || 0)
              + (u.cache_read_input_tokens || 0)
      tokOut += u.output_tokens || 0
      cache.creados += u.cache_creation_input_tokens || 0
      cache.leidos  += u.cache_read_input_tokens || 0

      // El texto se acumula VUELTA A VUELTA, no se lee al final: el modelo habla
      // mientras usa herramientas (`[text, tool_use]` en la misma respuesta) y la
      // última vuelta suele venir vacía porque ya lo dijo todo. Leyendo solo la
      // última se perdía el mensaje entero — incluido el enlace que acababa de
      // pedir. Se veía como "el agente no responde".
      const dicho = (respuesta.content || [])
        .filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      if (dicho) textos.push(dicho)

      if (respuesta.stop_reason !== 'tool_use') break

      // Los bloques de la respuesta viajan de vuelta tal cual: quitarlos rompe
      // el emparejamiento tool_use/tool_result.
      messages.push({ role: 'assistant', content: respuesta.content })

      const resultados = []
      for (const bloque of respuesta.content.filter(b => b.type === 'tool_use')) {
        usadas.push(bloque.name)
        let out
        try {
          if (bloque.name === 'enviar_enlace_registro') {
            out = await enviarEnlaceRegistro({ contacto })
            if (out.tipo === 'ESCALAR') {
              await clasificarConversacion({ entrada: { etiqueta: 'CONVENIO', motivo: 'Clínica no habilitada: pidió registrar y no se le pudo dar enlace' }, contacto }).catch(() => {})
            } else {
              // Mandar el enlace y no volver nunca es donde se pierde el
              // registro: la clínica lo deja para luego y nadie pregunta más.
              // Se programa la vuelta; al vencer se decide si todavía tiene
              // sentido. Nunca lanza: que falle el recordatorio no puede
              // tumbar la respuesta que la vet está esperando.
              await programarSeguimiento({ agente, contacto, motivo: 'ENLACE_REGISTRO' })
                .catch(e => log(MOD, 'no se pudo programar el seguimiento —', e.message))
            }
          } else if (bloque.name === 'registrar_solicitud') {
            out = await registrarSolicitud({ entrada: bloque.input, agente, contacto })
            // La solicitud tiene su propia etiqueta: si el agente no la pone, la
            // conversación que MÁS importa quedaría fuera del tablero.
            if (out.ok) await clasificarConversacion({ entrada: { etiqueta: 'SOLICITUD' }, contacto }).catch(() => {})
          } else if (bloque.name === 'enviar_interactivo') {
            // OJO: esta herramienta ENVÍA de verdad, no devuelve texto para que
            // el modelo lo incluya. Por eso el resultado se lo dice explícito:
            // si no, remata repitiendo por escrito lo que la vet acaba de
            // recibir como botones.
            out = await enviarInteractivo({
              contacto, clave: bloque.input?.clave, personalId: null, enviarSobre,
            }).then(r => r.body?.ok
              ? { ok: true, enviado: bloque.input?.clave,
                  nota: 'Ya le llegó. NO repitas su contenido ni lo describas: solo sigue la conversación si hace falta.' }
              : { ok: false, error: r.body?.error || 'No se pudo enviar' })
          } else if (bloque.name === 'enviar_material') {
            // Como el interactivo: ENVÍA de verdad. El archivo ya le llegó, así
            // que anunciarlo ("te lo mando en seguida") sería anunciar algo que
            // la clínica ya tiene en pantalla.
            out = await enviarMaterial({
              contacto, clave: bloque.input?.clave, personalId: null, enviarSobre,
            }).then(r => {
              if (r.body?.ok) {
                return { ok: true, enviado: bloque.input?.clave,
                  nota: 'El archivo YA le llegó. No digas que se lo vas a mandar: confírmalo en pasado, en una línea, y sigue.' }
              }
              // El detalle técnico se queda en el log y NO se le da al modelo:
              // probándolo, le repetía el error a la clínica tal cual ("me da un
              // error con el contacto"), que no le dice nada y suena a roto.
              log(MOD, `no se pudo mandar ${bloque.input?.clave} a ${contacto} —`, r.body?.error)
              return { ok: false, error: 'No se pudo enviar el archivo.',
                nota: 'No expliques el fallo ni lo cites: dile que se lo hace llegar coordinación, y etiqueta la conversación.' }
            })
          } else if (bloque.name === 'clasificar_conversacion') {
            out = await clasificarConversacion({ entrada: bloque.input, contacto })
            // Se guarda en la bitácora, no solo en la conversación: la etiqueta
            // de la conversación es única y se pisa, y lo que hace falta para
            // aprender es el HISTORIAL de lo que no supo responder.
            if (out.ok) etiquetas.push({ clave: bloque.input?.etiqueta, motivo: bloque.input?.motivo || null })
          } else {
            out = { ok: false, error: `Herramienta desconocida: ${bloque.name}` }
          }
        } catch (e) {
          log(MOD, `herramienta ${bloque.name} falló —`, e.message)
          out = { ok: false, error: 'No se pudo registrar. Dile que lo hará una persona del equipo.' }
        }
        resultados.push({
          type: 'tool_result', tool_use_id: bloque.id,
          content: JSON.stringify(out), is_error: !out.ok,
        })
      }
      messages.push({ role: 'user', content: resultados })

      // Si la vuelta SOLO etiquetó, no hay nada que devolverle al modelo: la
      // etiqueta es papeleo interno y la veterinaria no la ve. Darle otro turno
      // es justo lo que producía el mensaje que dice DOS VECES lo mismo — el
      // modelo escribe su respuesta, etiqueta, y en la vuelta siguiente vuelve a
      // rematar ("ya quedó marcado para que coordinación…"). Medido el 13-ago:
      // pasaba en 3 de cada 4 respuestas que escalaban.
      // Se exige `textos.length`: si etiquetó SIN haber dicho nada todavía, el
      // turno extra es lo único que puede producir la respuesta — cortar ahí
      // dejaría a la vet sin contestación, que es peor que una repetición.
      const soloEtiquetas = respuesta.content
        .filter(b => b.type === 'tool_use')
        .every(b => b.name === 'clasificar_conversacion')
      if (soloEtiquetas && textos.length) break
    }

    salida = textos.join('\n\n').trim() || null

    return { texto: salida, tokensEntrada: tokIn, tokensSalida: tokOut, herramientas: usadas, cache, hastaId }
  } catch (e) {
    fallo = e.message
    log(MOD, 'ERROR ejecutando —', e.message)
    return { texto: null, error: e.message }
  } finally {
    await pool.query(
      `INSERT INTO public.agente_wa_ejecuciones
         (agente_id, contacto, phone_number_id, origen, entrada, salida,
          herramientas, tokens_entrada, tokens_salida, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        agente.id, contacto, null, origen,
        entrada ? String(entrada).slice(0, 4000) : null,
        salida  ? String(salida).slice(0, 4000)  : null,
        JSON.stringify({ usadas, etiquetas, ms: Date.now() - inicio, cache }),
        tokIn, tokOut, fallo,
      ]
    ).catch(e => log(MOD, 'no se pudo escribir la bitácora —', e.message))
  }
}

/** Prueba desde la pantalla: no envía nada por WhatsApp. */
export async function probar({ clave = 'VETERINARIAS', mensaje }) {
  if (!mensaje?.trim()) return { status: 400, body: { ok: false, error: 'Escribe un mensaje de prueba' } }

  const { rows } = await pool.query(
    `SELECT id, clave, instrucciones, modelo, effort, max_turnos
       FROM public.agente_wa WHERE clave = $1`, [clave]
  )
  if (!rows.length) return { status: 404, body: { ok: false, error: 'No existe el agente' } }

  // A propósito NO se comprueba `activo`: probar es justo lo que se hace antes
  // de encenderlo.
  const r = await ejecutar({
    agente: rows[0], contacto: 'PRUEBA', origen: 'PRUEBA', mensajePrueba: mensaje,
  })
  if (r.error) return { status: 502, body: { ok: false, error: r.error } }
  return { status: 200, body: { ok: true, respuesta: r.texto, ...r } }
}
