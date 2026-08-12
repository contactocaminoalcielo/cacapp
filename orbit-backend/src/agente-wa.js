// Motor del agente conversacional de WhatsApp (migración 088).
//
// El agente es AISLADO: no consulta la operación. Su mundo entero es
// `agente_wa.instrucciones` + `agente_wa_conocimiento`. Lo único que escribe es
// una fila en `solicitudes_servicio`, que cae en la columna Solicitudes del
// Kanban para que el coordinador apruebe o descarte.
//
// ⚠️ NO confundir con `ia.js`: aquel es una llamada suelta para sugerencias
// internas. Este mantiene conversación, usa herramientas y le habla a un
// tercero en nombre de Camino al Cielo.
import Anthropic from '@anthropic-ai/sdk'
import { pool, log } from './db.js'
import { enviarTexto, etiquetar, acusarLectura } from './whatsapp-cloud.js'
import { enlacePersonalAliado, enlaceAfiliacion } from './aliados.js'

const MOD = '[agente-wa]'

/** Cuántos mensajes previos se le dan como memoria de la conversación. */
const HISTORIAL = 20

/** Tope de vueltas del ciclo de herramientas dentro de UNA respuesta. */
const MAX_VUELTAS = 5

/**
 * Cuánto se espera, tras el último mensaje, a que la veterinaria termine de
 * escribir. Nadie escribe un párrafo en WhatsApp: escribe "Hola" / "buenas" /
 * "necesito una recogida" / "es un labrador de 30 kilos". Sin esta espera cada
 * renglón disparaba una respuesta propia, todas a la vez y cada una calculada
 * sobre un pedazo distinto de la conversación.
 *
 * 8 s es el punto medio medido a ojo: más corto parte los mensajes de quien
 * escribe pausado, más largo se siente abandono. Ajustable sin desplegar.
 */
const ESPERA_MS = Math.max(0, Number(process.env.AGENTE_WA_ESPERA_MS || 8000))

/**
 * Techo de la espera, contado desde el PRIMER mensaje sin responder.
 *
 * Sin esto la espera se renueva con cada renglón: alguien que escriba sin pausas
 * largas no recibiría respuesta nunca, y el agente parecería muerto justo con
 * quien más está escribiendo. A los 30 s se contesta con lo que haya llegado.
 */
const ESPERA_MAX_MS = Math.max(ESPERA_MS, Number(process.env.AGENTE_WA_ESPERA_MAX_MS || 30000))

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
 */
