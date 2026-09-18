// La lista de contactos de UN flujo automático: a quién le llegó, a quién no,
// qué falló, y el botón de relanzar.
//
// Pedido de David el 2026-09-18. La tarjeta del tablero dice "23 enviados,
// 4 con error"; esto contesta CUÁLES. El acuse de Meta (✓ enviado, ✓✓ llegó,
// ✓✓ azul leído, ! falló) viene cruzado desde el backend: un "enviado" con
// acuse fallido es alguien a quien NO le llegó nada, y aquí se ve en rojo.
//
// Nada se filtra ni se cuenta en el navegador: filtros, ventana y tope van en
// SQL. Los números de las pestañas son de toda la ventana, no de las 400 filas
// que se muestran.
import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/contexts/ConfirmContext'
import { orbitApi } from '@/lib/orbitApi'
import { ESTADO_ENVIO } from '@/lib/whatsappInbox'
import { fmtDateTime } from '@/lib/utils'
import { RefreshCw, Search, RotateCcw, Check, X } from 'lucide-react'

const PESTANAS = [
  { key: 'todos',     label: 'Todos' },
  { key: 'llego',     label: 'Le llegó' },
  { key: 'sin_acuse', label: 'Sin acuse' },
  { key: 'error',     label: 'Con error' },
  { key: 'pendiente', label: 'Por enviar' },
]

const VENTANAS = [
  { dias: 7,  label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 0,  label: 'Todo' },
]

const TOPE_LOTE = 20   // relanzar de a 20 por clic: cada envío es una llamada a Meta

/**
 * Estado que se le enseña a una persona, combinando lo que dice la tabla del
 * flujo con lo que dijo Meta. La regla: el acuse manda sobre el "ENVIADO".
 */
