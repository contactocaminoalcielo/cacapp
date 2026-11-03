import { useState, useRef, useEffect, useMemo } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filtrarPorBusqueda } from '@/lib/busqueda'

/**
 * Desplegable de UNA opción con buscador, para filtros con listas largas
 * (aliados, técnicos…). Reemplaza a un <select> sin obligar a scrollear: se
 * escribe un pedazo del nombre, sin tildes, y la lista se reduce al instante
 * (ver `@/lib/busqueda`). Teclado: ↑ ↓ para moverse, Enter elige, Esc cierra.
 *
 * `value`: valor elegido; '' = sin filtro (muestra `placeholder`).
 * `opciones`: [{ v, label }]. `v` debe ser string, igual que en un <select>.
 * `fijas`: opciones que van arriba siempre y no se filtran (p. ej. "Particulares").
 */
export function SelectBuscable({
  value = '',
  onChange,
  opciones = [],
  fijas = [],
  placeholder = 'Todos',
  className,
  buscableDesde = 6,   // con menos opciones el buscador estorba más de lo que ayuda
}) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [activo, setActivo] = useState(0)
  const caja = useRef(null)
  const lista = useRef(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  useEffect(() => { if (!abierto) setQ('') }, [abierto])

  const conBuscador = opciones.length + fijas.length >= buscableDesde
  const visibles = useMemo(() => [
    { v: '', label: placeholder },
    ...(q.trim() ? [] : fijas),
    ...filtrarPorBusqueda(opciones, q, o => o.label),
  ], [opciones, fijas, q, placeholder])

  // Al escribir, la primera coincidencia real queda lista para Enter
  useEffect(() => { setActivo(q.trim() && visibles.length > 1 ? 1 : 0) }, [q, visibles.length])

  useEffect(() => {
    lista.current?.querySelector(`[data-i="${activo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activo])

  const elegir = v => { onChange(v); setAbierto(false) }

  function teclas(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => Math.min(i + 1, visibles.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (visibles[activo]) elegir(visibles[activo].v) }
    else if (e.key === 'Escape') { e.preventDefault(); setAbierto(false) }
  }

  const elegida = value ? [...fijas, ...opciones].find(o => o.v === value) : null
  const texto = elegida?.label || placeholder

  return (
    <div ref={caja} className={cn('relative', className)}>
      <button type="button" onClick={() => setAbierto(a => !a)} onKeyDown={e => { if (abierto) teclas(e) }}
        className={cn(
          'w-full h-full flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-semibold border transition-all text-left',
          value ? 'bg-blue-50 border-[#1A5CD8]/40 text-[#1A5CD8]' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
        )}>
        <span className="truncate flex-1" title={texto}>{texto}</span>
        {value ? (
          <span role="button" title="Quitar este filtro"
            onClick={e => { e.stopPropagation(); onChange(''); setAbierto(false) }}
            className="shrink-0 text-[#1A5CD8]/60 hover:text-[#1A5CD8]">
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={12} className={cn('shrink-0 text-gray-400 transition-transform', abierto && 'rotate-180')} />
        )}
      </button>

      {abierto && (
        <div className="absolute z-40 mt-1 w-full min-w-[15rem] max-w-[85vw] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          {conBuscador && (
            <div className="relative border-b border-gray-100">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={teclas}
                placeholder="Escribe para buscar…"
                className="w-full pl-8 pr-7 py-2 text-[12px] outline-none" />
              {q && (
                <button type="button" onClick={() => setQ('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div ref={lista} className="max-h-72 overflow-y-auto p-1">
            {visibles.map((o, i) => {
              const sel = o.v === value
              return (
                <button key={o.v || '__todos__'} type="button" data-i={i}
                  onMouseEnter={() => setActivo(i)} onClick={() => elegir(o.v)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12px] transition-colors',
                    i === activo ? 'bg-gray-100' : '',
                    sel ? 'text-[#1A5CD8] font-semibold' : 'text-gray-700',
                    !o.v && 'text-gray-500',
                  )}>
                  <span className="w-3.5 shrink-0">{sel && <Check size={12} />}</span>
                  <span className="truncate" title={o.label}>{o.label}</span>
                </button>
              )
            })}
            {q.trim() && visibles.length === 1 && (
              <div className="px-3 py-3 text-[12px] text-gray-400 text-center">Nada coincide con “{q.trim()}”</div>
            )}
          </div>
          {q.trim() && visibles.length > 1 && (
            <div className="px-3 py-1 border-t border-gray-100 text-[10px] text-gray-400">
              {visibles.length - 1} de {opciones.length} · Enter elige la resaltada
            </div>
          )}
        </div>
      )}
    </div>
  )
}
