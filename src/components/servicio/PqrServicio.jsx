import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { parsearErrorDB } from '@/lib/utils'
import { MessageSquare, Plus, X, AlertCircle } from 'lucide-react'

// ── PQR de ESTE servicio ──────────────────────────────────────────────────────
// Lo que la familia dijo sobre esta mascota: una queja por la demora, un
// reclamo por el recordatorio, una felicitación. Antes de la migración 167 no
// había dónde dejarlo y se quedaba en la cabeza de quien atendió la llamada.
//
// Esto REGISTRA, no gestiona: no hay estado, ni responsable, ni cierre (decisión
// de David, 17-sep-2026). Por eso tampoco hay botón de "resolver": lo que queda
// es constancia de lo que dijeron, con su tipo, su canal y quién lo recibió.

export const PQR_TIPOS = [
  { key: 'PETICION',     label: 'Petición',     bg: '#EFF6FF', color: '#1E40AF' },
  { key: 'QUEJA',        label: 'Queja',        bg: '#FEF3C7', color: '#92400E' },
  { key: 'RECLAMO',      label: 'Reclamo',      bg: '#FFE4E6', color: '#9F1239' },
  { key: 'SUGERENCIA',   label: 'Sugerencia',   bg: '#F3E8FF', color: '#6B21A8' },
  { key: 'FELICITACION', label: 'Felicitación', bg: '#F0FDF4', color: '#15803D' },
]
export const PQR_CANALES = ['WHATSAPP', 'LLAMADA', 'PRESENCIAL', 'CORREO', 'REDES', 'OTRO']
export const metaTipoPqr = t => PQR_TIPOS.find(x => x.key === t) || PQR_TIPOS[1]

export default function PqrServicio({ servicioId, onCambio }) {
  const [lista, setLista]     = useState(null)   // null = cargando
  const [abierto, setAbierto] = useState(false)  // formulario desplegado
  const [tipo, setTipo]       = useState('QUEJA')
  const [canal, setCanal]     = useState('LLAMADA')
  const [texto, setTexto]     = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError]     = useState('')
  const { personalData } = useAuth()

  // Registrar es de coordinación. El rol puede venir por nombre o solo por
  // `rol_principal_id`; si aquí se mirara únicamente `rol`, al coordinador que
  // lo trae por id no le aparecería nunca el botón (ya pasó en Finanzas).
  const rolEfectivo = personalData?.rol
    || ({ 1: 'COORDINADOR', 6: 'ADMIN' })[Number(personalData?.rol_principal_id)]
    || null
  const puedeRegistrar = ['ADMIN', 'COORDINADOR'].includes(rolEfectivo)

  useEffect(() => {
    if (!servicioId) { setLista(null); return }
    let vivo = true
    setLista(null)
    db.from('pqrs')
      .select('id, tipo, canal, descripcion, created_at, personal:registrado_por(nombre, apellido)')
      .eq('servicio_id', servicioId)
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => { if (vivo) setLista(e ? [] : (data || [])) })
    return () => { vivo = false }
  }, [servicioId])

  async function registrar() {
    const descripcion = texto.trim()
    if (!descripcion) { setError('Escribe qué fue lo que dijeron.'); return }
    setGuardando(true); setError('')
    try {
      const { data, error: e } = await db.from('pqrs').insert({
        servicio_id:    servicioId,
        tipo,
        canal:          canal || null,
        descripcion,
        registrado_por: personalData?.id || null,
      }).select('id, tipo, canal, descripcion, created_at, personal:registrado_por(nombre, apellido)').single()
      if (e) throw e
      setLista(prev => [data, ...(prev || [])])
      setTexto(''); setAbierto(false)
      onCambio?.()
    } catch (e) {
      setError(parsearErrorDB(e))
    } finally {
      setGuardando(false)
    }
  }

  const cuando = ts => ts
    ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
    : ''
  const quien = p => p ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : '—'

  // Mientras carga no se pinta nada: es información de apoyo y un esqueleto
  // parpadeando en mitad del modal molesta más de lo que informa.
  if (lista === null) return null
  if (!lista.length && !puedeRegistrar) return null

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: '#FFF1F2', border: '1px solid #FECDD3' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#9F1239' }}>
          <MessageSquare size={10} /> PQR de esta mascota{lista.length ? ` (${lista.length})` : ''}
        </div>
        {puedeRegistrar && !abierto && (
          <button type="button" onClick={() => { setAbierto(true); setError('') }}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg transition-colors hover:opacity-90"
            style={{ background: '#9F1239', color: '#fff' }}>
            <Plus size={11} /> Registrar PQR
          </button>
        )}
      </div>

      {abierto && (
        <div className="rounded-lg bg-white border px-2.5 py-2.5 space-y-2" style={{ borderColor: '#FECDD3' }}>
          <div className="flex flex-wrap gap-1">
            {PQR_TIPOS.map(t => {
              const activo = tipo === t.key
              return (
                <button key={t.key} type="button" onClick={() => setTipo(t.key)}
                  className={`text-[11px] font-bold px-2 py-1 rounded-lg border transition-all ${activo ? 'shadow-sm' : 'border-transparent opacity-60 hover:opacity-100'}`}
                  style={{ background: t.bg, color: t.color, borderColor: activo ? t.color : 'transparent' }}>
                  {t.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Llegó por</span>
            <select value={canal} onChange={e => setCanal(e.target.value)}
              className="flex-1 text-[12px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-rose-200">
              {PQR_CANALES.map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
              <option value="">Sin especificar</option>
            </select>
          </div>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3}
            placeholder="Qué dijeron, con sus palabras…"
            className="w-full text-[12px] text-gray-700 bg-white border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-rose-200" />
          {error && (
            <div className="flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAbierto(false); setTexto(''); setError('') }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700 px-2 py-1">
              <X size={11} /> Cancelar
            </button>
            <button type="button" onClick={registrar} disabled={guardando}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: '#9F1239' }}>
              {guardando ? 'Guardando…' : 'Guardar PQR'}
            </button>
          </div>
        </div>
      )}

      {lista.map(p => {
        const meta = metaTipoPqr(p.tipo)
        return (
          <div key={p.id} className="rounded-lg bg-white border px-2.5 py-2 space-y-1" style={{ borderColor: '#FECDD3' }}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: meta.bg, color: meta.color }}>
                {meta.label}
              </span>
              <span className="text-[10px] text-gray-400">
                {cuando(p.created_at)}
                {p.canal ? ` · ${p.canal.charAt(0) + p.canal.slice(1).toLowerCase()}` : ''}
                {' · '}{quien(p.personal)}
              </span>
            </div>
            <div className="text-[12px] text-gray-700 whitespace-pre-wrap break-words">{p.descripcion}</div>
          </div>
        )
      })}
    </div>
  )
}