function estadoVisible(f) {
  if (f.estado === 'ERROR')     return { label: 'Error',      bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5' }
  if (f.estado === 'PENDIENTE') return { label: 'Por enviar', bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' }
  if (f.estado === 'ENVIANDO')  return { label: 'En curso',   bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' }
  if (f.estado === 'CANCELADO') return { label: 'Cancelado',  bg: '#F3F4F6', color: '#6B7280', border: '#E5E7EB' }
  switch (f.acuse) {
    case 'read':      return { label: 'Leído',     bg: '#EEF3FB', color: '#1A5CD8', border: '#C0D0F0' }
    case 'delivered': return { label: 'Le llegó',  bg: '#DCFCE7', color: '#166534', border: '#BBF7D0' }
    case 'failed':    return { label: 'No llegó',  bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5' }
    case 'sent':      return { label: 'Enviado',   bg: '#F3F4F6', color: '#374151', border: '#E5E7EB' }
    default:          return { label: 'Enviado · sin acuse', bg: '#F3F4F6', color: '#6B7280', border: '#E5E7EB' }
  }
}

function Chip({ f }) {
  const e = estadoVisible(f)
  const tick = f.estado === 'ENVIADO' && f.acuse ? ESTADO_ENVIO[f.acuse] : null
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ background: e.bg, color: e.color, borderColor: e.border }} title={f.acuse_en ? `Acuse: ${fmtDateTime(f.acuse_en)}` : undefined}>
      {tick && <span className={tick.clase}>{tick.icono}</span>}
      {e.label}
    </span>
  )
}

export default function PanelEnvios({ flujo, onCambio }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [pestana,  setPestana]  = useState('todos')
  const [dias,     setDias]     = useState(30)
  const [q,        setQ]        = useState('')
  const [datos,    setDatos]    = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState('')
  const [ocupado,  setOcupado]  = useState('')      // id de la fila que se está relanzando
  const [resultado, setResultado] = useState({})   // id → { ok, error }
  const [lote,     setLote]     = useState(null)    // { hecho, total } mientras corre el relanzamiento masivo
  const debounce = useRef(null)

  const cargar = useCallback(async (opts = {}) => {
    const p = new URLSearchParams()
    p.set('estado', opts.estado ?? pestana)
    p.set('dias', String(opts.dias ?? dias))
    const texto = (opts.q ?? q).trim()
    if (texto) p.set('q', texto)
    setCargando(true)
    try {
      setDatos(await orbitApi(`/automatizaciones/${flujo.clave}/envios?${p}`))
      setError('')
    } catch (e) {
      setError(e.message || 'No se pudo cargar')
    } finally {
      setCargando(false)
    }
  }, [flujo.clave, pestana, dias, q])

  useEffect(() => { cargar() }, [pestana, dias])   // eslint-disable-line react-hooks/exhaustive-deps

  function buscar(v) {
    setQ(v)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => cargar({ q: v }), 350)
  }

  async function relanzarUno(f, { silencioso = false } = {}) {
    setOcupado(f.id)
    try {
      await orbitApi(`/automatizaciones/${flujo.clave}/envios/${f.id}/relanzar`, { method: 'POST' })
      setResultado(r => ({ ...r, [f.id]: { ok: true } }))
      return true
    } catch (e) {
      // El backend ya traduce el error: `error` es la frase para una persona y
      // `explicacion.hacer` dice qué hacer ahora.
      const exp = e.detalle?.explicacion
      setResultado(r => ({ ...r, [f.id]: { ok: false, error: e.message, hacer: exp?.hacer } }))
      if (!silencioso) {
        await showAlert(`${e.message || 'No se pudo relanzar'}${exp?.hacer ? `\n\nQué hacer: ${exp.hacer}` : ''}`,
          { title: 'No se relanzó', variant: 'danger' })
      }
      return false
    } finally {
      setOcupado('')
    }
  }

  async function relanzar(f) {
    const ok = await confirm(
      `Se va a volver a enviar «${flujo.nombre}» a ${f.destinatario || 'este contacto'}${f.mascota ? ` (${f.mascota})` : ''} al ${f.destino || 'número registrado'}.`,
      { title: '¿Relanzar este envío?', variant: 'default', confirmLabel: 'Relanzar' }
    )
    if (!ok) return
    if (await relanzarUno(f)) { await cargar(); onCambio?.() }
  }

  /** Los de esta vista que se pueden relanzar, de a TOPE_LOTE, uno tras otro. */
  async function relanzarTodos() {
    const filas = (datos?.filas || []).filter(f => f.relanzable && !resultado[f.id]?.ok).slice(0, TOPE_LOTE)
    if (!filas.length) return
    const ok = await confirm(
      `Se van a relanzar ${filas.length} envíos de «${flujo.nombre}», uno tras otro. Los que fallen quedan marcados en la lista.`,
      { title: `¿Relanzar ${filas.length} envíos?`, variant: 'default', confirmLabel: 'Relanzar todos' }
    )
    if (!ok) return
    let bien = 0
    setLote({ hecho: 0, total: filas.length })
    for (let i = 0; i < filas.length; i++) {
      if (await relanzarUno(filas[i], { silencioso: true })) bien++
      setLote({ hecho: i + 1, total: filas.length })
    }
    setLote(null)
    await showAlert(`${bien} de ${filas.length} salieron bien.${bien < filas.length ? ' Los demás tienen el motivo al lado.' : ''}`,
      { title: 'Relanzamiento terminado', variant: bien === filas.length ? 'success' : 'danger' })
    await cargar(); onCambio?.()
  }

  const filas = datos?.filas || []
  const conteos = datos?.conteos || {}
  const relanzables = filas.filter(f => f.relanzable && !resultado[f.id]?.ok).length
  const pestanas = flujo.clave === 'aviso_cliente' ? PESTANAS.filter(p => p.key === 'todos') : PESTANAS

  return (
    <div className="mt-4 rounded-lg border" style={{ borderColor: 'rgba(30,80,40,0.12)', background: '#FFFFFF' }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-gray-100">
        <div className="flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: '#F3F4F6' }}>
          {pestanas.map(p => (
            <button key={p.key} type="button" onClick={() => setPestana(p.key)}
              className={`px-2.5 py-1 rounded-md text-[12px] font-semibold transition ${pestana === p.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.label}{conteos[p.key] != null && <span className="ml-1 text-[11px] font-bold" style={{ color: p.key === 'error' && conteos.error > 0 ? '#B91C1C' : '#6B7280' }}>{conteos[p.key]}</span>}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {VENTANAS.map(v => (
            <button key={v.dias} type="button" onClick={() => setDias(v.dias)}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${dias === v.dias ? 'text-[#0B1D4F] bg-[#EEF3FF]' : 'text-gray-400 hover:text-gray-600'}`}>
              {v.label}
            </button>
          ))}
        </div>

        <label className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => buscar(e.target.value)} placeholder="Mascota, nombre o número"
            className="h-8 w-52 pl-8 pr-2 rounded-md border border-gray-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/20" />
        </label>

        <button type="button" onClick={() => cargar()} title="Actualizar"
          className="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} />
        </button>

        {relanzables > 0 && (
          <Button size="sm" variant="gold" disabled={!!lote || !!ocupado} onClick={relanzarTodos}>
            <RotateCcw size={12} />
            {lote ? `Relanzando ${lote.hecho}/${lote.total}…` : `Relanzar ${Math.min(relanzables, TOPE_LOTE)}${relanzables > TOPE_LOTE ? ` de ${relanzables}` : ''}`}
          </Button>
        )}
      </div>

      {error && (
        <div className="px-3 py-2.5 text-[12px]" style={{ background: '#FEF2F2', color: '#991B1B' }}>{error}</div>
      )}

      {!error && !cargando && filas.length === 0 && (
        <div className="px-3 py-6 text-center text-[12px] text-gray-400">
          Nada en esta pestaña {dias ? `en los últimos ${dias} días` : ''}.
        </div>
      )}

      {filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[760px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500" style={{ background: '#FAFAF9' }}>
                <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                <th className="text-left px-3 py-2 font-semibold">Contacto</th>
                <th className="text-left px-3 py-2 font-semibold">Número</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
                <th className="text-left px-3 py-2 font-semibold">Detalle</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const res = resultado[f.id]
                const exp = f.explicacion
                return (
                  <tr key={f.id} className="border-t border-gray-100 align-top" style={{ opacity: cargando ? 0.6 : 1 }}>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{f.fecha ? fmtDateTime(f.fecha) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gray-900">{f.mascota || '—'}</div>
                      <div className="text-gray-500">{f.destinatario || '—'}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 font-mono text-[11px]">{f.destino || '—'}</td>
                    <td className="px-3 py-2">
                      <Chip f={f} />
                      {f.intentos > 1 && <div className="text-[10px] text-gray-400 mt-1">{f.intentos} intentos</div>}
                    </td>
                    <td className="px-3 py-2 max-w-[22rem]">
                      <div className="text-gray-600">{f.detalle}</div>
                      {/* El error, en cristiano: qué pasó y qué hacer. Lo técnico
                          queda plegado para quien lo necesite (soporte). */}
                      {exp && (
                        <div className="mt-1 text-[11px] leading-snug">
                          <div className="font-semibold" style={{ color: '#B91C1C' }}>{exp.titulo}</div>
                          <div className="text-gray-600 mt-0.5"><span className="font-semibold text-gray-700">Qué hacer:</span> {exp.hacer}</div>
                          <details className="mt-0.5">
                            <summary className="cursor-pointer text-[10px] text-gray-400 hover:text-gray-600 select-none">Detalle técnico</summary>
                            <div className="text-[10px] text-gray-400 font-mono break-all mt-0.5">{exp.tecnico}</div>
                          </details>
                        </div>
                      )}
                      {res && (
                        <div className="mt-1 text-[11px]" style={{ color: res.ok ? '#166534' : '#B91C1C' }}>
                          <span className="inline-flex items-center gap-1 font-semibold">
                            {res.ok ? <Check size={11} /> : <X size={11} />}
                            {res.ok ? 'Relanzado' : `Al relanzar: ${res.error}`}
                          </span>
                          {!res.ok && res.hacer && <div className="text-gray-600 mt-0.5">Qué hacer: {res.hacer}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {f.relanzable ? (
                        <Button size="sm" variant="secondary" disabled={!!lote || ocupado === f.id || res?.ok} onClick={() => relanzar(f)}>
                          <RotateCcw size={11} /> {ocupado === f.id ? '…' : 'Relanzar'}
                        </Button>
                      ) : (
                        <span className="text-[10px] text-gray-400" title={f.no_relanzable}>{f.no_relanzable}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {datos && filas.length >= datos.tope && (
        <div className="px-3 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          Se muestran los {datos.tope} más recientes de {conteos[pestana] ?? '?'}: acorta la ventana o busca por nombre.
        </div>
      )}
    </div>
  )
}
