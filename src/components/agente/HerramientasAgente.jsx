import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plug, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cargarHerramientas, guardarHerramientas } from '@/lib/agenteApi'

export default function HerramientasAgente({ agenteId }) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await cargarHerramientas(agenteId)
      setLista(r.herramientas || []); setError(null)
    } catch (e) { setError(e.message) } finally { setCargando(false) }
  }, [agenteId])

  useEffect(() => { cargar() }, [cargar])

  function cambiar(clave, campo, valor) {
    setLista(xs => xs.map(x => x.clave === clave ? { ...x, [campo]: valor } : x))
    setOk(false)
  }

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      const r = await guardarHerramientas(agenteId, lista)
      setLista(r.herramientas || []); setOk(true)
      setTimeout(() => setOk(false), 2500)
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  if (cargando) return <div className="min-h-40 grid place-items-center text-gray-500"><Loader2 className="animate-spin" /></div>

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="rounded-xl bg-[#EEF3FF] p-2 text-[#1A5CD8]"><Plug size={19} /></span>
          <div><h3 className="font-semibold text-gray-900">Capacidades</h3><p className="text-sm text-gray-600">Permisos que el modelo puede solicitar durante una conversación.</p></div>
        </div>
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 size={15} className="animate-spin" /> : ok ? <Check size={15} /> : <Save size={15} />}
          {ok ? 'Guardadas' : 'Guardar capacidades'}
        </Button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-3">
        {lista.map(h => (
          <article key={h.clave} className={`rounded-xl border p-4 ${h.activa ? 'border-[#C0D0F0] bg-[#F8FAFF]' : 'border-gray-200'}`}>
            <div className="flex items-start gap-3">
              <input id={`tool-${h.clave}`} type="checkbox" checked={h.activa}
                onChange={e => cambiar(h.clave, 'activa', e.target.checked)}
                className="mt-1 h-5 w-5 cursor-pointer rounded border-gray-300 accent-[#1A5CD8]" />
              <div className="min-w-0 flex-1">
                <label htmlFor={`tool-${h.clave}`} className="cursor-pointer text-sm font-semibold text-gray-900">{h.nombre}</label>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{h.resumen}</p>
                <code className="mt-1 inline-block text-[11px] text-gray-500">{h.clave}</code>
                {h.propia_del_negocio && (
                  <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                    <AlertTriangle size={15} className="shrink-0" /> Esta capacidad escribe o consulta la operación de Camino al Cielo. No la actives para otra empresa.
                  </div>
                )}
                {h.activa && (
                  <div className="mt-3">
                    <label htmlFor={`tool-desc-${h.clave}`} className="block text-xs font-semibold text-gray-700 mb-1">Descripción opcional para el modelo</label>
                    <Textarea id={`tool-desc-${h.clave}`} rows={3} value={h.descripcion || ''}
                      onChange={e => cambiar(h.clave, 'descripcion', e.target.value)}
                      placeholder="Vacío conserva la explicación segura que trae el sistema." />
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
