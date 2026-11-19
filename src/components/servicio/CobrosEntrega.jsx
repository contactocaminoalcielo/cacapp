import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { fmt, parseDate, parsearErrorDB } from '@/lib/utils'
import { METODOS_PAGO } from '@/lib/comprasRecordatorios'
import { Truck, Pencil, X, AlertCircle } from 'lucide-react'

// ── Dinero que el mensajero registró al ENTREGAR ──────────────────────────────
// Reporte 19-nov: el panel del mensajero era "todo o nada" y registraba el
// saldo COMPLETO aunque en la puerta solo se cobrara el recordatorio adicional
// (el plan seguía pendiente con la veterinaria) → el servicio quedaba como
// pagado. Acá coordinación ve ese cobro y lo corrige al valor real, con una
// observación obligatoria (RPC corregir_cobro_entrega, migr. 213). El saldo
// que falta vuelve a Cartera, donde se registra el pago real cuando llegue.
// Va dentro de RecibosServicio: modal del Tablero y ficha de Gestión.
export default function CobrosEntrega({ servicioId, onCambio }) {
  const [entregas, setEntregas] = useState([])
  const [abierta,  setAbierta]  = useState(null)   // entrega_id con el panel abierto
  const [monto,    setMonto]    = useState('')
  const [metodo,   setMetodo]   = useState('')
  const [obs,      setObs]      = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error,    setError]    = useState('')
  const [ok,       setOk]       = useState('')
  const { personalData } = useAuth()
  const { confirm } = useConfirm()
  const puedeCorregir = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)

  async function cargar() {
    const { data } = await db.from('entregas')
      .select('id, fecha_realizada, cobro_monto, cobro_metodo, cobro_no_realizado_motivo, cobro_comprobante_path, quien:cobro_registrado_por(nombre, apellido)')
      .eq('servicio_id', servicioId)
      .or('cobro_monto.not.is.null,cobro_no_realizado_motivo.not.is.null')
      .order('fecha_realizada', { ascending: false })
    setEntregas(data || [])
  }

  useEffect(() => {
    setEntregas([]); setAbierta(null); setOk(''); setError('')
    cargar()
  }, [servicioId])   // eslint-disable-line react-hooks/exhaustive-deps

  function abrir(e) {
    setAbierta(e.id); setMonto(String(Math.round(e.cobro_monto || 0))); setMetodo(e.cobro_metodo || 'EFECTIVO')
    setObs(''); setError(''); setOk('')
  }

  async function guardar(e) {
    const real = Number(String(monto).replace(/[^\d]/g, ''))
    if (String(monto).trim() === '' || !Number.isFinite(real)) { setError('Escribe cuánto se recibió de verdad (0 si no se recibió nada).'); return }
    if (obs.trim().length < 4) { setError('Escribe la observación: queda en la bitácora del servicio.'); return }
    const ok = await confirm(
      `El cobro de la entrega pasa de ${fmt(e.cobro_monto)} a ${fmt(real)}. ` +
      'El pago del servicio se ajusta por la diferencia y lo que falte vuelve a quedar pendiente en Cartera. La bitácora conserva el registro anterior.',
      { title: '¿Corregir el valor cobrado?', confirmLabel: 'Sí, corregir' }
    )
    if (!ok) return
    setGuardando(true); setError('')
    try {
      const { data, error: err } = await db.rpc('corregir_cobro_entrega', {
        p_entrega_id: e.id,
        p_monto_real: real,
        p_metodo:     metodo || null,
        p_motivo:     obs.trim(),
        p_actor_id:   personalData?.id || null,
        p_actor_rol:  personalData?.rol || null,
      })
      if (err) throw err
      setAbierta(null)
      setOk(data?.sin_cambios
        ? 'No había nada que cambiar: el valor y el medio ya eran esos.'
        : `Cobro corregido. El servicio queda ${String(data?.estado_pago || '').toLowerCase()}` +
          (data?.saldo > 0 ? ` con ${fmt(data.saldo)} pendiente en Cartera.` : '.') +
          (data?.en_borrador ? ' El cuadre del mensajero en borrador debe regenerarse.' : ''))
      await cargar()
      onCambio?.(data)
    } catch (err) {
      setError(parsearErrorDB(err))
    } finally { setGuardando(false) }
  }

  if (!entregas.length) return null

  return (
    <div className="space-y-2">
      {entregas.map(e => {
        const quien = e.quien ? `${e.quien.nombre || ''} ${e.quien.apellido || ''}`.trim() : ''
        const fecha = e.fecha_realizada ? parseDate(e.fecha_realizada)?.toLocaleDateString('es-CO') : ''
        return (
          <div key={e.id} className="rounded-lg border bg-white px-3 py-2.5 space-y-1.5" style={{ borderColor: '#FDE68A' }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-bold text-gray-900 inline-flex items-center gap-1.5">
                <Truck size={12} style={{ color: '#B45309' }} /> Cobrado en la entrega
              </span>
              {e.cobro_monto != null
                ? <span className="text-[12px] font-bold" style={{ color: '#B45309' }}>{fmt(e.cobro_monto)} · {e.cobro_metodo}</span>
                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Sin cobro</span>}
            </div>
            {e.cobro_no_realizado_motivo && (
              <div className="text-[11px] text-gray-500">{e.cobro_no_realizado_motivo}</div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] text-gray-400">{[fecha, quien].filter(Boolean).join(' · ')}</div>
              {puedeCorregir && e.cobro_monto != null && abierta !== e.id && (
                <button onClick={() => abrir(e)}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-colors hover:bg-amber-100"
                  style={{ background: '#FEF3C7', color: '#92400E' }}
                  title="El valor registrado no es lo que se recibió en la entrega">
                  <Pencil size={10} /> Corregir valor
                </button>
              )}
            </div>

            {abierta === e.id && (
              <div className="rounded-lg p-2.5 space-y-2" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[11px]" style={{ color: '#92400E' }}>
                    ¿Cuánto se recibió de verdad en la entrega? Lo que falte del servicio vuelve a quedar
                    pendiente en Cartera, y ahí se registra el pago real cuando llegue.
                  </div>
                  <button onClick={() => { setAbierta(null); setError('') }} className="text-amber-400 hover:text-amber-600 shrink-0">
                    <X size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#92400E' }}>
                    Valor recibido
                    <input inputMode="numeric" value={monto} onChange={ev => setMonto(ev.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 w-full text-[12px] font-bold rounded-lg border border-amber-200 px-2 py-1.5 outline-none focus:border-amber-400 bg-white" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#92400E' }}>
                    Medio
                    <select value={metodo} onChange={ev => setMetodo(ev.target.value)}
                      className="mt-1 w-full text-[12px] font-bold rounded-lg border border-amber-200 px-2 py-1.5 outline-none focus:border-amber-400 bg-white">
                      {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
                {monto !== '' && Number(monto) !== Math.round(e.cobro_monto || 0) && (
                  <div className="text-[10px]" style={{ color: '#92400E' }}>
                    {fmt(e.cobro_monto)} → <b>{fmt(Number(monto))}</b>
                    {Number(monto) === 0 ? ' · queda como entrega sin cobro' : ''}
                  </div>
                )}
                <textarea value={obs} onChange={ev => setObs(ev.target.value)} rows={2}
                  placeholder="Observación (obligatoria). Ej: solo pagó el Memopet; el plan lo paga la veterinaria."
                  className="w-full text-[11px] rounded-lg border border-amber-200 px-2 py-1.5 outline-none focus:border-amber-400 resize-none bg-white" />
                {error && <div className="text-[10px] text-red-600 flex items-center gap-1"><AlertCircle size={10} /> {error}</div>}
                <button onClick={() => guardar(e)} disabled={guardando || monto === '' || obs.trim().length < 4}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                  style={{ background: '#B45309' }}>
                  {guardando ? 'Corrigiendo…' : 'Guardar la corrección'}
                </button>
              </div>
            )}
          </div>
        )
      })}
      {ok && (
        <div className="text-[11px] rounded-lg px-3 py-2" style={{ background: '#DCFCE7', color: '#166534' }}>{ok}</div>
      )}
    </div>
  )
}
