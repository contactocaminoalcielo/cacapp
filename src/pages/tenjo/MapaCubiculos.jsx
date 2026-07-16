// Mapa de cubículos de Tenjo — "puestos de cine".
// Reutilizable: la pestaña Cubículos lo usa para gestionar, y la Jornada lo usa
// como selector al finalizar un compostaje.
// La distribución de las zonas reproduce el plano físico de la planta
// (boceto 2026-07-16): columna izquierda Morado/Gris/Naranja/Verde, derecha
// Amarillo/Azul/Rojo.
import { ZONAS_IZQ, ZONAS_DER, TALLA_KEYS, zonaCfg, tallaLbl } from '@/lib/cubiculos'

// ─── Un cubículo ─────────────────────────────────────────────────────────────
function Puesto({ cub, ocupante, seleccionado, sugerido, onClick, deshabilitado }) {
  const cfg     = zonaCfg(cub.zona)
  const ocupado = !!ocupante
  const inactivo = !cub.activo

  let estilo, clases = 'relative flex items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-150 h-8 w-8 shrink-0'
  if (inactivo) {
    estilo = { background: '#F3F4F6', color: '#9CA3AF', border: '1.5px dashed #D1D5DB' }
  } else if (ocupado) {
    estilo = { background: cfg.color, color: '#FFF', border: `1.5px solid ${cfg.color}` }
  } else {
    estilo = { background: '#FFF', color: cfg.color, border: `1.5px solid ${cfg.borde}` }
  }
  if (seleccionado) {
    estilo = { ...estilo, boxShadow: `0 0 0 2.5px #FFF, 0 0 0 4.5px ${cfg.color}`, transform: 'scale(1.12)' }
  }
  if (!deshabilitado) clases += ' cursor-pointer hover:scale-110 hover:z-10'

  const titulo = inactivo
    ? `${cub.codigo} — fuera de servicio${cub.notas ? `: ${cub.notas}` : ''}`
    : ocupado
      ? `${cub.codigo} — ${ocupante.servicios?.mascotas?.nombre || 'ocupado'}`
      : `${cub.codigo} — libre`

  return (
    <button type="button" title={titulo} disabled={deshabilitado}
      onClick={() => !deshabilitado && onClick?.(cub)}
      className={clases} style={estilo}>
      {cub.numero}
      {/* Punto guía: talla que corresponde al peso de la mascota */}
      {sugerido && !ocupado && !inactivo && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white"
          style={{ background: cfg.color }} />
      )}
    </button>
  )
}

// ─── Una zona (color) con sus filas por talla ────────────────────────────────
function Zona({ zona, cubiculos, ocupacion, seleccionado, tallaSugerida, onSelect, soloLibres }) {
  const cfg    = zonaCfg(zona)
  const deZona = cubiculos.filter(c => c.zona === zona)
  if (!deZona.length) return null

  const total   = deZona.length
  const ocupados = deZona.filter(c => ocupacion[c.id]).length
  const libres   = deZona.filter(c => c.activo && !ocupacion[c.id]).length

  return (
    <div className="rounded-2xl border p-3.5" style={{ background: cfg.bg, borderColor: cfg.borde }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: cfg.color }} />
          <span className="text-[13px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <span className="text-[10px] font-semibold text-ink3 tabular-nums">
          {libres} libre{libres !== 1 ? 's' : ''} · {ocupados}/{total} ocupados
        </span>
      </div>

      <div className="space-y-2">
        {TALLA_KEYS.map(talla => {
          const deTalla = deZona.filter(c => c.talla === talla).sort((a, b) => a.numero - b.numero)
          if (!deTalla.length) return null
          const esSugerida = tallaSugerida === talla
          return (
            <div key={talla} className="flex items-start gap-2.5">
              <div className="w-[62px] shrink-0 pt-1.5">
                <div className="text-[10px] font-bold leading-none" style={{ color: cfg.color }}>
                  {tallaLbl(talla)}
                </div>
                {esSugerida && (
                  <div className="text-[9px] font-semibold text-ink3 mt-0.5 leading-none">sugerida</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {deTalla.map(cub => {
                  const ocupante = ocupacion[cub.id]
                  // En modo selector, un ocupado o inactivo no se puede elegir
                  const bloqueado = soloLibres && (!!ocupante || !cub.activo)
                  return (
                    <Puesto key={cub.id} cub={cub} ocupante={ocupante}
                      seleccionado={seleccionado === cub.id}
                      sugerido={esSugerida}
                      deshabilitado={bloqueado}
                      onClick={onSelect} />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Leyenda ─────────────────────────────────────────────────────────────────
export function LeyendaCubiculos({ className = '' }) {
  const items = [
    { label: 'Libre',            estilo: { background: '#FFF',    color: '#2563EB', border: '1.5px solid #BFDBFE' } },
    { label: 'Ocupado',          estilo: { background: '#2563EB', color: '#FFF',    border: '1.5px solid #2563EB' } },
    { label: 'Fuera de servicio', estilo: { background: '#F3F4F6', color: '#9CA3AF', border: '1.5px dashed #D1D5DB' } },
  ]
  return (
    <div className={`flex flex-wrap items-center gap-4 ${className}`}>
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-md flex items-center justify-center text-[9px] font-bold" style={i.estilo}>1</span>
          <span className="text-[11px] text-ink3 font-medium">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * @param {Array}  cubiculos      catálogo (cargarCubiculos)
 * @param {Object} ocupacion      { cubiculo_id: item }
 * @param {string} seleccionado   id del cubículo resaltado
 * @param {string} tallaSugerida  'P' | 'M' | 'G' — resalta la fila, no bloquea
 * @param {bool}   soloLibres     modo selector: ocupados/inactivos no clicables
 */
export default function MapaCubiculos({
  cubiculos, ocupacion = {}, seleccionado, tallaSugerida, onSelect, soloLibres = false,
}) {
  const props = { cubiculos, ocupacion, seleccionado, tallaSugerida, onSelect, soloLibres }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
      <div className="space-y-3.5">
        {ZONAS_IZQ.map(z => <Zona key={z} zona={z} {...props} />)}
      </div>
      <div className="space-y-3.5">
        {ZONAS_DER.map(z => <Zona key={z} zona={z} {...props} />)}
      </div>
    </div>
  )
}
