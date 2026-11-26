import { db, dbIn, dbTodo } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, parseDate } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'

// FILTRO «ESPECIE DE PLANTA» del tablero Producción–Diseño
// (REPORTE ORBIT 2026-11-26): cuántas mascotas de Compets eligieron cada
// especie (Pescadito, Helecho…) y cuántas no han elegido, para planear la
// compra, la preparación y la entrega de las plantas conmemorativas.
//
// La base son TODOS los Compets activos (plan COMPOSTAJE_INDIVIDUAL, servicio
// sin entregar ni cancelar, desde el corte de datos), no solo los que tienen
// fila en `planta_elecciones`: la familia elige en el portal de fotos o meses
// después, y quien aún no lo hizo debe contar como «Sin seleccionar».
// Ver migraciones 149 y 176.
//
// 🪤 El tablero solo pinta servicios con líneas de recordatorio: un Compets SIN
// recordatorios no tiene tarjeta. Por eso el panel lista TODAS las mascotas de
// la opción elegida y marca cuáles no aparecen abajo (igual que el filtro de
// restos cálcicos).

export const SIN_PLANTA = '__sin__'

const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Devuelve { filas, opciones } o `false` si no se pudo leer. NUNCA vacío por un
// error: diría «nadie eligió» y el filtro escondería todo el tablero.
export async function cargarPlantasCompets() {
  try {
    const [servicios, catalogo] = await Promise.all([
      dbTodo(() => db.from('servicios')
        .select('id, fecha_ingreso, estado, mascotas ( nombre, especies ( nombre ), clientes ( nombre, apellido ) ), planes!inner ( tipo_proceso )')
        .eq('planes.tipo_proceso', 'COMPOSTAJE_INDIVIDUAL')
        .not('estado', 'in', '(ENTREGADO,CANCELADO)')
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('id')),
      db.from('plantas').select('nombre, orden').eq('elegible', true).eq('activo', true).order('orden').order('nombre'),
    ])
    if (catalogo.error) throw new Error(catalogo.error.message)
    const elecciones = await dbIn('planta_elecciones', 'servicio_id, estado, planta_nombre', 'servicio_id', servicios.map(s => s.id))
    return armarPlantasCompets(servicios, elecciones, catalogo.data || [])
  } catch (e) {
    console.warn('[produccion] filtro especie de planta:', e?.message || e)
    return false
  }
}

/**
 * Pura (se prueba sin red). Una elección CANCELADA o sin especie cuenta como
 * «Sin seleccionar». Una especie que ya no está en el catálogo (renombrada o
 * retirada) sigue apareciendo con el nombre que guardó la familia.
 */
export function armarPlantasCompets(servicios, elecciones, catalogo) {
  const porServicio = new Map(elecciones.map(e => [String(e.servicio_id), e]))
  const opciones = new Map()   // clave normalizada → { clave, nombre, n }
  for (const p of catalogo) {
    const k = normalizar(p.nombre)
    if (k && !opciones.has(k)) opciones.set(k, { clave: k, nombre: p.nombre, n: 0 })
  }
  const sin = { clave: SIN_PLANTA, nombre: 'Sin seleccionar', n: 0 }

  const filas = servicios.map(s => {
    const e = porServicio.get(String(s.id))
    const nombre = e && e.estado !== 'CANCELADA' ? String(e.planta_nombre || '').trim() : ''
    const k = nombre ? normalizar(nombre) : SIN_PLANTA
    if (k === SIN_PLANTA) sin.n++
    else {
      if (!opciones.has(k)) opciones.set(k, { clave: k, nombre, n: 0 })
      opciones.get(k).n++
    }
    const c = s.mascotas?.clientes
    return {
      servicio_id: String(s.id),
      mascota: s.mascotas?.nombre || '—',
      especie: s.mascotas?.especies?.nombre || '',
      propietario: c ? `${c.nombre || ''} ${c.apellido || ''}`.trim() : '',
      fecha_ingreso: s.fecha_ingreso,
      clave: k,
      planta: nombre || null,
    }
  }).sort((a, b) => String(a.fecha_ingreso || '').localeCompare(String(b.fecha_ingreso || '')))

  return { filas, opciones: [...opciones.values(), sin], total: filas.length }
}

