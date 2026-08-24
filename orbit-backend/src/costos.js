// El libro de cuentas de la IA: qué se gastó, en qué y cuánto costó.
//
// 🩸 POR QUÉ EXISTE: el 2026-08-21 se agotó el saldo de la API de Claude y nos
// enteramos porque una clínica escribió y el agente no contestó. El Console de
// Anthropic dice el total del mes, pero no si se fue en el chat, en una llamada
// de voz o en una campaña — y sin eso no se puede decidir nada.
//
// ⚠️ REGLA DE ORO DE ESTE MÓDULO: **nada de aquí puede tumbar al agente**.
// Contar el gasto es importante; contestarle a una veterinaria lo es más. Todas
// las funciones que se llaman desde el camino caliente atrapan sus propios
// errores y siguen. Si un día deja de registrar, se verá como un hueco en el
// panel, nunca como un mensaje sin responder.
import { pool, log } from './db.js'

const MOD = '[costos]'

// ── Precios ───────────────────────────────────────────────────────────────
//
// Se leen de la tabla, no del código: los precios cambian (Sonnet 5 tiene
// tarifa de lanzamiento hasta el 31-ago) y un número quemado calcularía plata
// mal sin que nadie lo note. Se guardan en memoria un rato porque se consultan
// en cada respuesta del agente y no cambian casi nunca.
let cachePrecios = null
let cachePreciosHasta = 0

async function precios() {
  if (cachePrecios && Date.now() < cachePreciosHasta) return cachePrecios
  const { rows } = await pool.query(
    `SELECT proveedor, clave, concepto, usd::float8 AS usd, por, vigente_desde
       FROM public.costos_precios ORDER BY vigente_desde`
  )
  cachePrecios = rows
  cachePreciosHasta = Date.now() + 5 * 60_000
  return rows
}

/** Olvida lo memorizado: se llama al editar un precio desde la pantalla. */
export function olvidarPrecios() {
  cachePrecios = null
  cachePreciosHasta = 0
}

/**
 * El precio que estaba vigente ESE día, no el de hoy.
 *
 * Importa de verdad: si el 1 de septiembre sube la tarifa de Sonnet, lo que se
 * gastó en agosto se sigue explicando con el precio de agosto. Recalcular el
 * pasado con el precio nuevo daría un total que no cuadra con ninguna factura.
 */
/**
 * El id del modelo, sin la fecha.
 *
 * 🩸 UN FALLO QUE DEJABA EL COSTO EN CERO. En la petición puede viajar
 * `claude-haiku-4-5-20251001` mientras la tabla guarda `claude-haiku-4-5`: no
 * casaban, no había precio, y el renglón se apuntaba con costo 0. El panel
 * seguía enseñando un número perfectamente creíble y equivocado.
 *
 * Se normaliza aquí y no con filas duplicadas en la tabla: mantener dos por
 * modelo es garantizar que un día se olvide una.
 */
function sinFecha(clave) {
  return String(clave || '').replace(/-\d{8}$/, '')
}

function precioVigente(lista, proveedor, clave, concepto, cuando) {
  const dia = (cuando instanceof Date ? cuando : new Date(cuando)).toISOString().slice(0, 10)
  const buscada = sinFecha(clave)
  let elegido = null
  for (const p of lista) {
    if (p.proveedor !== proveedor || sinFecha(p.clave) !== buscada || p.concepto !== concepto) continue
    const desde = p.vigente_desde instanceof Date
      ? p.vigente_desde.toISOString().slice(0, 10)
      : String(p.vigente_desde).slice(0, 10)
    if (desde <= dia) elegido = p        // la lista viene ordenada por fecha
  }
  return elegido
}

function aplicar(precio, cantidad) {
  if (!precio || !cantidad) return 0
  return precio.por === 'MILLON' ? (cantidad * precio.usd) / 1_000_000 : cantidad * precio.usd
}

/**
 * Pesos por dólar, según la tabla de precios.
 *
 * Vive con los precios y no en una constante porque hace falta en dos sitios
 * (convertir lo que factura Meta, y mostrar magnitudes en la pantalla) y tener
 * dos números distintos para lo mismo es la forma segura de que un día no
 * cuadren.
 */
