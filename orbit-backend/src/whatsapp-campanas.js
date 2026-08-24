// Envíos masivos: una plantilla a mucha gente (migración 104).
//
// Avisar a las 203 veterinarias de que escriban por la línea nueva era,
// literalmente, 203 clics. Esto lo hace por su cuenta.
//
// 🩸 POR QUÉ NO ES UN BUCLE `for`
//
//   1. **No se puede deshacer.** Un fallo en un envío suelto es un mensaje raro
//      a una clínica; el mismo fallo aquí son 203. Por eso la lista se
//      construye ANTES, se mira, y solo entonces se arranca.
//   2. **Meta tiene cupo diario y ya no deja consultarlo.** `messaging_limit_tier`
//      dejó de exponerse (comprobado el 2026-08-19: la API lo omite sin error).
//      Solo se sabe que se topó cuando responde con un error, y entonces hay
//      que PARAR y seguir más tarde, no reintentar en bucle.
//   3. **La calidad de la línea es frágil.** Una ráfaga donde mucha gente
//      bloquea o reporta baja el `quality_rating` y Meta puede limitar el
//      número. El ritmo es un dato de cada campaña: avisar de una urgencia y
//      hacer una promoción no se mandan igual.
//   4. **El backend se reinicia.** El estado de CADA destinatario vive en la
//      tabla; quien arranque sigue donde se quedó y nadie recibe dos veces (lo
//      garantiza el UNIQUE de `(campana_id, contacto)`, no el proceso).
import { pool, log } from './db.js'
import {
  obtenerPlantilla, mandarPlantilla, valoresDeFuente, campoSirvePara,
  huecosDePlantilla, claveHueco,
  variablesDe as variablesDePlantilla,
} from './whatsapp-plantillas.js'

const MOD = '[wa-campanas]'

/**
 * Catálogo CERRADO de a quién se le puede mandar.
 *
 * Igual que el catálogo de campos (migración 097): lo que se guarda es una
 * clave, nunca SQL. Dejar que la pantalla mande una condición sería dejar
 * escribir consultas —y aquí el resultado de una consulta son mensajes reales a
 * gente real.
 *
 * `fuente` decide de dónde salen los datos de cada hueco de la plantilla.
 */
