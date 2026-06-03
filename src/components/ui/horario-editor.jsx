import { Input } from '@/components/ui/input'

const DIAS = [
  { key: 'lun', label: 'Lunes' },
  { key: 'mar', label: 'Martes' },
  { key: 'mié', label: 'Miércoles' },
  { key: 'jue', label: 'Jueves' },
  { key: 'vie', label: 'Viernes' },
  { key: 'sáb', label: 'Sábado' },
  { key: 'dom', label: 'Domingo' },
]

// value: { lun: { apertura: '08:00', cierre: '18:00' }, ... }
// días ausentes = cerrado
// 24/7 se representa con los 7 días en 00:00–23:59
function es24_7(value) {
  return DIAS.every(({ key }) =>
    value[key]?.apertura === '00:00' && value[key]?.cierre === '23:59'
  )
}

export function HorarioEditor({ value = {}, onChange }) {
  const activo24_7 = es24_7(value)

  function toggle24_7() {
    if (activo24_7) {
      // Desmarcar 24/7 → limpiar todo
      onChange({})
    } else {
      // Marcar 24/7 → todos los días 00:00–23:59
      const next = {}
      DIAS.forEach(({ key }) => { next[key] = { apertura: '00:00', cierre: '23:59' } })
      onChange(next)
    }
  }

  function toggle(dia) {
    const next = { ...value }
    if (next[dia]) {
      delete next[dia]
    } else {
      next[dia] = { apertura: '08:00', cierre: '18:00' }
    }
    onChange(next)
  }

  function updateHora(dia, campo, hora) {
    onChange({ ...value, [dia]: { ...(value[dia] || {}), [campo]: hora } })
  }

  return (
    <div className="space-y-2">
      {/* Checkbox 24/7 */}
      <label className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer select-none border transition-colors"
        style={activo24_7
          ? { background: '#F0FDF4', borderColor: '#86EFAC' }
          : { background: '#F9FAFB', borderColor: '#E5E7EB' }}>
        <input
          type="checkbox"
          checked={activo24_7}
          onChange={toggle24_7}
          className="w-4 h-4 rounded cursor-pointer accent-[#16A34A]"
        />
        <span className={`text-[13px] font-bold ${activo24_7 ? 'text-green-800' : 'text-gray-500'}`}>
          🕐 24 / 7 — Abierto todos los días, todo el día
        </span>
      </label>

      {/* Días individuales */}
      <div className={`space-y-1 ${activo24_7 ? 'opacity-40 pointer-events-none' : ''}`}>
      {DIAS.map(({ key, label }) => {
        const activo = !!value[key]
        const datos  = value[key] || { apertura: '08:00', cierre: '18:00' }
        return (
          <div key={key} className="flex items-center gap-3 py-1">
            <label className="flex items-center gap-2 w-[100px] cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={activo}
                onChange={() => toggle(key)}
                className="w-4 h-4 rounded cursor-pointer accent-[#1A5CD8]"
              />
              <span className={`text-[13px] font-semibold ${activo ? 'text-gray-800' : 'text-gray-400'}`}>
                {label}
              </span>
            </label>

            {activo ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  type="time"
                  value={datos.apertura || ''}
                  onChange={e => updateHora(key, 'apertura', e.target.value)}
                  className="w-[110px] text-[13px]"
                />
                <span className="text-gray-400 text-sm shrink-0">–</span>
                <Input
                  type="time"
                  value={datos.cierre || ''}
                  onChange={e => updateHora(key, 'cierre', e.target.value)}
                  className="w-[110px] text-[13px]"
                />
              </div>
            ) : (
              <span className="text-[12px] text-gray-300 italic">Cerrado</span>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

// Resumen compacto para mostrar en tablas
export function resumenHorario(h) {
  if (!h || typeof h !== 'object') return '—'
  if (es24_7(h)) return '24/7'
  const orden = ['lun','mar','mié','jue','vie','sáb','dom']
  const activos = orden.filter(d => h[d])
  if (activos.length === 0) return '—'
  const prim = h[activos[0]]
  const mismoHorario = activos.every(
    d => h[d].apertura === prim.apertura && h[d].cierre === prim.cierre
  )
  const dias = activos.join(', ')
  const horas = prim.apertura && prim.cierre ? ` ${prim.apertura}–${prim.cierre}` : ''
  return mismoHorario
    ? `${dias}${horas}`
    : activos.map(d => `${d} ${h[d].apertura}–${h[d].cierre}`).join(' · ')
}