/** Ids de servicio de la opción elegida, o null si no hay que filtrar. */
export function idsDeEspecie(datos, clave) {
  if (!clave || !datos) return null
  return new Set(datos.filas.filter(f => f.clave === clave).map(f => f.servicio_id))
}

const VERDE = { bg: '#F0F8F1', border: '#A7D3B0', text: '#1D6B3F' }

export function PanelEspeciePlanta({ datos, clave, onElegir, idsEnTablero }) {
  if (datos === null) return (
    <div className="mb-4 px-4 py-3 rounded-xl border text-[12px] text-ink3" style={{ borderColor: VERDE.border, background: VERDE.bg }}>
      Cargando las plantas elegidas por las familias de Compets…
    </div>
  )
  if (datos === false) return (
    <div className="mb-4 px-4 py-3 rounded-xl border text-[12px] font-semibold" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>
      No se pudo cargar la especie de planta de los Compets. El tablero se muestra SIN filtrar: recarga en un momento.
    </div>
  )
  const opcion = datos.opciones.find(o => o.clave === clave)
  const filas = datos.filas.filter(f => f.clave === clave)
  const fuera = filas.filter(f => !idsEnTablero.has(f.servicio_id)).length
  return (
    <div className="mb-4 rounded-xl border p-4" style={{ borderColor: VERDE.border, background: VERDE.bg }}>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]" style={{ color: VERDE.text }}>
        <span className="font-bold">Compets activos por especie de planta ({datos.total}):</span>
        {datos.opciones.map(o => (
          <button key={o.clave} type="button" onClick={() => onElegir(o.clave)}
            className="px-2 py-0.5 rounded-full font-semibold border transition-all"
            style={o.clave === clave
              ? { background: VERDE.text, color: '#fff', borderColor: VERDE.text }
              : { background: '#fff', color: o.clave === SIN_PLANTA ? '#6B7280' : VERDE.text, borderColor: VERDE.border }}>
            {o.clave === SIN_PLANTA ? o.nombre : `🌱 ${o.nombre}`}: {o.n}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[12px]" style={{ color: VERDE.text }}>
        <span className="font-bold">{opcion?.nombre || '—'}: {filas.length} mascota{filas.length === 1 ? '' : 's'}</span>
        {fuera > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full bg-white">
            <AlertCircle size={11} /> {fuera} sin tarjeta en el tablero
          </span>
        )}
      </div>
      {filas.length === 0 ? (
        <div className="text-[12px] text-ink3">Ningún Compets activo en esta opción.</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map(f => {
            const sinTarjeta = !idsEnTablero.has(f.servicio_id)
            return (
              <div key={f.servicio_id} className="rounded-lg bg-white border px-3 py-2"
                style={{ borderColor: sinTarjeta ? VERDE.border : 'rgba(30,80,40,0.12)' }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>{petEmoji(f.especie)}</span>
                  <span className="text-[13px] font-bold text-ink truncate">{f.mascota}</span>
                  {f.planta && <span className="ml-auto shrink-0 text-[10px] font-semibold" style={{ color: VERDE.text }}>🌱 {f.planta}</span>}
                </div>
                {f.propietario && <div className="text-[11px] text-ink3 truncate">{f.propietario}</div>}
                <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-ink3 mt-0.5">
                  {f.fecha_ingreso && <span>Ingresó {parseDate(f.fecha_ingreso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  {sinTarjeta && (
                    <span className="font-semibold" style={{ color: VERDE.text }}
                      title="No tiene recordatorios en el tablero (p. ej. Compets sin recordatorios): solo aparece aquí.">
                      · Sin recordatorios en el tablero
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
