import { orbitApi } from '@/lib/orbitApi'
import { petEmoji } from '@/lib/utils'
import { CheckCircle2, Camera, ImageOff, AlertCircle } from 'lucide-react'

// FILTRO «RESTOS CÁLCICOS» del tablero Producción–Diseño
// (REPORTE ORBIT 2026-11-25): ver de un vistazo las mascotas de Compets que
// compraron la recuperación y devolución de los restos cálcicos, para que no se
// omita ninguna al programar.
//
// Sale de la MISMA lista que la tarjeta de cenizarios (`/produccion/restos-
// calcicos`, migr. 205): `planta_elecciones.restos_calcicos = true`, no
// cancelada (migr. 208) y servicio sin entregar. Así el filtro y la tarjeta
// nunca cuentan distinto.
//
// 🪤 El tablero solo pinta servicios con líneas de recordatorio. Un Compets SIN
// recordatorios que compró los restos no tiene tarjeta: filtrar las tarjetas a
// secas lo escondería — justo la omisión que se quiere evitar. Por eso este
// panel lista TODAS y marca cuáles no aparecen en el tablero.

// Devuelve el arreglo, o `false` si no se pudo leer. NUNCA `[]` por un error:
// una lista vacía diría «nadie compró restos» y el filtro escondería todas las
// tarjetas justo cuando el backend está caído.
export async function cargarRestosCalcicos() {
  try {
    const r = await orbitApi('/produccion/restos-calcicos')
    return r.cenizarios || []
  } catch (e) {
    console.warn('[produccion] filtro restos cálcicos:', e?.message || e)
    return false
  }
}

const AMBAR = { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E' }

function EstadoCenizario({ f }) {
  if (f.restos_cenizario_listo_en) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#065F46]">
      <CheckCircle2 size={11} /> Cenizario listo
    </span>
  )
  if (f.restos_foto_url) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#1E40AF]">
      <Camera size={11} /> Con foto · por hacer
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B42318]">
      <ImageOff size={11} /> Sin foto
    </span>
  )
}

export function PanelRestosCalcicos({ filas, idsEnTablero }) {
  if (filas === null) return (
    <div className="mb-4 px-4 py-3 rounded-xl border text-[12px] text-ink3" style={{ borderColor: AMBAR.border, background: AMBAR.bg }}>
      Cargando mascotas con restos cálcicos…
    </div>
  )
  if (filas === false) return (
    <div className="mb-4 px-4 py-3 rounded-xl border text-[12px] font-semibold" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>
      No se pudo cargar la lista de restos cálcicos. El tablero se muestra SIN filtrar: recarga en un momento.
    </div>
  )
  const fueraDelTablero = filas.filter(f => !idsEnTablero.has(String(f.servicio_id)))
  return (
    <div className="mb-4 rounded-xl border p-4" style={{ borderColor: AMBAR.border, background: AMBAR.bg }}>
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[12px]" style={{ color: AMBAR.text }}>
        <span className="font-bold">Compets con restos cálcicos:</span>
        <span className="font-bold">{filas.length} mascota{filas.length === 1 ? '' : 's'}</span>
        {fueraDelTablero.length > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full bg-white">
            <AlertCircle size={11} /> {fueraDelTablero.length} sin tarjeta en el tablero
          </span>
        )}
      </div>
      <p className="text-[11px] mb-3" style={{ color: AMBAR.text }}>
        Recuperación y devolución de los restos cálcicos: se entregan con la planta, en un cenizario personalizado.
        Abajo, el tablero muestra solo sus recordatorios.
      </p>
      {filas.length === 0 ? (
        <div className="text-[12px] text-ink3">Ninguna mascota activa tiene restos cálcicos contratados.</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map(f => {
            const sinTarjeta = !idsEnTablero.has(String(f.servicio_id))
            return (
              <div key={f.id} className="rounded-lg bg-white border px-3 py-2"
                style={{ borderColor: sinTarjeta ? AMBAR.border : 'rgba(30,80,40,0.12)' }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>{petEmoji(f.especie)}</span>
                  <span className="text-[13px] font-bold text-ink truncate">{f.mascota}</span>
                  {f.cubiculo && <span className="ml-auto shrink-0 text-[10px] font-semibold text-ink3">Cubículo {f.cubiculo}</span>}
                </div>
                {f.propietario && <div className="text-[11px] text-ink3 truncate">{f.propietario}</div>}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                  <EstadoCenizario f={f} />
                  {f.planta_nombre && <span className="text-[10px] text-ink3">· Planta {f.planta_nombre}</span>}
                  {sinTarjeta && (
                    <span className="text-[10px] font-semibold" style={{ color: AMBAR.text }}
                      title="No tiene recordatorios en el tablero (p. ej. Compets sin recordatorios): solo aparece aquí y en la tarjeta de cenizarios.">
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
