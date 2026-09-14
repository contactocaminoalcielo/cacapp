// Mapa de cubículos de Tenjo — "puestos de cine".
// Reutilizable: la pestaña Cubículos lo usa para gestionar, y la Jornada lo usa
// como selector al finalizar un compostaje.
// La distribución de las zonas reproduce el plano físico de la planta
// (boceto 2026-07-16): columna izquierda Morado/Gris/Naranja/Verde, derecha
// Amarillo/Azul/Rojo.
import { ZONAS_IZQ, ZONAS_DER, TALLA_KEYS, zonaCfg, tallaLbl, cuposLibres } from '@/lib/cubiculos'

// ─── Un cubículo ─────────────────────────────────────────────────────────────
// Un cubículo puede alojar varias mascotas (migración 155): tres estados en vez
// de dos — libre, con gente pero con cupo, y lleno. Si solo se pintara
// "ocupado/libre", un cubículo de 3 con una sola mascota se leería como cerrado.
function Puesto({ cub, ocupantes = [], seleccionado, sugerido, onClick, deshabilitado }) {
  const cfg      = zonaCfg(cub.zona)
  const dentro   = ocupantes.length
  const cap      = cub.capacidad ?? 1
  const inactivo = !cub.activo
  const lleno    = dentro >= cap
  const parcial  = dentro > 0 && !lleno

  let estilo, clases = 'relative flex items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-150 h-8 w-8 shrink-0'
  if (inactivo) {
    estilo = { background: '#F3F4F6', color: '#9CA3AF', border: '1.5px dashed #D1D5DB' }
  } else if (lleno && dentro > 0) {
    estilo = { background: cfg.color, color: '#FFF', border: `1.5px solid ${cfg.color}` }
  } else if (parcial) {
    estilo = { background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.color}` }
  } else {
    estilo = { background: '#FFF', color: cfg.color, border: `1.5px solid ${cfg.borde}` }
  }
  if (seleccionado) {
    estilo = { ...estilo, boxShadow: `0 0 0 2.5px #FFF, 0 0 0 4.5px ${cfg.color}`, transform: 'scale(1.12)' }
  }
  if (!deshabilitado) clases += ' cursor-pointer hover:scale-110 hover:z-10'

  const nombres = ocupantes.map(o => o.servicios?.mascotas?.nombre).filter(Boolean).join(', ')
  const titulo = inactivo
    ? `${cub.codigo} — fuera de servicio${cub.notas ? `: ${cub.notas}` : ''}`
    : dentro > 0
      ? `${cub.codigo} — ${dentro}/${cap}${nombres ? `: ${nombres}` : ''}`
      : `${cub.codigo} — libre${cap > 1 ? ` (caben ${cap})` : ''}`

  return (
    <button type="button" title={titulo} disabled={deshabilitado}
      onClick={() => !deshabilitado && onClick?.(cub)}
      className={clases} style={estilo}>
      {cub.numero}
      {/* Cuántas van, solo si el cubículo admite más de una */}
      {cap > 1 && dentro > 0 && !inactivo && (
        <span className="absolute -bottom-1 -right-1 h-3.5 min-w-3.5 px-0.5 rounded-full text-[8px] leading-[14px] font-bold text-center ring-1 ring-white"
          style={{ background: lleno ? '#B91C1C' : cfg.color, color: '#FFF' }}>
          {dentro}
        </span>
      )}
      {/* Punto guía: talla que corresponde al peso de la mascota */}
      {sugerido && !lleno && !inactivo && (
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

  // Se cuenta por CUPOS, no por cubículos: con capacidad > 1 "3 ocupados de 12"
  // no dice nada de cuánto espacio queda de verdad.
  const total    = deZona.reduce((n, c) => n + (c.activo ? (c.capacidad ?? 1) : 0), 0)
  const ocupados = deZona.reduce((n, c) => n + (ocupacion[c.id]?.length || 0), 0)
  const libres   = deZona.reduce((n, c) => n + cuposLibres(c, ocupacion[c.id]), 0)

  return (
    <div className="rounded-2xl border p-3.5" style={{ background: cfg.bg, borderColor: cfg.borde }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: cfg.color }} />
          <span className="text-[13px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <span className="text-[10px] font-semibold text-ink3 tabular-nums">
          {libres} cupo{libres !== 1 ? 's' : ''} libre{libres !== 1 ? 's' : ''} · {ocupados}/{total} ocupados
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
                  const ocupantes = ocupacion[cub.id] || []
                  // En modo selector, uno sin cupo o inactivo no se puede elegir
                  const bloqueado = soloLibres && cuposLibres(cub, ocupantes) === 0
                  return (
                    <Puesto key={cub.id} cub={cub} ocupantes={ocupantes}
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
    { label: 'Con cupo',         estilo: { background: '#EFF6FF', color: '#2563EB', border: '1.5px solid #2563EB' } },
    { label: 'Lleno',            estilo: { background: '#2563EB', color: '#FFF',    border: '1.5px solid #2563EB' } },
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
 * @param {Object} ocupacion      { cubiculo_id: [items] }
 * @param {string} seleccionado   id del cubículo resaltado
 * @param {string} tallaSugerida  'P' | 'M' | 'G' — resalta la fila, no bloquea
 * @param {bool}   soloLibres     modo selector: sin cupo / inactivos no clicables
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