const AUDIENCIAS = [
  {
    clave: 'ALIADOS',
    etiqueta: 'Veterinarias aliadas',
    fuente: 'ALIADO',
    ayuda: 'Las clínicas activas que tienen WhatsApp registrado.',
    filtros: [
      { clave: 'ciudad', etiqueta: 'Ciudad', tipo: 'texto', ayuda: 'Vacío = todas' },
      { clave: 'vip', etiqueta: 'Solo VIP', tipo: 'si_no' },
      { clave: 'facturacion_mensual', etiqueta: 'Solo facturación mensual', tipo: 'si_no' },
    ],
    // Lo que se ve en la tabla al elegir a quién se le manda. Sin ciudad ni VIP
    // la lista son 200 nombres iguales y no hay forma de decidir.
    columnas: [
      { clave: 'nombre', etiqueta: 'Veterinaria' },
      { clave: 'ciudad', etiqueta: 'Ciudad' },
      { clave: 'vip', etiqueta: 'VIP' },
    ],
    sql: `
      SELECT a.id_aliado::text                    AS ref_id,
             a.nombre                             AS nombre,
             a.ciudad                             AS ciudad,
             CASE WHEN a.vip THEN 'Sí' ELSE '' END AS vip,
             public.fn_wa_internacional(a.whatsapp) AS contacto
        FROM public.aliados a
       WHERE a.activo
         AND public.fn_wa_internacional(a.whatsapp) IS NOT NULL
         AND ($1::text    IS NULL OR a.ciudad ILIKE '%' || $1 || '%')
         AND ($2::boolean IS NULL OR COALESCE(a.vip, false) = $2)
         AND ($3::boolean IS NULL OR COALESCE(a.facturacion_mensual, false) = $3)
       ORDER BY a.nombre`,
    params: f => [
      String(f.ciudad || '').trim() || null,
      f.vip === true ? true : null,
      f.facturacion_mensual === true ? true : null,
    ],
  },
  {
    clave: 'CLIENTES',
    etiqueta: 'Clientes (familias)',
    fuente: 'CLIENTE',
    ayuda: 'Las familias activas con WhatsApp. Por defecto se saltan las que tienen un servicio EN CURSO.',
    filtros: [
      { clave: 'meses', etiqueta: 'Solo con servicio en los últimos… (meses)', tipo: 'numero', ayuda: 'Vacío = todas, hayan venido cuando hayan venido' },
      { clave: 'ciudad', etiqueta: 'Ciudad', tipo: 'texto', ayuda: 'Vacío = todas' },
      {
        clave: 'incluir_en_curso', etiqueta: 'Incluir familias con un servicio en curso', tipo: 'si_no',
        ayuda: 'Déjalo sin marcar salvo que sepas lo que haces: es una familia que ahora mismo está esperando a su mascota.',
      },
    ],
    // ⚠️ La exclusión por defecto NO es una preferencia: a una familia que está
    // en mitad del servicio no se le manda una promoción. Por eso el filtro es
    // "incluir", y no marcarlo excluye — lo peligroso exige un acto explícito.
    //
    // Nunca `CURRENT_DATE`: la base corre en UTC y en Colombia eso se corre un
    // día. Ver la nota `feedback_fechas_date_utc`.
    columnas: [
      { clave: 'nombre', etiqueta: 'Familia' },
      { clave: 'mascota', etiqueta: 'Mascota' },
      { clave: 'ciudad', etiqueta: 'Ciudad' },
      { clave: 'ultimo', etiqueta: 'Último servicio' },
    ],
    sql: `
      SELECT c.id_cliente::text                     AS ref_id,
             TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS nombre,
             ult.mascota                            AS mascota,
             c.ciudad                               AS ciudad,
             ult.fecha::text                        AS ultimo,
             public.fn_wa_internacional(c.whatsapp) AS contacto
        FROM public.clientes c
        LEFT JOIN LATERAL (
          SELECT m.nombre AS mascota, s.fecha_ingreso AS fecha
            FROM public.mascotas m
            LEFT JOIN public.servicios s ON s.mascota_id = m.id_mascota
           WHERE m.cliente_id = c.id_cliente
           ORDER BY s.fecha_ingreso DESC NULLS LAST, m.created_at DESC
           LIMIT 1
        ) ult ON TRUE
       WHERE c.activo
         AND public.fn_wa_internacional(c.whatsapp) IS NOT NULL
         AND ($1::int IS NULL OR EXISTS (
               SELECT 1 FROM public.mascotas m
                 JOIN public.servicios s ON s.mascota_id = m.id_mascota
                WHERE m.cliente_id = c.id_cliente
                  AND s.fecha_ingreso >= (now() AT TIME ZONE 'America/Bogota')::date
                                          - ($1::int * 30)))
         AND ($2::text IS NULL OR c.ciudad ILIKE '%' || $2 || '%')
         AND ($3::boolean IS TRUE OR NOT EXISTS (
               SELECT 1 FROM public.mascotas m
                 JOIN public.servicios s ON s.mascota_id = m.id_mascota
                WHERE m.cliente_id = c.id_cliente
                  AND s.estado NOT IN ('ENTREGADO', 'CANCELADO')))
       ORDER BY c.nombre`,
    params: f => [
      Number(f.meses) > 0 ? Number(f.meses) : null,
      String(f.ciudad || '').trim() || null,
      f.incluir_en_curso === true ? true : null,
    ],
  },
  {
    clave: 'LISTA',
    etiqueta: 'Lista de números',
    fuente: 'MANUAL',
    ayuda: 'Pegas los números o importas un archivo. Si el archivo trae más columnas —un nombre, '
      + 'una mascota, una fecha—, cada quien recibe LO SUYO; lo que no venga en el archivo se '
      + 'escribe una vez y vale para todos.',
    filtros: [
      { clave: 'numeros', etiqueta: 'Números', tipo: 'lista', ayuda: 'Uno por línea, con o sin indicativo' },
    ],
    // El nombre solo existe cuando viene de un archivo importado; en una lista
    // pegada la columna sale vacía y no estorba.
    columnas: [{ clave: 'nombre', etiqueta: 'Nombre' }],
    // Sin SQL: los destinatarios los escribe una persona. Ver `destinosDe`.
    sql: null,
    params: () => [],
  },
]

