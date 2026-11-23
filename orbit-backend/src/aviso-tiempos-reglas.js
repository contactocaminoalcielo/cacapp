// Reglas puras del AVISO DE TIEMPOS al ingresar al cuarto frío (migr. 214) —
// sin base de datos ni Express, para probarlas con `node --test` desde la raíz
// del repo (tests/aviso-tiempos.test.mjs). aviso-tiempos.js las importa.
//
// REPORTE ORBIT 2026-11-20 (Bandeja WhatsApp): «en el momento que un servicio
// entre al cuarto frío se haga envío automático de los tiempos de entrega para
// los certificados, solicitud de imágenes y entrega de recordatorios».
//
// Tiempos dados por David el 2026-11-23:
//   · Certificado: 3 días hábiles desde la recogida, SOLO en eco-grupal, básico,
//     standard, desamparado, Ángel (y básico sin recordatorios). Premium,
//     Exclusivo y Compets no lo llevan: allí el certificado es por solicitud.
//   · Recordatorios: los días del plan +2 (`planes.dias_entrega_prometidos`, el
//     mismo «8 a 10» del aviso de plazo) DESDE QUE LLEGAN LAS FOTOS — nunca desde
//     el ingreso: el reloj lo arranca `fecha_imagenes_recibidas`.
//   · Memopet: su tiempo del catálogo (`recordatorios.tiempo_produccion_dias`, 15).
//   · Compostaje individual: el proceso toma de 2 a 3 meses; los recordatorios
//     salen con la planta, o antes si la familia los pide.

/** Cuerpo EXACTO de la plantilla en Meta. {{1}} = mascota, {{2}} = los tiempos. */
export const CUERPO_PLANTILLA =
  'Hola 🤍 Queremos contarte que {{1}} ya se encuentra bajo el cuidado de Camino al Cielo.\n\n' +
  'Para que tengas claridad, estos son los tiempos de su proceso: {{2}}\n\n' +
  'Los días hábiles van de lunes a viernes, sin festivos. Si tienes alguna inquietud, ' +
  'escríbenos por este medio. — Camino al Cielo'

export const CONFIG_DEFAULTS = {
  activo:                   false,
  plantilla:                null,
  arranque_desde:           null,
  // Los que reciben el aviso. Fuera: EXCLUSIVO_*_SIN_REC (ni certificado ni recordatorios).
  planes: [
    'ECO_GRUPAL', 'BASICO', 'STANDARD', 'DESAMPARADO', 'ANGEL', 'BASICO_SIN_REC',
    'PREMIUM', 'EXCLUSIVO_VIDEOLLAMADA', 'EXCLUSIVO_PRESENCIAL',
    'COMPETS_EVIDENCIA', 'COMPETS_PRESENCIAL', 'COMPETS_SIN_REC',
  ],
  planes_certificado:       ['ECO_GRUPAL', 'BASICO', 'STANDARD', 'DESAMPARADO', 'ANGEL', 'BASICO_SIN_REC'],
  planes_sin_recordatorios: ['DESAMPARADO', 'ANGEL', 'BASICO_SIN_REC', 'COMPETS_SIN_REC'],
  dias_certificado:         3,
  meses_compostaje:         '2 a 3',
  horas_max_atraso:         48,
  max_envios_por_corrida:   30,
}

const lista = (v, def) => {
  const x = typeof v === 'string' ? safeJson(v) : v
  return Array.isArray(x) ? x.map(String) : def
}

