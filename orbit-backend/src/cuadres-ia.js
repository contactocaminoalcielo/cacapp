// Asistente IA del cuadre de técnicos (Finanzas › Cuadre): explica y prioriza
// los pendientes de un cuadre leyendo también las notas libres del técnico y
// las novedades de cada servicio. Solo lectura + texto sugerido; el humano
// confirma cada estado. No escribe nada en la DB.
import { pool } from './db.js'
import { llamarClaude } from './ia.js'

const SYSTEM = `Eres ORBIT, el asistente operativo de Camino al Cielo (funeraria de mascotas, Bogotá).
Ayudas a GERENCIA a hacer el cuadre de cuentas con un técnico de recogidas. Eres claro, breve y
concreto: escribes para una persona no técnica. Nunca inventas datos ni montos: todo lo que digas
debe salir de los datos entregados. Nunca afirmas haber hecho o cambiado algo: solo explicas y
sugieres; la persona confirma cada estado en la pantalla.
Regla del cuadre: cada servicio tiene un valor NETO (lo que paga el cliente) y un BRUTO
(neto + comisión de la veterinaria). Si lo recogido está entre neto y bruto la fila está CUADRADA
(la comisión descontada NO es plata que falte). Solo falta plata si recogió MENOS que el neto;
recogió "de más" solo si supera el bruto. Facturación mensual: el técnico no recoge esa plata,
el aliado la debe con la factura del mes. "Sin recibo": el técnico recogió la mascota pero no
cobró — hay que gestionar ese cobro. Respondes en español de Colombia, con montos en pesos.`

const num = v => Number(v) || 0
const trunca = (s, n) => {
  const t = (s == null ? '' : String(s)).trim()
  if (!t) return null
  return t.length > n ? t.slice(0, n) + '…' : t
}