const audienciaPorClave = c => AUDIENCIAS.find(a => a.clave === c)

/**
 * Cuántos destinatarios viajan a la pantalla para elegirlos uno a uno.
 *
 * Mil filas ya son una tabla que nadie repasa entera; más allá, el navegador
 * empieza a sufrir. Si la audiencia da más, se avisa y se afina con los filtros
 * —que es lo que hay que hacer de todas formas.
 */
const TOPE_TABLA = 1000

export function listarAudiencias() {
  return {
    status: 200,
    body: {
      ok: true,
      audiencias: AUDIENCIAS.map(({ sql, params, ...a }) => a),
    },
  }
}

/** El número como lo quiere Meta. Espejo de `aInternacional` y de la función SQL. */
function aInternacional(v) {
  const d = String(v || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10 && d.startsWith('3')) return '57' + d
  return d
}

/**
 * Quiénes recibirían, sin mandar nada.
 *
 * Los que pidieron no recibir masivos se quitan AQUÍ y no al enviar: si se
 * quitaran al final, el número que se ve antes de arrancar sería mentira, y ese
 * número es lo único que se mira antes de apretar el botón.
 */
async function destinosDe(audiencia, filtros = {}) {
  const a = audienciaPorClave(audiencia)
  if (!a) return { error: `No existe la audiencia "${audiencia}"` }

  let filas
  if (a.sql) {
    const { rows } = await pool.query(a.sql, a.params(filtros))
    filas = rows
  } else if (Array.isArray(filtros.numeros) && filtros.numeros.some(n => n && typeof n === 'object')) {
    // Importado de un archivo: cada fila puede traer SUS datos (migración 117).
    // Se vuelve a validar aquí y no se confía en lo que mandó la pantalla: un
    // número mal formado no falla al importarlo, falla al enviarlo.
    filas = filtros.numeros
      .map(x => (x && typeof x === 'object' ? x : { contacto: x }))
      .map(x => ({
        ref_id: null,
        nombre: String(x.nombre || '').trim().slice(0, 120) || null,
        contacto: aInternacional(x.contacto),
        valores: valoresLimpios(x.valores),
      }))
      .filter(x => x.contacto.length >= 10)
  } else {
    // Lista pegada: una persona escribió estos números.
    const crudos = Array.isArray(filtros.numeros)
      ? filtros.numeros
      : String(filtros.numeros || '').split(/[\s,;]+/)
    filas = crudos
      .map(n => aInternacional(n))
      .filter(n => n.length >= 10)
      .map(n => ({ ref_id: null, nombre: null, contacto: n }))
  }

  // Sin repetir: dos sedes de la misma clínica con el mismo WhatsApp son un
  // solo mensaje, no dos.
  const vistos = new Set()
  const unicos = []
  for (const f of filas) {
    if (!f.contacto || vistos.has(f.contacto)) continue
    vistos.add(f.contacto)
    unicos.push(f)
  }

  const { rows: bloqueados } = await pool.query(
    `SELECT ce.contacto
       FROM public.whatsapp_conversacion_etiquetas ce
       JOIN public.whatsapp_etiquetas e ON e.id = ce.etiqueta_id
      WHERE e.clave = 'NO_MASIVOS'`
  )
  const noMolestar = new Set(bloqueados.map(b => b.contacto))

  // Qué huecos trae ya resueltos el propio archivo: son los que NO hay que
  // pedir como valor fijo. Sin esto, importar una columna "mascota" seguiría
  // exigiendo escribir una mascota igual para los 300.
  const cubiertos = new Set()
  for (const f of unicos) for (const k of Object.keys(f.valores || {})) cubiertos.add(k)

  return {
    destinos: unicos.filter(u => !noMolestar.has(u.contacto)),
    excluidos: unicos.filter(u => noMolestar.has(u.contacto)).length,
    fuente: a.fuente,
    huecosCubiertos: [...cubiertos],
  }
}

/**
 * Los datos de una fila importada, saneados.
 *
 * La clave tiene la forma `BODY:mascota` y la decide la plantilla, no el
 * archivo: aquí solo se admite lo que se parece a una clave de hueco. Guardar
 * lo que venga sería meter en la base lo que traiga un CSV de cualquier sitio.
 */
