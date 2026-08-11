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
import { enviarTexto, etiquetar } from './whatsapp-cloud.js'

const MOD = '[agente-wa]'

/** Cuántos mensajes previos se le dan como memoria de la conversación. */
const HISTORIAL = 20

/** Tope de vueltas del ciclo de herramientas dentro de UNA respuesta. */
const MAX_VUELTAS = 5

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
  const { rows: etiquetas } = await pool.query(
    `SELECT clave, nombre, descripcion FROM public.whatsapp_etiquetas
      WHERE activo ORDER BY orden, id`
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

  for (const img of piezas.filter(p => p.tipo === 'IMAGEN' && p.archivo)) {
    bloques.push({ type: 'text', text: `Imagen de referencia: ${img.titulo}` })
    bloques.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.archivo.toString('base64') },
    })
  }

  bloques[bloques.length - 1].cache_control = { type: 'ephemeral' }
  return bloques
}

/** El hilo reciente, traducido a turnos de conversación. */
async function construirHistorial(contacto) {
  const { rows } = await pool.query(
    `SELECT direccion, texto FROM public.whatsapp_mensajes
      WHERE contacto = $1 AND texto IS NOT NULL AND texto <> ''
      ORDER BY ocurrido_en DESC, id DESC
      LIMIT $2`,
    [contacto, HISTORIAL]
  )

  const mensajes = []
  for (const m of rows.reverse()) {
    const role = m.direccion === 'IN' ? 'user' : 'assistant'
    // La API rechaza turnos consecutivos del mismo rol; se fusionan.
    if (mensajes.length && mensajes[mensajes.length - 1].role === role) {
      mensajes[mensajes.length - 1].content += `\n${m.texto}`
    } else {
      mensajes.push({ role, content: m.texto })
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
 * Punto de entrada desde el webhook. NUNCA lanza: si algo falla, la bandeja
 * sigue funcionando y el coordinador responde a mano — un agente caído no
 * puede tumbar la recepción de mensajes.
 */
export async function responderSiAplica({ phoneNumberId, contacto, tipo }) {
  try {
    // Solo texto. Un audio o una imagen entran a la bandeja y los ve un humano.
    if (tipo && tipo !== 'text') return

    const agente = await agenteParaLinea(phoneNumberId)
    if (!agente) return

    // Tope por conversación: cuenta lo que YA respondió el agente aquí.
    const { rows: [{ n }] } = await pool.query(
      `SELECT count(*)::int AS n FROM public.agente_wa_ejecuciones
        WHERE agente_id = $1 AND contacto = $2 AND origen = 'WHATSAPP' AND error IS NULL`,
      [agente.id, contacto]
    )
    if (n >= agente.max_turnos) {
      log(MOD, `tope de ${agente.max_turnos} alcanzado en ${contacto} — queda para un humano`)
      return
    }

    const r = await ejecutar({ agente, contacto, origen: 'WHATSAPP' })
    if (r.texto) await enviarTexto({ contacto, texto: r.texto, personalId: null })
  } catch (e) {
    log(MOD, 'ERROR respondiendo a', contacto, '—', e.message)
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
        thinking:      { type: 'adaptive' },
        output_config: { effort: agente.effort },
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

      if (respuesta.stop_reason !== 'tool_use') break

      // Los bloques de la respuesta viajan de vuelta tal cual: quitarlos rompe
      // el emparejamiento tool_use/tool_result.
      messages.push({ role: 'assistant', content: respuesta.content })

      const resultados = []
      for (const bloque of respuesta.content.filter(b => b.type === 'tool_use')) {
        usadas.push(bloque.name)
        let out
        try {
          if (bloque.name === 'registrar_solicitud') {
            out = await registrarSolicitud({ entrada: bloque.input, agente, contacto })
            // La solicitud tiene su propia etiqueta: si el agente no la pone, la
            // conversación que MÁS importa quedaría fuera del tablero.
            if (out.ok) await clasificarConversacion({ entrada: { etiqueta: 'SOLICITUD' }, contacto }).catch(() => {})
          } else if (bloque.name === 'clasificar_conversacion') {
            out = await clasificarConversacion({ entrada: bloque.input, contacto })
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

    salida = (respuesta?.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || null

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
        JSON.stringify({ usadas, ms: Date.now() - inicio, cache }),
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