export async function analizarCuadre({ cuadreId }) {
  if (!cuadreId) return { status: 400, body: { error: 'Falta cuadre_id' } }
  const client = await pool.connect()
  try {
    const { rows: cabRows } = await client.query(
      `SELECT c.*, trim(p.nombre || ' ' || COALESCE(p.apellido, '')) AS tecnico_nombre
       FROM public.cuadres_tecnico c
       LEFT JOIN public.personal p ON p.id = c.tecnico_id
       WHERE c.id = $1`,
      [cuadreId]
    )
    const cab = cabRows[0]
    if (!cab) return { status: 404, body: { error: 'Cuadre no encontrado' } }

    const { rows: itemRows } = await client.query(
      `SELECT * FROM public.cuadre_items WHERE cuadre_id = $1 ORDER BY fecha, hora`,
      [cuadreId]
    )
    if (!itemRows.length) {
      return { status: 200, body: { analisis: 'Este cuadre no tiene servicios: no hay nada que revisar.', generado_en: new Date().toISOString() } }
    }

    const svcIds = [...new Set(itemRows.map(it => it.servicio_id).filter(Boolean))]

    // Comprobantes de pagos digitales (por servicio, igual que el modal del front).
    const conComprobante = new Set()
    if (svcIds.length) {
      const { rows } = await client.query(
        `SELECT DISTINCT servicio_id FROM public.recibo_comprobantes WHERE servicio_id = ANY($1)`,
        [svcIds]
      )
      rows.forEach(r => conComprobante.add(r.servicio_id))
    }

    // Notas libres del servicio (las escribe el técnico/coordinador).
    const notasMap = {}
    if (svcIds.length) {
      const { rows } = await client.query(
        `SELECT id, notas FROM public.servicios WHERE id = ANY($1)`,
        [svcIds]
      )
      rows.forEach(r => { notasMap[r.id] = r.notas })
    }

    // Últimas 3 novedades por servicio (contexto de qué pasó con cada mascota).
    const novMap = {}
    if (svcIds.length) {
      const { rows } = await client.query(
        `SELECT servicio_id, tipo_novedad, descripcion, created_at::date AS fecha
         FROM (
           SELECT n.*, row_number() OVER (PARTITION BY n.servicio_id ORDER BY n.created_at DESC) AS rn
           FROM public.novedades_servicio n
           WHERE n.servicio_id = ANY($1)
         ) t
         WHERE rn <= 3
         ORDER BY servicio_id, fecha DESC`,
        [svcIds]
      )
      rows.forEach(r => {
        if (!novMap[r.servicio_id]) novMap[r.servicio_id] = []
        novMap[r.servicio_id].push(`[${r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : r.fecha}] ${r.tipo_novedad}: ${trunca(r.descripcion, 180)}`)
      })
    }

    // Contexto compacto por mascota (solo lo relevante para decidir).
    const items = itemRows.map(it => ({
      mascota:               it.mascota_nombre,
      fecha:                 it.fecha instanceof Date ? it.fecha.toISOString().slice(0, 10) : it.fecha,
      veterinaria:           it.veterinaria || null,
      plan:                  it.plan_nombre || null,
      neto:                  it.valor_a_recoger != null ? num(it.valor_a_recoger) : (it.valor_a_cobrar != null ? num(it.valor_a_cobrar) : null),
      bruto:                 it.valor_a_cobrar != null ? num(it.valor_a_cobrar) : null,
      comision_veterinaria:  num(it.comision) || null,
      modalidad_comision:    it.modalidad_comision || null,
      recogido:              num(it.total_cobrado),
      efectivo:              num(it.efectivo),
      digital:               num(it.digital),
      digital_con_comprobante: num(it.digital) > 0 ? conComprobante.has(it.servicio_id) : null,
      sin_recibo:            !!it.sin_recibo,
      cancelado:             !!it.es_cancelado,
      estado_revision:       it.estado_conciliacion || 'SIN_REVISAR',
      conciliacion_resuelta: !!it.conciliacion_resuelta,
      via_cobro:             it.conciliacion_via || null,
      observaciones:         trunca(it.observaciones, 200),
      notas_servicio:        trunca(notasMap[it.servicio_id], 250),
      novedades:             novMap[it.servicio_id] || [],
    }))

    const resumen = {
      tecnico:              cab.tecnico_nombre || '—',
      rango:                `${cab.fecha_desde instanceof Date ? cab.fecha_desde.toISOString().slice(0, 10) : cab.fecha_desde} a ${cab.fecha_hasta instanceof Date ? cab.fecha_hasta.toISOString().slice(0, 10) : cab.fecha_hasta}`,
      estado:               cab.estado,
      total_servicios:      num(cab.total_servicios),
      total_recogido:       num(cab.total_cobrado),
      efectivo_del_tecnico: num(cab.efectivo_recibido),
      digital_a_empresa:    num(cab.digital_empresa),
      reconocido_al_tecnico: num(cab.total_reconocido),
      ajuste_manual:        num(cab.ajustes_manuales) || undefined,
      motivo_ajuste:        cab.ajustes_motivo || undefined,
      dinero_a_entregar:    num(cab.dinero_a_entregar),
      saldo_a_favor_tecnico: num(cab.saldo_a_favor_tecnico) || undefined,
    }

    const prompt =
`Cuadre del técnico ${resumen.tecnico} (${resumen.rango}, estado ${resumen.estado}). Resumen (JSON):
${JSON.stringify(resumen)}

Detalle por mascota (JSON):
${JSON.stringify(items)}

Tarea (escribe para gerencia, sin tecnicismos):
1. Veredicto en 1-2 frases: cuánto efectivo debe entregar el técnico y cuántas mascotas están cuadradas vs. pendientes.
2. "Requiere tu atención": lista priorizada de las mascotas con algo por resolver. Para cada una: por qué (con los montos), qué dicen las notas u observaciones si explican el faltante (cítalas), y la acción sugerida (marcar "Pendiente gestionar" con vía de cobro, llamar al cliente, revisar comprobante, o "Verificado OK" si ya está saldado). Ignora las que tienen conciliacion_resuelta=true.
3. "Señales raras" solo si existen: recogido por encima del bruto, pago digital sin comprobante, o inconsistencias entre notas y montos.
No incluyas nada que no esté en los datos. Si todo está cuadrado, dilo en una frase y no inventes pendientes. Sé breve: máximo ~15 líneas.`

    const analisis = await llamarClaude({ system: SYSTEM, prompt, maxTokens: 1200, model: 'claude-opus-4-8' })
    return { status: 200, body: { analisis: analisis.trim(), generado_en: new Date().toISOString() } }
  } finally {
    client.release()
  }
}