/** La config ya acotada. Un valor raro no puede disparar un envío masivo. */
export function reglas(cfg = {}) {
  const n = (v, def, min, max) => Math.min(Math.max(parseInt(String(v ?? '').replace(/"/g, '')) || def, min), max)
  const meses = String(cfg.meses_compostaje ?? CONFIG_DEFAULTS.meses_compostaje).replace(/"/g, '').trim()
  return {
    activo:           cfg.activo === true || cfg.activo === 'true',
    arranque:         normalizarFecha(cfg.arranque_desde),
    planes:           lista(cfg.planes, CONFIG_DEFAULTS.planes),
    certificado:      lista(cfg.planes_certificado, CONFIG_DEFAULTS.planes_certificado),
    sinRecordatorios: lista(cfg.planes_sin_recordatorios, CONFIG_DEFAULTS.planes_sin_recordatorios),
    diasCertificado:  n(cfg.dias_certificado, 3, 1, 30),
    meses:            meses || CONFIG_DEFAULTS.meses_compostaje,
    horas:            n(cfg.horas_max_atraso, 48, 1, 240),
    tope:             n(cfg.max_envios_por_corrida, 30, 1, 100),
  }
}

/** null si no hay plantilla sembrada → nadie debe enviar. */
export function plantillaAviso(cfg = {}) {
  const raw = cfg.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', categoria: p.categoria || 'UTILITY' }
}

/** «8 a 10»: los días del plan y dos de holgura (espejo de plazoEntrega en reglas-imagenes). */
export function plazo(dias) {
  const d = Number(dias) > 0 ? Math.round(Number(dias)) : 8
  return `${d} a ${d + 2}`
}

/**
 * « (el Memopet, 15 días hábiles)» si el Memopet tarda MÁS que el tope del plazo
 * del plan; si cabe dentro, no se menciona (sería ruido).
 * `conUnidad = false` → « (el Memopet, 15)», para textos donde «días hábiles» ya
 * viene después (el aviso de plazo y la pantalla de Gracias del portal).
 */
export function notaMemopet(diasPlan, diasMemopet, conUnidad = true) {
  const d = Number(diasPlan) > 0 ? Math.round(Number(diasPlan)) : 8
  const m = Math.round(Number(diasMemopet) || 0)
  if (m <= d + 2) return ''
  return conUnidad ? ` (el Memopet, ${m} días hábiles)` : ` (el Memopet, ${m})`
}

/**
 * El {{2}} de la plantilla: los tiempos que aplican a ESTE servicio, en una sola
 * línea (Meta rechaza saltos de línea dentro de una variable).
 * Devuelve '' si no hay nada que contar — ese servicio no recibe el aviso.
 *
 * `d` = { plan, tipoProceso, diasPlan, fotosRecibidas, anticipados,
 *         enlaceEnviado, diasMemopet }
 */
export function textoTiempos(d, r = reglas()) {
  const partes = []
  const compostaje = d.tipoProceso === 'COMPOSTAJE_INDIVIDUAL'

  if (r.certificado.includes(d.plan)) {
    partes.push(`📄 El certificado estará listo en ${r.diasCertificado} días hábiles a partir de la recogida.`)
  }
  if (compostaje) {
    partes.push(`🌱 El proceso de compostaje toma de ${r.meses} meses; al finalizar te entregaremos la planta.`)
  }

  if (!r.sinRecordatorios.includes(d.plan)) {
    const tiempo = `de ${plazo(d.diasPlan)} días hábiles${notaMemopet(d.diasPlan, d.diasMemopet)}`
    if (d.fotosRecibidas) {
      // Ya mandó las fotos (≈1 de cada 5 llega a la nevera así): no se le pide nada.
      partes.push(compostaje && d.anticipados !== true
        ? '🎁 Ya recibimos tus fotos; los recordatorios te los entregaremos junto con la planta.'
        : `🎁 Ya recibimos tus fotos; los recordatorios estarán listos ${tiempo} desde que las recibimos.`)
    } else {
      const enlace = d.enlaceEnviado
        ? '📸 Ya te enviamos por este medio el enlace para compartirnos las fotos de los recordatorios'
        : '📸 Pronto te enviaremos por este medio un enlace para que nos compartas las fotos de los recordatorios'
      partes.push(compostaje
        ? `${enlace}; si deseas recibirlos antes de que termine el compostaje, estarán listos ${tiempo} después de recibir las fotos completas, y si no, te los entregamos junto con la planta.`
        : `${enlace}; estarán listos ${tiempo} después de recibir las fotos completas.`)
    }
  }
  return partes.join(' ')
}

/** El mensaje completo tal como lo ve la familia (lo que queda en la bandeja). */
export function mensajeCompleto(mascota, tiempos) {
  return CUERPO_PLANTILLA.replace('{{1}}', mascota).replace('{{2}}', tiempos)
}

/**
 * "GATURRIS" → "Gaturris". El 44 % de los nombres está en mayúsculas y en un
 * mensaje a la familia se leen como un grito. (Espejo del de condolencias.)
 */
export function nombreMascota(nombre) {
  const s = String(nombre || '').trim()
  if (!s) return 'tu mascotica'
  if (s !== s.toUpperCase() || !/\p{L}/u.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
}

export function normalizarFecha(v) {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
