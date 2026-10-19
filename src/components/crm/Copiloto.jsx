// El copiloto: la IA lee la ficha completa (métricas, gestiones, tickets,
// últimos WhatsApp) y propone. NUNCA envía nada sola: lo que redacta se copia
// o se abre en WhatsApp a mano.
import { useState } from 'react'
import { Sparkles, Copy, Check, MessageCircle } from 'lucide-react'
import { crm, waHref } from '@/lib/crmApi'
import { Input } from '@/components/ui/input'
import { ACENTO } from './ui'

const ACCIONES = [
  { clave: 'resumen',   label: 'Diagnóstico' },
  { clave: 'siguiente', label: 'Siguiente acción' },
  { clave: 'guion',     label: 'Guion de llamada' },
  { clave: 'mensaje',   label: 'Redactar WhatsApp' },
]

export default function Copiloto({ destino, whatsapp }) {
  const [accion, setAccion] = useState(null)
  const [texto, setTexto] = useState('')
  const [instruccion, setInstruccion] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [copiado, setCopiado] = useState(false)

  async function pedir(clave) {
    setAccion(clave); setCargando(true); setError(null); setTexto('')
    try {
      const r = await crm.copiloto({ ...destino, accion: clave, instruccion: instruccion || null })
      setTexto(r.texto || '')
    } catch (e) { setError(e.message) } finally { setCargando(false) }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* sin portapapeles */ }
  }

  return (
    <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50/70 to-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} style={{ color: ACENTO }} />
        <h3 className="text-[13px] font-bold text-gray-800">Copiloto comercial</h3>
        <span className="text-[11px] text-gray-400">IA · lee toda la ficha</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ACCIONES.map(a => (
          <button key={a.clave} onClick={() => pedir(a.clave)} disabled={cargando}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition disabled:opacity-50
              ${accion === a.clave ? 'text-white border-transparent' : 'bg-white border-teal-200 text-teal-800 hover:bg-teal-50'}`}
            style={accion === a.clave ? { background: ACENTO } : undefined}>
            {a.label}
          </button>
        ))}
      </div>
      <Input className="mt-2.5" value={instruccion} onChange={e => setInstruccion(e.target.value)}
        placeholder="Indicación opcional: “quiero ofrecerle el plan Exclusivo”, “está molesta por una entrega”…" />
      {cargando && <div className="flex items-center gap-2 text-[12.5px] text-gray-500 mt-3"><div className="spinner" /> Pensando…</div>}
      {error && <div className="text-[12.5px] text-red-600 mt-3">{error}</div>}
      {texto && (
        <div className="mt-3 rounded-xl bg-white border border-gray-100 p-3">
          <div className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{texto}</div>
          <div className="flex gap-2 mt-2.5">
            <button onClick={copiar} className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-500 hover:text-gray-800">
              {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? 'Copiado' : 'Copiar'}
            </button>
            {accion === 'mensaje' && whatsapp && (
              <a href={waHref(whatsapp, texto)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-700 hover:text-green-800">
                <MessageCircle size={13} /> Abrir en WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
