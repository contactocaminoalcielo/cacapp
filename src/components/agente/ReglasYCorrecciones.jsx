// Correcciones al agente y las reglas que salen de ellas (migración 099).
//
// Coordinación marca en el chat una respuesta como buena o mala y escribe qué
// debió decir. Eso NO llega al agente solo: aparece aquí, y solo lo que se
// asciende a REGLA entra en su contexto. Es a propósito — con cada corrección
// entrando sola, el contexto crece sin control y dos que se contradigan vuelven
// al agente errático sin que nadie lo note.
import { useState, useEffect, useCallback } from 'react'
import { ThumbsUp, ThumbsDown, Check, X, Trash2, Plus, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cargarValoraciones, aplicarValoracion, descartarValoracion,
  cargarReglas, crearRegla, actualizarRegla, borrarRegla,
} from '@/lib/agenteApi'

function Correccion({ v, onAplicar, onDescartar }) {
  // El texto se edita antes de ascenderlo: lo escrito en caliente suele ser un
  // desahogo ("no le digas eso") y el agente necesita una instrucción.
  const [texto, setTexto] = useState(v.correccion || '')
  const [ocupado, setOcupado] = useState(false)

  return (
    <div className="rounded-xl border border-neutral-200 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 flex-shrink-0 ${v.buena ? 'text-emerald-600' : 'text-red-500'}`}>
          {v.buena ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          {v.pregunto && (
            <p className="text-[11px] text-neutral-400 truncate">La vet: {v.pregunto}</p>
          )}
          <p className="text-[12px] text-neutral-700 line-clamp-3 whitespace-pre-wrap">
            {v.respuesta || '(sin texto)'}
          </p>
          <p className="text-[10px] text-neutral-400 mt-1">
            {v.quien || 'alguien'} · {new Date(v.creado_en).toLocaleString('es-CO')}
          </p>
        </div>
      </div>

      <textarea
        rows={2}
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder="Qué debe hacer el agente la próxima vez…"
        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-y"
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={ocupado || texto.trim().length < 5}
          onClick={async () => { setOcupado(true); await onAplicar(v.id, texto.trim()); setOcupado(false) }}
        >
          <Check size={13} className="mr-1" /> Convertir en regla
        </Button>
        <Button
          variant="ghost" size="sm" disabled={ocupado}
          onClick={async () => { setOcupado(true); await onDescartar(v.id); setOcupado(false) }}
        >
          <X size={13} className="mr-1" /> Descartar
        </Button>
      </div>
    </div>
  )
}

export default function ReglasYCorrecciones({ agenteId, onCambio }) {
  const [valoraciones, setValoraciones] = useState([])
  const [reglas, setReglas] = useState([])
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState(null)

  const refrescar = useCallback(async () => {
    if (!agenteId) return
    try {
      const [v, r] = await Promise.all([
        cargarValoraciones(agenteId, 'NUEVA'),
        cargarReglas(agenteId),
      ])
      setValoraciones(v.valoraciones || [])
      setReglas(r.reglas || [])
      setError(null)
    } catch (e) { setError(e.message) }
  }, [agenteId])

  useEffect(() => { refrescar() }, [refrescar])

  const envolver = fn => async (...args) => {
    try { await fn(...args); await refrescar(); onCambio?.() }
    catch (e) { setError(e.message) }
  }

  const aplicar   = envolver((id, texto) => aplicarValoracion(id, texto))
  const descartar = envolver(id => descartarValoracion(id))
  const alternar  = envolver((r) => actualizarRegla(r.id, { activo: !r.activo }))
  const eliminar  = envolver(id => borrarRegla(id))
  const agregar   = envolver(async () => { await crearRegla(agenteId, nueva.trim()); setNueva('') })

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      <div>
        <h4 className="text-[13px] font-semibold text-neutral-800 mb-2">
          Correcciones sin revisar
          {valoraciones.length > 0 && (
            <span className="ml-2 text-[11px] font-bold text-white bg-amber-500 rounded-full px-2 py-0.5">
              {valoraciones.length}
            </span>
          )}
        </h4>
        {!valoraciones.length ? (
          <p className="text-[12px] text-neutral-400">
            Nada pendiente. Marca una respuesta con 👍 o 👎 en el chat y aparecerá aquí.
          </p>
        ) : (
          <div className="space-y-2">
            {valoraciones.map(v => (
              <Correccion key={v.id} v={v} onAplicar={aplicar} onDescartar={descartar} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[13px] font-semibold text-neutral-800 mb-1 flex items-center gap-1.5">
          <Scale size={14} /> Reglas activas
        </h4>
        <p className="text-[11px] text-neutral-400 mb-2">
          Van al final del contexto y pesan por encima de él: si una regla contradice al
          contexto, manda la regla.
        </p>

        <div className="space-y-1.5">
          {reglas.map(r => (
            <div key={r.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
              r.activo ? 'border-neutral-200' : 'border-neutral-100 bg-neutral-50'
            }`}>
              <button
                type="button"
                onClick={() => alternar(r)}
                title={r.activo ? 'Desactivar' : 'Activar'}
                className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 grid place-items-center ${
                  r.activo ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-neutral-300'
                }`}
              >
                {r.activo && <Check size={11} />}
              </button>
              <p className={`flex-1 text-[12px] whitespace-pre-wrap ${r.activo ? 'text-neutral-700' : 'text-neutral-400 line-through'}`}>
                {r.texto}
              </p>
              <button
                type="button" onClick={() => eliminar(r.id)} title="Eliminar"
                className="text-neutral-300 hover:text-red-500 flex-shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!reglas.length && (
            <p className="text-[12px] text-neutral-400">Todavía no hay reglas.</p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <Input
            value={nueva}
            onChange={e => setNueva(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && nueva.trim().length >= 5) agregar() }}
            placeholder="Escribir una regla a mano…"
          />
          <Button size="sm" disabled={nueva.trim().length < 5} onClick={agregar}>
            <Plus size={13} />
          </Button>
        </div>
      </div>
    </div>
  )
}