const PAUSA_TRAS_HUMANO_HORAS = 12

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
    'Registra una solicitud de recogida para que coordinación la revise y confirme. ' +
    'Úsala cuando la veterinaria haya dado, como mínimo, el nombre y el WhatsApp de la ' +
    'persona de contacto y el nombre de la mascota. No confirma horario ni asignación: ' +
    'después de usarla, dile que coordinación confirma la hora directamente.',
  input_schema: {
    type: 'object',
    properties: {
      cliente_nombre:   { type: 'string', description: 'SOLO el nombre de la familia dueña de la mascota. No metas aquí el nombre de la veterinaria ni el de quien escribe: eso va en `veterinaria` y en `notas`.' },
      cliente_whatsapp: { type: 'string', description: 'WhatsApp del contacto, solo dígitos con indicativo. Ej: 573001234567' },
      mascota_nombre:   { type: 'string', description: 'Nombre de la mascota.' },
      mascota_especie:  { type: 'string', description: 'Perro, Gato, Conejo, Ave… tal como lo dijeron.' },
      mascota_peso_kg:  { type: 'number', description: 'Peso aproximado en kilogramos.' },
      recogida_en:      { type: 'string', enum: ['veterinaria', 'domicilio'], description: 'Dónde se recoge: en la clínica ("veterinaria") o en la casa de la familia ("domicilio"). Pregúntalo si no quedó claro — de esto depende la dirección a la que va el técnico.' },
      veterinaria:      { type: 'string', description: 'Nombre de la clínica desde la que escriben, tal como lo digan.' },
      direccion:        { type: 'string', description: 'Dirección de la recogida.' },
      barrio:           { type: 'string', description: 'Barrio o punto de referencia.' },
      plan:             { type: 'string', description: 'Plan elegido, si ya lo definieron.' },
      notas:            { type: 'string', description: 'Indicaciones especiales, horarios preferidos, cualquier detalle relevante.' },
    },
    required: ['cliente_nombre', 'cliente_whatsapp', 'mascota_nombre'],
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
  if (!etiquetas.length) return HERRAMIENTAS

  return [...HERRAMIENTAS, {
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

async function registrarSolicitud({ entrada, agente, contacto }) {
  const tel = String(entrada.cliente_whatsapp || '').replace(/\D/g, '')
  if (!tel) return { ok: false, error: 'El WhatsApp del contacto no es válido.' }

  // El aliado NO se lo preguntamos al agente ni se lo dejamos elegir: se deriva
  // del número desde el que escriben, que la bandeja ya cruza contra `aliados`.
  // Así el agente sigue aislado (no consulta la operación) y la solicitud llega
  // con vet asociada. Sin esto el Kanban convierte con `aliado_origen_id` NULL
  // y `canal_entrada='DIRECTO'` (Kanban.jsx:865-867): la veterinaria pierde su
  // comisión en silencio, que es justo lo contrario de para qué existe la línea.
  const { rows: [conv] } = await pool.query(
    `SELECT aliado_id FROM public.v_whatsapp_conversaciones WHERE contacto = $1`,
    [String(contacto || '').replace(/\D/g, '')]
  )

  // `origen` se queda en ALIADO — la solicitud viene de una veterinaria. Meter
  // un valor nuevo rompería el aviso a coordinación y, al convertir, la
  // comisión del aliado. El canal va en `agente_id`. Ver migración 088.
  const { rows } = await pool.query(
    `INSERT INTO public.solicitudes_servicio
       (cliente_nombre, cliente_whatsapp, mascota_nombre, mascota_peso_kg,
        direccion, barrio, notas_cliente, origen, estado, agente_id,
        aliado_id, aliado_nombre_otro, tipo_recogida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ALIADO','PENDIENTE',$8,$9,$10,$11)
     RETURNING id`,
    [
      String(entrada.cliente_nombre).slice(0, 120),
      tel.slice(0, 25),
      String(entrada.mascota_nombre).slice(0, 120),
      Number.isFinite(entrada.mascota_peso_kg) && entrada.mascota_peso_kg > 0
        ? entrada.mascota_peso_kg : null,
      entrada.direccion ? String(entrada.direccion).slice(0, 250) : null,
      entrada.barrio ? String(entrada.barrio).slice(0, 120) : null,
      [
        entrada.mascota_especie ? `Especie: ${entrada.mascota_especie}` : null,
        entrada.plan            ? `Plan mencionado: ${entrada.plan}`    : null,
        entrada.notas           || null,
        `Registrada por el agente de WhatsApp desde ${contacto}.`,
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
    + (conv?.aliado_id ? ` (aliado ${conv.aliado_id})` : ' — SIN aliado asociado'))
  return { ok: true, mensaje: 'Solicitud registrada. Coordinación la revisa y confirma la hora.' }
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
async function construirSistema(agente) {
  const { rows: piezas } = await pool.query(
    `SELECT tipo, titulo, texto, archivo, mime
       FROM public.agente_wa_conocimiento
      WHERE agente_id = $1 AND activo
      ORDER BY orden, id`,
    [agente.id]
  )

  const bloques = [{ type: 'text', text: agente.instrucciones || '' }]

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
    text: 'Cuando necesites más de una herramienta, pídelas JUNTAS en la misma '
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
      + 'vez por línea.',
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

/** El hilo reciente, traducido a turnos de conversación. */
async function construirHistorial(contacto) {
  const { rows } = await pool.query(
    `SELECT direccion, texto, enviado_por FROM public.whatsapp_mensajes
      WHERE contacto = $1 AND texto IS NOT NULL AND texto <> ''
      ORDER BY ocurrido_en DESC, id DESC
      LIMIT $2`,
    [contacto, HISTORIAL]
  )

  const mensajes = []
  for (const m of rows.reverse()) {
    const role = m.direccion === 'IN' ? 'user' : 'assistant'
    // Por la misma línea salen dos voces: el agente y el coordinador. Sin
    // marcarlo, el modelo lee lo que escribió una persona como si lo hubiera
    // dicho él — y da por suyos compromisos que no hizo, o repite lo que
    // coordinación acaba de resolver. El prefijo es la única forma de que
    // distinga, porque la API solo tiene dos roles.
    const texto = role === 'assistant' && m.enviado_por
      ? `[coordinación] ${m.texto}`
      : m.texto
    // La API rechaza turnos consecutivos del mismo rol; se fusionan.
    if (mensajes.length && mensajes[mensajes.length - 1].role === role) {
      mensajes[mensajes.length - 1].content += `\n${texto}`
    } else {
      mensajes.push({ role, content: texto })
    }
  }
  // Tiene que empezar por el usuario.
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift()
  return mensajes
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
    `SELECT id, clave, activo, instrucciones, modelo, effort, max_turnos, phone_number_ids
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
export async function responderSiAplica({ phoneNumberId, contacto, tipo, waMessageId }) {
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

    if (await laLlevaUnHumano(num)) {
      log(MOD, `${num} la lleva una persona — el agente ni acusa recibo`)
      return
    }

    // Inmediato y sin await: el doble check azul y el "escribiendo…" son lo que
    // convierte la espera en atención. Es cosmético — si falla, da igual.
    acusarLectura({ phoneNumberId, contacto: num, waMessageId }).catch(() => {})

    const p = enEspera.get(num) || { tipos: new Set(), ejecutando: false, timer: null }
    p.phoneNumberId = phoneNumberId
    if (waMessageId) p.waMessageId = waMessageId
    if (!p.desde) p.desde = Date.now()
    p.tipos.add(tipo || 'text')
    enEspera.set(num, p)

    // Si ya está respondiendo, no se programa nada: lo que llegue ahora se
    // atiende en cuanto termine (ver el `finally` de `atender`). Sin esto se
    // solaparían dos ejecuciones sobre la misma conversación.
    if (p.ejecutando) return

    if (p.timer) clearTimeout(p.timer)
    // El silencio de siempre, pero sin pasarse del techo desde el primer
    // mensaje: quien escribe sin pausas también merece respuesta.
    const espera = Math.max(0, Math.min(ESPERA_MS, p.desde + ESPERA_MAX_MS - Date.now()))
    p.timer = setTimeout(() => { atender(num).catch(() => {}) }, espera)
    // Que un temporizador pendiente no impida al proceso apagarse limpio.
    p.timer.unref?.()
  } catch (e) {
    log(MOD, 'ERROR programando respuesta a', contacto, '—', e.message)
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
  p.tipos.clear()
  p.desde = null

  try {
    await responder({ num, tipos, phoneNumberId: p.phoneNumberId, waMessageId: p.waMessageId })
  } catch (e) {
    log(MOD, 'ERROR atendiendo', num, '—', e.message)
    await avisarQueQuedoSinRespuesta(num, e.message).catch(() => {})
  } finally {
    p.ejecutando = false
    if (p.tipos.size) {
      // Llegó algo mientras respondíamos. Se vuelve a esperar el silencio: si la
      // vet sigue escribiendo, no la interrumpimos a media frase. Con el mismo
      // techo que en la programación normal.
      const espera = Math.max(0, Math.min(ESPERA_MS, (p.desde || Date.now()) + ESPERA_MAX_MS - Date.now()))
      p.timer = setTimeout(() => { atender(num).catch(() => {}) }, espera)
      p.timer.unref?.()
    } else {
      enEspera.delete(num)
    }
  }
}

/** Una respuesta completa a lo que se acumuló de un número. */
async function responder({ num, tipos, phoneNumberId, waMessageId }) {
  const agente = await agenteParaLinea(phoneNumberId)
  if (!agente) return

  // ── ¿La lleva una persona? ──
  // Se vuelve a preguntar aquí, aunque ya se preguntó al programar: entre una
  // cosa y otra pasan los segundos de espera, que es JUSTO cuando el coordinador
  // ve el mensaje entrar y contesta. Sin esta segunda comprobación, el caso más
  // probable de todos —los dos contestando— se colaría.
  if (await laLlevaUnHumano(num)) {
    log(MOD, `${num} la tomó una persona mientras esperábamos — el agente se aparta`)
    return
  }

  // ── Lo que el agente no puede leer ──
  // Antes se descartaba con un `return` mudo: la veterinaria mandaba una nota de
  // voz y no pasaba absolutamente nada, ni respuesta ni rastro. Ahora se le
  // contesta y la conversación entra en Novedades.
  const noTexto = [...tipos].filter(t => t && t !== 'text')
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

  // Si solo mandó adjuntos, ya está: el resto es cosa de la persona que lo abra.
  if (!tipos.has('text')) return

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

  let r = await ejecutar({ agente, contacto: num, origen: 'WHATSAPP' })

  // Un reintento, y solo uno. La mayoría de los fallos son pasajeros (un 429,
  // un corte de red); insistir más sería castigar a la vet con la espera.
  if (r.error) {
    log(MOD, `reintentando ${num} tras: ${r.error}`)
    await new Promise(res => setTimeout(res, 1500))
    r = await ejecutar({ agente, contacto: num, origen: 'WHATSAPP' })
  }

  if (r.texto) {
    await enviarTexto({ contacto: num, texto: r.texto, personalId: null })
    return
  }

  // Llegar aquí es el fallo mudo: la vet escribió y no va a recibir nada.
  // ANTES no dejaba rastro fuera de la bitácora, que nadie mira.
  await avisarQueQuedoSinRespuesta(num, r.error || 'El agente no produjo respuesta')
}

/**
 * ¿Escribió una persona del equipo hace poco por esta conversación?
 *
 * Lo distingue `enviado_por`: el agente envía con NULL y el coordinador con su
 * id. Es el mismo campo que ya usa la bandeja para mostrar quién respondió.
 */
async function laLlevaUnHumano(contacto) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM public.whatsapp_mensajes
      WHERE contacto = $1 AND direccion = 'OUT' AND enviado_por IS NOT NULL
        AND ocurrido_en > now() - ($2 || ' hours')::interval
      LIMIT 1`,
    [contacto, PAUSA_TRAS_HUMANO_HORAS]
  )
  return rowCount > 0
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
  return soloVoz
    ? `Recibí ${que}, pero por aquí no puedo escucharla. Ya queda avisado el equipo y te responden en seguida. `
      + 'Si prefieres, escríbeme por texto lo que necesitas y seguimos al momento.'
    : `Recibí ${que}, pero por aquí no puedo abrirlo. Ya queda avisado el equipo y te responden en seguida. `
      + 'Si prefieres, cuéntame por texto lo que necesitas y seguimos al momento.'
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
export async function ejecutar({ agente, contacto, origen = 'PRUEBA', mensajePrueba = null }) {
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
    const messages = mensajePrueba
      ? [{ role: 'user', content: mensajePrueba }]
      : await construirHistorial(contacto)

    if (!messages.length) return { texto: null }
    if (!entrada) entrada = messages[messages.length - 1]?.content || null

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
            }
          } else if (bloque.name === 'registrar_solicitud') {
            out = await registrarSolicitud({ entrada: bloque.input, agente, contacto })
            // La solicitud tiene su propia etiqueta: si el agente no la pone, la
            // conversación que MÁS importa quedaría fuera del tablero.
            if (out.ok) await clasificarConversacion({ entrada: { etiqueta: 'SOLICITUD' }, contacto }).catch(() => {})
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
    }

    salida = textos.join('\n\n').trim() || null

    return { texto: salida, tokensEntrada: tokIn, tokensSalida: tokOut, herramientas: usadas, cache }
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
