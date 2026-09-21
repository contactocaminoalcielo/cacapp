import { useState, useRef, useEffect, useMemo } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Filtro de varias opciones, como el de una columna de Excel: se abre una lista
 * con casillas y se dejan chuleadas las que se quieren ver.
 *
 * 🔑 **Vacío = TODAS.** No es lo mismo "no he elegido nada" que "no quiero ver
 * nada": si `seleccion` está vacía el filtro no filtra, igual que en Excel con
 * todas las casillas marcadas. Por eso "Ninguno" deja la selección vacía y el
 * botón vuelve a decir el texto de `label`.
 *
 * 🪤 Quien consuma esto debe tratar **"todas marcadas" como "sin filtro"** y no
 * mandar la lista completa a la consulta. Con ~100 aliados eso son miles de
 * caracteres de UUID en la URL, y PostgREST detrás de nginx la rechaza entera
 * (el 414 que ya nos mordió). `valoresParaConsulta` de abajo lo resuelve.
 *
 * `opciones`: [{ v, label }] — `v` es lo que viaja a la consulta.
 * `seleccion`: Set con los `v` marcados.
 */
export function FiltroChecklist({
  label,                 // texto cuando no hay nada marcado ("Todos los planes")
  opciones = [],
  seleccion,             // Set
  onChange,              // (nuevoSet) => void
  className,
  buscableDesde = 8,     // a partir de cuántas opciones aparece el buscador
}) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const caja = useRef(null)

  // Cerrar al tocar fuera o con Esc. Sin esto quedan varios paneles abiertos a
  // la vez tapándose entre ellos.
  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    const esc = e => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return opciones
    return opciones.filter(o => String(o.label).toLowerCase().includes(t))
  }, [opciones, q])

  const n = seleccion?.size || 0
  const todas = n === 0 || n === opciones.length

  const alternar = v => {
    const s = new Set(seleccion || [])
    if (s.has(v)) s.delete(v); else s.add(v)
    // Marcarlas todas a mano es lo mismo que no filtrar: se normaliza a vacío
    // para que la consulta no cargue con la lista entera.
    onChange(s.size === opciones.length ? new Set() : s)
  }

  // Lo que dice el botón. Con una sola marcada se enseña su nombre — es el caso
  // más común y leerlo ahorra abrir el panel.
  const texto = n === 0 ? label
    : n === 1 ? (opciones.find(o => seleccion.has(o.v))?.label || `1 seleccionado`)
    : `${label.replace(/^Tod[oa]s?\s+(l[oa]s\s+)?/i, '')}: ${n}`

  return (
    <div ref={caja} className={cn('relative', className)}>
      <button type="button" onClick={() => setAbierto(a => !a)}
        className={cn(
          'w-full flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium bg-white',
          'border rounded-lg outline-none transition-all duration-150 text-left',
          n > 0 ? 'border-[#1A5CD8] text-[#1A5CD8]' : 'border-gray-200 text-gray-900',
        )}>
        <span className="truncate flex-1" title={texto}>{texto}</span>
        {n > 0 && (
          <span
            role="button" tabIndex={0}
            onClick={e => { e.stopPropagation(); onChange(new Set()) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onChange(new Set()) } }}
            className="shrink-0 rounded hover:bg-[#1A5CD8]/10 p-0.5" title="Quitar este filtro">
            <X size={12} />
          </span>
        )}
        <ChevronDown size={14} className={cn('shrink-0 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div className="absolute z-40 mt-1 w-[260px] max-w-[85vw] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {opciones.length >= buscableDesde && (
            <div className="relative border-b border-gray-100">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…"
                className="w-full pl-8 pr-2 py-2 text-[12px] outline-none" />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
            <button type="button" onClick={() => onChange(new Set())}
              className="text-[11px] font-bold text-[#1A5CD8] hover:underline">Todos</button>
            <span className="text-[10px] text-gray-400">{todas ? 'sin filtrar' : `${n} de ${opciones.length}`}</span>
            <button type="button"
              onClick={() => onChange(new Set(visibles.map(o => o.v)))}
              className="text-[11px] font-bold text-gray-500 hover:underline"
              title="Marca solo lo que se ve en la lista">Solo lo visible</button>
          </div>
          <div className="max-h-[260px] overflow-auto py-1">
            {visibles.length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-gray-400 text-center">Nada coincide</div>
            ) : visibles.map(o => {
              const on = seleccion?.has(o.v)
              return (
                <button key={o.v} type="button" onClick={() => alternar(o.v)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors">
                  <span className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    on ? 'bg-[#1A5CD8] border-[#1A5CD8]' : 'border-gray-300 bg-white',
                  )}>
                    {on && <Check size={11} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className={cn('text-[12.5px] truncate', on ? 'font-semibold text-gray-900' : 'text-gray-600')}
                    title={o.label}>{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Lo que hay que mandarle a la consulta: `null` cuando no se filtra (vacío o
 * todo marcado) y el arreglo de valores cuando sí. Ver la trampa del 414 arriba.
 */
export function valoresParaConsulta(seleccion, totalOpciones) {
  const n = seleccion?.size || 0
  if (n === 0 || n === totalOpciones) return null
  return [...seleccion]
}
