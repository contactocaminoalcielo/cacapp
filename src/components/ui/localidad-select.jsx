import { useState, useRef, useEffect } from 'react'

export const LOCALIDADES_BOGOTA = [
  'Antonio Nariño',
  'Barrios Unidos',
  'Bosa',
  'Chapinero',
  'Ciudad Bolívar',
  'Engativá',
  'Fontibón',
  'Kennedy',
  'La Candelaria',
  'Los Mártires',
  'Puente Aranda',
  'Rafael Uribe Uribe',
  'San Cristóbal',
  'Santa Fe',
  'Suba',
  'Sumapaz',
  'Teusaquillo',
  'Tunjuelito',
  'Usaquén',
  'Usme',
]

// Estilo base idéntico al componente Input/Select del sistema
const BASE =
  'w-full px-3 py-2 text-[13px] font-medium text-gray-900 bg-white ' +
  'border border-gray-200 rounded-lg ' +
  'outline-none transition-all duration-150 ' +
  'focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10'

export function LocalidadSelect({
  value = '',
  onChange,
  placeholder = 'Seleccionar localidad…',
  className = '',
}) {
  const [query, setQuery]       = useState('')
  const [showList, setShowList] = useState(false)
  const wrapRef                 = useRef(null)

  // Filtrar localidades según búsqueda
  const filtradas = LOCALIDADES_BOGOTA.filter(l =>
    !query.trim() ||
    l.toLowerCase()
     .normalize('NFD').replace(/[̀-ͯ]/g, '')
     .includes(
       query.toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
     )
  )

  // Cerrar lista al hacer clic fuera
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowList(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSelect(loc) {
    onChange(loc)
    setShowList(false)
    setQuery('')
  }

  function handleClear(e) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setShowList(false)
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>

      {/* ── Caja principal (siempre visible) ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          border: `1.5px solid ${showList ? '#1A5CD8' : '#E5E7EB'}`,
          borderRadius: 8, background: '#fff',
          boxShadow: showList ? '0 0 0 3px rgba(26,92,216,0.1)' : 'none',
          cursor: 'pointer', minHeight: 38,
        }}
        onClick={() => setShowList(s => !s)}
      >
        <span
          className="flex-1 px-3 py-2 text-[13px] select-none truncate"
          style={{ color: value ? '#111827' : '#9CA3AF' }}
        >
          {value || placeholder}
        </span>

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="px-1.5 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}

        <span className="px-2 text-gray-400 text-[11px]">
          {showList ? '▲' : '▼'}
        </span>
      </div>

      {/* ── Lista desplegable (flotante, sobre el contenido) ── */}
      {showList && (
        <div
          className="absolute w-full bg-white rounded-xl border shadow-lg mt-1"
          style={{ borderColor: '#E5E7EB', zIndex: 9999, left: 0, minWidth: 200 }}
        >
          {/* Búsqueda */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Escribe para buscar…"
              className="w-full px-3 py-1.5 text-[12px] rounded-lg border border-gray-200 outline-none bg-gray-50 focus:border-[#1A5CD8]"
            />
          </div>

          {/* Opciones */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtradas.length === 0 ? (
              <p className="text-center py-3 text-[12px] text-gray-400">
                Sin resultados
              </p>
            ) : (
              filtradas.map(loc => (
                <button
                  key={loc}
                  type="button"
                  onClick={e => { e.stopPropagation(); handleSelect(loc) }}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 transition-colors"
                  style={{
                    background:  value === loc ? '#EEF3FB' : '',
                    color:       value === loc ? '#1A5CD8' : '#111827',
                    fontWeight:  value === loc ? 600 : 400,
                    borderBottom: '1px solid #F9FAFB',
                  }}
                >
                  {value === loc && <span className="mr-1.5">✓</span>}
                  {loc}
                </button>
              ))
            )}
          </div>

          {/* Cerrar */}
          <div className="border-t border-gray-100 px-3 py-1.5 text-center">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setShowList(false); setQuery('') }}
              className="text-[11px] text-gray-400 hover:text-gray-600"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