function valoresLimpios(v) {
  if (!v || typeof v !== 'object') return {}
  const out = {}
  for (const [k, valor] of Object.entries(v)) {
    if (!/^(HEADER|BODY|BUTTON|CARD:[0-9]+:(BODY|BUTTON:[0-9]+)):[A-Za-z0-9_]+$/.test(k)) continue
    const texto = String(valor ?? '').trim()
    if (texto) out[k] = texto.slice(0, 900)
  }
  return out
}

/**
 * Lo que se ve ANTES de crear la campaña: a cuántos va, a quiénes, y qué huecos
 * de la plantilla se quedarían en blanco.
 *
 * Lo tercero es lo importante: una plantilla mapeada a datos de un SERVICIO no
 * se puede rellenar cuando el destinatario es una veterinaria, y sin este aviso
 * uno se entera con 203 mensajes ya enviados.
 */
export async function previsualizar({
  audiencia, filtros = {}, plantilla, idioma = 'es_MX', agenteId = null,
}) {
  const r = await destinosDe(audiencia, filtros)
  if (r.error) return { status: 422, body: { ok: false, error: r.error } }

  const { body: { variables } } = await variablesDePlantilla({ plantilla, idioma, agenteId })
  const mapeado = new Map(variables.map(v => [`${v.destino}:${v.param ?? v.posicion}`, v.campo]))

  // 🩸 Los huecos se leen de la plantilla REAL, no del mapeo. Un hueco SIN
  // mapear no está en `whatsapp_plantilla_variables`, así que no aparecía en
  // esta lista, nadie le escribía un valor fijo y la campaña entera se iba en
  // OMITIDO al enviar —con el aviso llegando destinatario a destinatario.
  const { plantilla: enMeta } = await obtenerPlantilla(
    plantilla, idioma, process.env.WHATSAPP_ACCESS_TOKEN, await wabaDeAgente(agenteId))
  const todos = enMeta
    ? huecosDePlantilla(enMeta).map(h => ({ clave: claveHueco(h), marca: h.param ?? h.posicion }))
    // Si Meta no responde, la previa sigue saliendo con lo que se sabe: es
    // mejor que una pantalla en blanco.
    : variables.map(v => ({ clave: `${v.destino}:${v.param ?? v.posicion}`, marca: v.param ?? v.posicion }))

  const cubiertos = new Set(r.huecosCubiertos || [])
  const vistos = new Set()
  const sinFuente = todos
    .filter(h => !cubiertos.has(h.clave))
    .filter(h => !campoSirvePara(mapeado.get(h.clave), r.fuente))
    .filter(h => !vistos.has(h.marca) && vistos.add(h.marca))
    .map(h => `{{${h.marca}}}`)

  // Cómo saldría de verdad, resuelto: solo el primero. Resolver los 900 serían
  // 900 consultas para pintar una previa que nadie lee entera.
  const primero = r.destinos[0]
  const muestra = primero?.ref_id
    ? [{ ...primero, valores: (await valoresDeFuente({
        plantilla, idioma, fuente: r.fuente, refId: primero.ref_id, agenteId,
      })).valores || {} }]
    : primero ? [{ ...primero, valores: primero.valores || {} }] : []

  return {
    status: 200,
    body: {
      ok: true,
      total: r.destinos.length,
      excluidos: r.excluidos,
      fuente: r.fuente,
      columnas: audienciaPorClave(audiencia)?.columnas || [],
      // Los que el propio archivo importado ya resuelve: la pantalla los marca
      // como cubiertos en vez de pedirlos otra vez.
      huecosCubiertos: r.huecosCubiertos || [],
      // Los huecos que esta audiencia NO puede rellenar. Se escriben a mano una
      // vez (valores fijos) o la campaña saldrá con blancos.
      huecosSinDato: sinFuente,
      // La lista ENTERA: la pantalla la pinta como tabla y se elige uno por
      // uno. Un total a secas obliga a mandarle a todos o a nadie, y casi nunca
      // es lo que uno quiere.
      destinos: r.destinos.slice(0, TOPE_TABLA),
      recortada: r.destinos.length > TOPE_TABLA,
      muestra,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Crear y gobernar una campaña
// ─────────────────────────────────────────────────────────────────────────────

export async function crearCampana({
  nombre, plantilla, idioma = 'es_MX', audiencia, filtros = {},
  // Los números que se marcaron en la tabla. Sin esto iría a toda la audiencia,
  // que casi nunca es lo que se quiere: la gracia de ver la lista es poder
  // quitar a alguien.
  seleccion = null,
  valoresFijos = {}, porHora = 200, personalId = null,
  // Por qué línea sale (migración 115). Se guarda con la campaña porque una
  // campaña se crea un día y se envía otro: sin esto, al reanudarla mañana
  // saldría por la línea que estuviera primera en el `.env` ese día.
  agenteId = null,
}) {
  if (!String(nombre || '').trim()) {
    return { status: 422, body: { ok: false, error: 'Ponle un nombre: es como la vas a reconocer después' } }
  }
  if (!audienciaPorClave(audiencia)) {
    return { status: 422, body: { ok: false, error: `No existe la audiencia "${audiencia}"` } }
  }

  // Se comprueba que la plantilla exista y esté aprobada ANTES de armar la
  // lista: crear una campaña de 203 destinos contra una plantilla en revisión
  // es trabajo que no se puede usar.
  const { plantilla: p, error } = await obtenerPlantilla(
    plantilla, idioma, process.env.WHATSAPP_ACCESS_TOKEN, await wabaDeAgente(agenteId))
  if (!p) return { status: 404, body: { ok: false, error } }
  if (p.status !== 'APPROVED') {
    return { status: 409, body: { ok: false, error: `La plantilla está ${p.status}: Meta solo deja enviar las aprobadas.` } }
  }

  const r = await destinosDe(audiencia, filtros)
  if (r.error) return { status: 422, body: { ok: false, error: r.error } }

  // La lista se vuelve a calcular aquí y NO se toma la que mandó la pantalla:
  // lo que llega de fuera solo puede QUITAR gente, nunca añadir a alguien que
  // la audiencia no incluía (ni saltarse el filtro de "no enviar masivos").
  const elegidos = Array.isArray(seleccion) && seleccion.length
    ? r.destinos.filter(d => seleccion.includes(d.contacto))
    : r.destinos
  if (!elegidos.length) {
    return {
      status: 422,
      body: { ok: false, error: 'No queda nadie a quien enviar: revisa los filtros o la selección' },
    }
  }

  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    const { rows: [c] } = await cliente.query(
      `INSERT INTO public.whatsapp_campanas
         (nombre, plantilla, idioma, audiencia, filtros, valores_fijos, por_hora, creada_por, agente_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [String(nombre).trim().slice(0, 120), plantilla, idioma, audiencia,
       JSON.stringify(filtros), JSON.stringify(valoresFijos),
       Math.min(Math.max(Number(porHora) || 200, 1), 3600), personalId,
       agenteId ? Number(agenteId) : null]
    )
    // Un solo INSERT con todos: 203 idas y vueltas a la base para armar una
    // lista es tiempo que la pantalla pasa esperando sin decir nada.
    await cliente.query(
      `INSERT INTO public.whatsapp_campana_destinos (campana_id, contacto, ref_id, nombre, valores)
       SELECT $1, x.contacto, x.ref_id, x.nombre, COALESCE(x.valores, '{}'::jsonb)
         FROM jsonb_to_recordset($2::jsonb)
              AS x(contacto text, ref_id text, nombre text, valores jsonb)
       ON CONFLICT (campana_id, contacto) DO NOTHING`,
      [c.id, JSON.stringify(elegidos)]
    )
    await cliente.query('COMMIT')
    log(MOD, `campaña ${c.id} "${nombre}" creada con ${elegidos.length} destino(s)`)
    return { status: 200, body: { ok: true, id: c.id, total: elegidos.length, excluidos: r.excluidos } }
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {})
    return { status: 500, body: { ok: false, error: e.message } }
  } finally {
    cliente.release()
  }
}

/**
 * La cuenta de WhatsApp de un agente (migración 115).
 *
 * Una plantilla vive en una WABA. Si la campaña sale por la línea de otra
 * empresa, hay que buscarla en la cuenta de ESA empresa: buscarla en la del
 * `.env` diría "no existe la plantilla" con la plantilla delante.
 */
async function wabaDeAgente(agenteId) {
  if (!agenteId) return null
  const { rows: [a] } = await pool.query(
    `SELECT waba_id FROM public.agente_wa WHERE id = $1`, [Number(agenteId)]
  )
  return a?.waba_id || null
}

const CONTEOS = `
  SELECT COUNT(*)::int                                             AS total,
         COUNT(*) FILTER (WHERE estado = 'ENVIADO')::int            AS enviados,
         COUNT(*) FILTER (WHERE estado = 'FALLIDO')::int            AS fallidos,
         COUNT(*) FILTER (WHERE estado = 'OMITIDO')::int            AS omitidos,
         COUNT(*) FILTER (WHERE estado = 'PENDIENTE')::int          AS pendientes
    FROM public.whatsapp_campana_destinos WHERE campana_id = c.id`

export async function listarCampanas() {
  const { rows } = await pool.query(
    `SELECT c.*, x.* FROM public.whatsapp_campanas c, LATERAL (${CONTEOS}) x
      ORDER BY c.creada_en DESC LIMIT 100`
  )
  return { status: 200, body: { ok: true, campanas: rows } }
}

export async function detalleCampana({ id, estado = null }) {
  const { rows: [c] } = await pool.query(
    `SELECT c.*, x.* FROM public.whatsapp_campanas c, LATERAL (${CONTEOS}) x WHERE c.id = $1`,
    [Number(id)]
  )
  if (!c) return { status: 404, body: { ok: false, error: 'Esa campaña ya no existe' } }

  const { rows: destinos } = await pool.query(
    `SELECT contacto, nombre, estado, error, enviado_en
       FROM public.whatsapp_campana_destinos
      WHERE campana_id = $1 AND ($2::text IS NULL OR estado = $2)
      ORDER BY CASE estado WHEN 'FALLIDO' THEN 0 WHEN 'OMITIDO' THEN 1 ELSE 2 END,
               enviado_en DESC NULLS LAST, id
      LIMIT 300`,
    [Number(id), estado]
  )
  return { status: 200, body: { ok: true, campana: c, destinos } }
}

/**
 * Arrancar, parar, seguir o cancelar.
 *
 * "Pausar" existe porque a veces uno se da cuenta a los diez mensajes de que el
 * texto está mal. Es el freno de mano, y tiene que estar a un clic.
 */
export async function accionCampana({ id, accion, personalId = null }) {
  const { rows: [c] } = await pool.query(
    `SELECT * FROM public.whatsapp_campanas WHERE id = $1`, [Number(id)]
  )
  if (!c) return { status: 404, body: { ok: false, error: 'Esa campaña ya no existe' } }

  const paso = {
    iniciar:  { desde: ['BORRADOR', 'PAUSADA'], a: 'EN_CURSO' },
    pausar:   { desde: ['EN_CURSO'],            a: 'PAUSADA' },
    reanudar: { desde: ['PAUSADA'],             a: 'EN_CURSO' },
    cancelar: { desde: ['BORRADOR', 'EN_CURSO', 'PAUSADA'], a: 'CANCELADA' },
  }[accion]
  if (!paso) return { status: 422, body: { ok: false, error: `Acción desconocida: ${accion}` } }
  if (!paso.desde.includes(c.estado)) {
    return { status: 409, body: { ok: false, error: `Una campaña ${c.estado} no se puede ${accion}` } }
  }

  await pool.query(
    `UPDATE public.whatsapp_campanas
        SET estado = $2,
            pausa_motivo = CASE WHEN $2 = 'PAUSADA' THEN 'Pausada a mano' ELSE NULL END,
            reintentar_desde = NULL,
            iniciada_en = COALESCE(iniciada_en, CASE WHEN $2 = 'EN_CURSO' THEN now() END),
            terminada_en = CASE WHEN $2 = 'CANCELADA' THEN now() ELSE terminada_en END
      WHERE id = $1`,
    [c.id, paso.a]
  )
  log(MOD, `campaña ${c.id}: ${accion} (${c.estado} → ${paso.a})`)
  return { status: 200, body: { ok: true, estado: paso.a } }
}

export async function borrarCampana({ id }) {
  const { rows: [c] } = await pool.query(
    `SELECT estado FROM public.whatsapp_campanas WHERE id = $1`, [Number(id)]
  )
  if (!c) return { status: 404, body: { ok: false, error: 'Esa campaña ya no existe' } }
  // Una campaña que ya mandó mensajes es el registro de lo que se mandó: se
  // cancela, no se borra.
  if (c.estado !== 'BORRADOR' && c.estado !== 'CANCELADA') {
    return { status: 409, body: { ok: false, error: `Una campaña ${c.estado} no se borra: cancélala. Su historial es la prueba de a quién se le escribió.` } }
  }
  await pool.query(`DELETE FROM public.whatsapp_campanas WHERE id = $1`, [Number(id)])
  return { status: 200, body: { ok: true } }
}

// ─────────────────────────────────────────────────────────────────────────────
// El que manda: un latido cada 20 segundos
// ─────────────────────────────────────────────────────────────────────────────

const LATIDO_MS = 20_000
/** Nunca más de esto por latido, por rápida que se configure la campaña. */
const TOPE_POR_LATIDO = 25
/** Respiro entre mensajes: ni Meta ni la base ganan nada con una ráfaga. */
const RESPIRO_MS = 250

/**
 * Los errores de Meta que significan "para, no es culpa de este número".
 *
 * Distinguirlos importa: con un número que no existe hay que SEGUIR con el
 * siguiente; con el cupo agotado, seguir es gastar 200 intentos fallidos y
 * empeorar la reputación de la línea.
 */
const PARAR_Y_REINTENTAR = {
  130429: 'Meta dice que vamos muy rápido (límite de velocidad).',
  131049: 'Meta está limitando los mensajes de marketing para cuidar al usuario.',
  80007:  'Se alcanzó el límite de peticiones de la cuenta.',
}
const PARAR_A_MANO = {
  131048: 'Meta marcó la línea por spam. NO reanudes sin revisar el texto y a quién se está mandando.',
  132015: 'Meta pausó esta plantilla por mala calidad.',
  132016: 'Meta deshabilitó esta plantilla.',
  131031: 'La cuenta de WhatsApp está restringida.',
}

async function pausar(campanaId, motivo, minutos = null) {
  await pool.query(
    `UPDATE public.whatsapp_campanas
        SET estado = 'PAUSADA', pausa_motivo = $2,
            reintentar_desde = CASE WHEN $3::int IS NULL THEN NULL
                                    ELSE now() + ($3::int || ' minutes')::interval END
      WHERE id = $1`,
    [campanaId, motivo, minutos]
  )
  log(MOD, `campaña ${campanaId} PAUSADA — ${motivo}`)
}

async function unLatido() {
  // Las que se pausaron por cupo y ya les toca volver.
  await pool.query(
    `UPDATE public.whatsapp_campanas
        SET estado = 'EN_CURSO', pausa_motivo = NULL, reintentar_desde = NULL
      WHERE estado = 'PAUSADA' AND reintentar_desde IS NOT NULL AND reintentar_desde <= now()`
  )

  // Una campaña a la vez: dos a la vez se reparten el cupo diario sin que nadie
  // lo haya decidido.
  const { rows: [c] } = await pool.query(
    `SELECT * FROM public.whatsapp_campanas WHERE estado = 'EN_CURSO'
      ORDER BY iniciada_en NULLS FIRST, id LIMIT 1`
  )
  if (!c) return

  const { rows: [{ pendientes }] } = await pool.query(
    `SELECT COUNT(*)::int AS pendientes FROM public.whatsapp_campana_destinos
      WHERE campana_id = $1 AND estado = 'PENDIENTE'`, [c.id]
  )
  if (!pendientes) {
    await pool.query(
      `UPDATE public.whatsapp_campanas SET estado='TERMINADA', terminada_en=now() WHERE id=$1`, [c.id]
    )
    log(MOD, `campaña ${c.id} TERMINADA`)
    return
  }

  // El cupo se calcula mirando la última hora REAL, no un contador en memoria:
  // así un reinicio no regala una hora entera de envíos de golpe.
  const { rows: [{ ultima_hora }] } = await pool.query(
    `SELECT COUNT(*)::int AS ultima_hora FROM public.whatsapp_campana_destinos
      WHERE campana_id = $1 AND estado = 'ENVIADO' AND enviado_en > now() - interval '1 hour'`,
    [c.id]
  )
  const cupo = Math.min(c.por_hora - ultima_hora, TOPE_POR_LATIDO)
  if (cupo <= 0) return

  const { plantilla, error } = await obtenerPlantilla(
    c.plantilla, c.idioma, process.env.WHATSAPP_ACCESS_TOKEN, await wabaDeAgente(c.agente_id))
  if (!plantilla) return pausar(c.id, `No se pudo leer la plantilla: ${error}`)
  if (plantilla.status !== 'APPROVED') {
    return pausar(c.id, `La plantilla pasó a ${plantilla.status} y Meta solo deja enviar las aprobadas.`)
  }

  const audiencia = audienciaPorClave(c.audiencia)
  const fijos = c.valores_fijos || {}

  const { rows: lote } = await pool.query(
    `SELECT id, contacto, ref_id, nombre, valores FROM public.whatsapp_campana_destinos
      WHERE campana_id = $1 AND estado = 'PENDIENTE' ORDER BY id LIMIT $2`,
    [c.id, cupo]
  )

  for (const d of lote) {
    let contacto = d.contacto
    // El orden importa y es este: lo fijo es el suelo, lo que trajo el archivo
    // pisa lo fijo, y lo que se lee de Orbit ahora mismo pisa a los dos —es el
    // único dato del que sabemos que está vigente.
    const dados = { ...fijos, ...(d.valores || {}) }

    // Los datos se leen AHORA, no cuando se armó la lista: si la clínica cambió
    // de número entre una cosa y la otra, el mensaje va al nuevo. Es el bug de
    // los envíos que salían al WhatsApp viejo, y ya mordió una vez.
    if (d.ref_id && audiencia?.fuente) {
      const v = await valoresDeFuente({
        plantilla: c.plantilla, idioma: c.idioma, fuente: audiencia.fuente, refId: d.ref_id,
        agenteId: c.agente_id || null,
      })
      if (!v.ok) {
        await pool.query(
          `UPDATE public.whatsapp_campana_destinos SET estado='OMITIDO', error=$2 WHERE id=$1`,
          [d.id, v.error]
        )
        continue
      }
      Object.assign(dados, v.valores)
      if (v.contacto) contacto = v.contacto
    }

    const r = await mandarPlantilla({
      plantilla, contacto, dados, personalId: c.creada_por, agenteId: c.agente_id || null,
    })

    if (r.body.ok) {
      await pool.query(
        `UPDATE public.whatsapp_campana_destinos
            SET estado='ENVIADO', wa_message_id=$2, enviado_en=now(), error=NULL, contacto=$3
          WHERE id=$1`,
        [d.id, r.body.wa_message_id, contacto]
      )
    } else {
      const codigo = r.body.codigo
      // Un hueco vacío no es culpa del destinatario ni de Meta: es que a esta
      // audiencia le falta un dato. Se salta y se deja dicho cuál.
      const esOmision = r.status === 422
      await pool.query(
        `UPDATE public.whatsapp_campana_destinos SET estado=$2, error=$3 WHERE id=$1`,
        [d.id, esOmision ? 'OMITIDO' : 'FALLIDO', String(r.body.error || '').slice(0, 400)]
      )
      if (PARAR_A_MANO[codigo]) return pausar(c.id, PARAR_A_MANO[codigo], null)
      if (PARAR_Y_REINTENTAR[codigo]) {
        return pausar(c.id, `${PARAR_Y_REINTENTAR[codigo]} Se reanuda sola en 30 minutos.`, 30)
      }
    }

    await new Promise(r => setTimeout(r, RESPIRO_MS))
  }
}

let latiendo = false

/** Arranca el latido. Lo llama index.js al levantar el backend. */
export function arrancarCampanas() {
  setInterval(async () => {
    // Un latido que tarda más que el intervalo no debe solaparse consigo mismo:
    // dos a la vez se saltarían el cupo entre los dos.
    if (latiendo) return
    latiendo = true
    try { await unLatido() }
    catch (e) { log(MOD, 'ERROR en el latido —', e.message) }
    finally { latiendo = false }
  }, LATIDO_MS)
  log(MOD, `envíos masivos: latido cada ${LATIDO_MS / 1000}s`)
}