export async function trm() {
  const lista = await precios()
  const p = precioVigente(lista, 'SISTEMA', 'TRM', 'COP_POR_USD', new Date())
  return p?.usd || 4000
}

// ── Registrar consumo ─────────────────────────────────────────────────────

/**
 * Apunta una cosa que costó dinero.
 *
 * El costo se calcula AQUÍ y se guarda en el renglón. Calcularlo al consultar
 * sería más elegante y estaría mal: el gasto de ayer no cambia de valor porque
 * hoy suba el precio.
 *
 * No espera a nada ni devuelve nada útil: quien llama sigue con lo suyo.
 */
export async function registrar({
  proveedor, canal, clave = null, agenteId = null, referencia = null,
  tokensEntrada = 0, tokensSalida = 0, cacheEscritura = 0, cacheLectura = 0,
  caracteres = 0, unidades = 0, detalle = {}, ocurridoEn = null,
  origenUnico = null, costoUsd = null,
}) {
  try {
    // Un intento que falló antes de consumir nada (el 400 de saldo agotado, sin
    // ir más lejos) no es un gasto. Apuntarlo sumaría "respuestas" que nunca
    // existieron y el promedio por conversación saldría bajo sin motivo.
    const algo = tokensEntrada || tokensSalida || cacheEscritura || cacheLectura
               || caracteres || unidades
    if (!algo && costoUsd === null) return

    const cuando = ocurridoEn || new Date()
    let costo = costoUsd

    if (costo === null) {
      const lista = await precios()
      const p = (concepto) => precioVigente(lista, proveedor, clave, concepto, cuando)
      costo = aplicar(p('ENTRADA'), tokensEntrada)
            + aplicar(p('SALIDA'), tokensSalida)
            + aplicar(p('CACHE_ESCRITURA'), cacheEscritura)
            + aplicar(p('CACHE_LECTURA'), cacheLectura)
            + aplicar(p('CARACTER'), caracteres)
            + aplicar(p('MENSAJE'), unidades)
    }

    await pool.query(
      `INSERT INTO public.costos_uso
         (ocurrido_en, proveedor, canal, agente_id, referencia, clave,
          tokens_entrada, tokens_salida, cache_escritura, cache_lectura,
          caracteres, unidades, costo_usd, detalle, origen_unico)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
       ON CONFLICT (origen_unico) DO UPDATE SET
         unidades  = EXCLUDED.unidades,
         costo_usd = EXCLUDED.costo_usd,
         detalle   = EXCLUDED.detalle`,
      [
        cuando, proveedor, canal, agenteId, referencia, clave,
        Math.round(tokensEntrada) || 0, Math.round(tokensSalida) || 0,
        Math.round(cacheEscritura) || 0, Math.round(cacheLectura) || 0,
        Math.round(caracteres) || 0, unidades || 0, costo || 0,
        JSON.stringify(detalle || {}), origenUnico,
      ]
    )
  } catch (e) {
    // Ver la regla de oro arriba: esto no puede romper nada.
    log(MOD, 'no se pudo apuntar el consumo —', e.message)
  }
}

// ── Lo que ve la pantalla ─────────────────────────────────────────────────

/**
 * El resumen del periodo: total, desglose por proveedor, por canal, por día, y
 * las conversaciones que más costaron.
 *
 * Todo agregado en SQL a propósito: traerse los renglones a React y sumar allí
 * se rompe solo en cuanto haya volumen — y ya nos pasó con los reportes, donde
 * `PGRST_DB_MAX_ROWS` cortaba la consulta sin avisar.
 */
export async function resumen({ desde, hasta, granularidad = 'DIA' }) {
  const rango = [desde, hasta]
  const paso = granularidad === 'HORA' ? 'hour' : 'day'
  // El eje se devuelve como TEXTO ya formado, no como fecha.
  // 🩸 Si se devuelve una marca de tiempo sin zona, el navegador la vuelve a
  // interpretar en SU zona y el gráfico se desplaza cinco horas — justo el
  // error que hace que el gasto de la noche aparezca al día siguiente.
  const molde = granularidad === 'HORA' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD'

  const [total, porProveedor, porCanal, porDia, caras, hoy] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(costo_usd), 0)::float8 AS usd, COUNT(*)::int AS eventos
         FROM public.costos_uso WHERE ocurrido_en >= $1 AND ocurrido_en < $2`, rango),

    pool.query(
      `SELECT proveedor,
              COALESCE(SUM(costo_usd), 0)::float8 AS usd,
              COUNT(*)::int                       AS eventos,
              COALESCE(SUM(tokens_entrada + tokens_salida + cache_escritura + cache_lectura), 0)::bigint AS tokens,
              COALESCE(SUM(caracteres), 0)::bigint AS caracteres,
              COALESCE(SUM(unidades), 0)::float8   AS unidades
         FROM public.costos_uso WHERE ocurrido_en >= $1 AND ocurrido_en < $2
        GROUP BY 1 ORDER BY 2 DESC`, rango),

    pool.query(
      `SELECT canal, proveedor,
              COALESCE(SUM(costo_usd), 0)::float8 AS usd,
              COUNT(*)::int AS eventos
         FROM public.costos_uso WHERE ocurrido_en >= $1 AND ocurrido_en < $2
        GROUP BY 1, 2 ORDER BY 3 DESC`, rango),

    pool.query(
      // Se agrupa en hora de Bogotá, no en UTC: si no, lo que se gasta de noche
      // se contabiliza al día siguiente y el gráfico miente.
      `SELECT to_char(date_trunc('${paso}', ocurrido_en AT TIME ZONE 'America/Bogota'), '${molde}') AS dia,
              COALESCE(SUM(costo_usd), 0)::float8 AS usd,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'ANTHROPIC'),  0)::float8 AS anthropic,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'ELEVENLABS'), 0)::float8 AS elevenlabs,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'META'),       0)::float8 AS meta
         FROM public.costos_uso WHERE ocurrido_en >= $1 AND ocurrido_en < $2
        GROUP BY 1 ORDER BY 1`, rango),

    pool.query(
      `SELECT referencia, canal,
              COALESCE(SUM(costo_usd), 0)::float8 AS usd,
              COUNT(*)::int AS eventos
         FROM public.costos_uso
        WHERE ocurrido_en >= $1 AND ocurrido_en < $2 AND referencia IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`, rango),

    // ── Lo de HOY, siempre ──
    // Va aparte del periodo elegido a propósito: la pregunta "¿cómo vamos hoy?"
    // no debería obligar a cambiar el filtro y perder de vista el mes. Se
    // calcula contra el día de Bogotá, que es el que vive quien lo mira.
    pool.query(
      `SELECT COALESCE(SUM(costo_usd), 0)::float8 AS usd,
              COUNT(*)::int AS eventos,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'ANTHROPIC'),  0)::float8 AS anthropic,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'ELEVENLABS'), 0)::float8 AS elevenlabs,
              COALESCE(SUM(costo_usd) FILTER (WHERE proveedor = 'META'),       0)::float8 AS meta
         FROM public.costos_uso
        WHERE (ocurrido_en AT TIME ZONE 'America/Bogota')::date
              = (now() AT TIME ZONE 'America/Bogota')::date`),
  ])

  return {
    total:        total.rows[0],
    porProveedor: porProveedor.rows,
    porCanal:     porCanal.rows,
    porDia:       porDia.rows,
    caras:        caras.rows,
    hoy:          hoy.rows[0],
    granularidad,
  }
}

/** La lista de precios, para verla y editarla desde la pantalla. */
export async function listaPrecios() {
  const { rows } = await pool.query(
    `SELECT id, proveedor, clave, concepto, usd::float8 AS usd, por, vigente_desde, nota
       FROM public.costos_precios
      ORDER BY proveedor, clave, concepto, vigente_desde DESC`
  )
  return rows
}

export async function guardarPrecio({ id, usd, nota }) {
  await pool.query(
    `UPDATE public.costos_precios SET usd = $2, nota = COALESCE($3, nota) WHERE id = $1`,
    [id, usd, nota ?? null]
  )
  olvidarPrecios()
}

// ── Lo que hay que ir a buscarle a cada proveedor ─────────────────────────

/**
 * La cuota de ElevenLabs, según ellos mismos.
 *
 * Es el único de los tres que dice cuánto queda. Anthropic no expone el saldo
 * con una llave normal (haría falta una de administración), así que ese número
 * sigue viviendo solo en su Console — y por eso el panel avisa de eso en vez de
 * fingir que lo sabe.
 */
export async function saldoElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return { error: 'Falta ELEVENLABS_API_KEY' }
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
    })
    if (!r.ok) return { error: `ElevenLabs devolvió ${r.status}` }
    const d = await r.json()
    return {
      plan:      d.tier,
      usados:    d.character_count,
      limite:    d.character_limit,
      reinicia:  d.next_character_count_reset_unix
        ? new Date(d.next_character_count_reset_unix * 1000).toISOString().slice(0, 10)
        : null,
    }
  } catch (e) {
    return { error: e.message }
  }
}

/**
 * Trae de Meta lo que de verdad cobró por mensajes, día por día.
 *
 * 🩸 ESTE NO SE PUEDE CALCULAR AQUÍ. Meta cobra por categoría de conversación y
 * las tarifas cambian por país y por mes; cualquier cuenta nuestra sería una
 * aproximación presentada como si fuera una factura. Su API devuelve el número
 * bueno, así que se guarda tal cual y punto.
 *
 * Se puede repetir sin miedo: cada día se guarda con una clave única y volver a
 * pedirlo ACTUALIZA el renglón en vez de duplicarlo. Hace falta, porque el día
 * en curso todavía está creciendo.
 */
export async function sincronizarMeta({ dias = 30 } = {}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const waba  = process.env.WHATSAPP_WABA_ID
  const v     = process.env.WHATSAPP_API_VERSION || 'v26.0'
  if (!token || !waba) return { error: 'Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_WABA_ID' }

  const hasta = Math.floor(Date.now() / 1000)
  const desde = hasta - dias * 86400
  const campo = `pricing_analytics.start(${desde}).end(${hasta}).granularity(DAILY)`

  try {
    const r = await fetch(
      `https://graph.facebook.com/${v}/${waba}?fields=${encodeURIComponent(campo)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!r.ok || d?.error) return { error: d?.error?.message || `Meta devolvió ${r.status}` }

    const puntos = d?.pricing_analytics?.data?.[0]?.data_points || []
    // ⚠️ Meta factura en PESOS (el campo `currency` de la WABA dice COP). Meter
    // ese número tal cual en una columna de dólares daría un total falso por
    // varios miles de veces, y encima creíble a primera vista.
    const tasa = await trm()
    let guardados = 0
    for (const p of puntos) {
      const cuando = new Date(p.start * 1000)
      const cop = p.cost || 0
      await registrar({
        proveedor:   'META',
        canal:       'CHAT',
        clave:       'whatsapp',
        ocurridoEn:  cuando,
        unidades:    p.volume || 0,
        costoUsd:    cop / tasa,
        origenUnico: `meta:${cuando.toISOString().slice(0, 10)}`,
        // El importe original se guarda entero: convertir no puede perder el
        // dato de partida, que es el que aparece en la factura de Meta.
        detalle:     { cop, moneda: 'COP', trm: tasa, volumen: p.volume },
      })
      guardados++
    }
    log(MOD, `Meta: ${guardados} día(s) de facturación al día`)
    return { ok: true, dias: guardados }
  } catch (e) {
    log(MOD, 'no se pudo consultar a Meta —', e.message)
    return { error: e.message }
  }
}

/**
 * Refresca lo de Meta si hace falta, sin hacer esperar a nadie.
 *
 * Se llama al abrir el panel. Va SIN await a propósito: quien mira la pantalla
 * ve los datos que ya hay —al instante— y la próxima vez ya están frescos.
 * Meterlo en el camino de la consulta añadiría un viaje a Graph API cada vez
 * que alguien mira el panel, para un dato que cambia una vez al día.
 *
 * Sin esto habría que acordarse de pulsar un botón, y un panel de costos que
 * depende de que alguien se acuerde es un panel que un día miente.
 */
let ultimaMeta = 0

export function refrescarMetaSiHaceFalta() {
  if (Date.now() - ultimaMeta < 6 * 3600_000) return
  ultimaMeta = Date.now()
  sincronizarMeta({ dias: 7 }).catch(() => {})
}
