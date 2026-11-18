// Ventas posteriores › No contactar — familias a las que NO se les envían
// ofertas (migr. 210, tabla `oferta_exclusiones`).
//
// Entran solas cuando la familia toca «No deseo informacion» en WhatsApp o lo
// pide en el portal; y a mano desde aquí o al excluir una oferta marcando
// «Excluir de todas las ofertas posteriores» (el «Excluir de ofertas
// posteriores» del reporte).
//
// Retirar la marca no borra nada: queda quién la puso y cuándo se retiró.
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { fmtDateTime } from '@/lib/utils'
import { UserX, Undo2 } from 'lucide-react'

const ORIGEN = {
  FAMILIA: { label: 'Lo pidió la familia', bg: '#EEF3FB', fg: '#3B6FBF' },
  EQUIPO:  { label: 'La marcó el equipo',  bg: '#F3F4F6', fg: '#4B5563' },
}

export default function NoContactar() {
  const { alert: showAlert, confirm } = useConfirm()
  const [lista, setLista]     = useState(null)
  const [error, setError]     = useState('')
  const [telefono, setTelefono] = useState('')
  const [motivo, setMotivo]   = useState('')
  const [ocupado, setOcupado] = useState('')

  const cargar = useCallback(async () => {
    try {
      const r = await orbitApi('/oferta-posterior-exclusiones')
      setLista(r.exclusiones || []); setError('')
    } catch (e) { setError(e.message || 'No se pudo cargar') }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function agregar() {
    setOcupado('nuevo')
    try {
      await orbitApi('/oferta-posterior-exclusiones', { method: 'POST', body: { telefono, motivo } })
      setTelefono(''); setMotivo('')
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo marcar' })
    } finally { setOcupado('') }
  }

  async function retirar(x) {
    const quien = x.propietario || x.whatsapp || x.tel10
    const ok = await confirm(
      `${quien} volverá a poder recibir ofertas.${x.origen === 'FAMILIA' ? ' Ojo: fue la familia quien pidió no recibirlas.' : ''}`,
      { title: 'Retirar de «No contactar»', variant: 'warning', confirmLabel: 'Sí, retirar' })
    if (!ok) return
    setOcupado(x.id)
    try {
      await orbitApi(`/oferta-posterior-exclusiones/${x.id}/retirar`, { method: 'POST' })
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo retirar' })
    } finally { setOcupado('') }
  }

  const telValido = telefono.replace(/\D/g, '').length >= 10

  return (
    <div className="space-y-5 max-w-4xl">
      <p className="text-[13px] text-gray-500 leading-snug max-w-3xl">
        A estas familias <strong>no se les envía ninguna oferta</strong>, aunque tengan una programada. Esto no afecta los
        mensajes de su servicio (recibos, certificados, condolencias): solo las ofertas comerciales.
      </p>

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="text-[13px] font-semibold text-gray-800 flex items-center gap-2"><UserX size={14} /> Excluir a una familia de las ofertas posteriores</div>
        <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr_auto] gap-2">
          <div>
            <label htmlFor="nc-tel" className="block text-[12px] font-semibold text-gray-600 mb-1">WhatsApp de la familia</label>
            <Input id="nc-tel" inputMode="tel" placeholder="3001234567" value={telefono} onChange={e => setTelefono(e.target.value)} />
          </div>
          <div>
            <label htmlFor="nc-motivo" className="block text-[12px] font-semibold text-gray-600 mb-1">Motivo</label>
            <Input id="nc-motivo" maxLength={300} placeholder="Ej.: pidió por teléfono que no le ofrezcamos nada" value={motivo}
              onChange={e => setMotivo(e.target.value)} onKeyDown={e => e.key === 'Enter' && telValido && motivo.trim() && agregar()} />
          </div>
          <div className="sm:pt-[22px]">
            <Button onClick={agregar} disabled={!telValido || !motivo.trim() || ocupado === 'nuevo'}>
              {ocupado === 'nuevo' ? 'Guardando…' : 'Excluir'}
            </Button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border-2 p-4 text-[13px]" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>{error}</div>
      )}

      {lista === null && !error && (
        <div className="flex items-center justify-center h-24 gap-3"><div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span></div>
      )}

      {lista && lista.length === 0 && (
        <div className="rounded-xl border bg-white p-6 text-center text-[13px] text-gray-500" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          Ninguna familia ha pedido no recibir ofertas.
        </div>
      )}

      {lista && lista.length > 0 && (
        <div className="rounded-xl border bg-white divide-y" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {lista.map(x => {
            const o = ORIGEN[x.origen] || ORIGEN.EQUIPO
            return (
              <div key={x.id} className="p-3.5 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px] text-gray-900">{x.propietario || 'Sin ficha de cliente'}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: o.bg, color: o.fg }}>{o.label}</span>
                  </div>
                  <div className="text-[12px] text-gray-600 mt-0.5">{x.whatsapp || x.tel10 || 'Sin número'}</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {x.motivo} · {fmtDateTime(x.created_at)}{x.creado_por_nombre ? ` · por ${x.creado_por_nombre}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={ocupado === x.id} onClick={() => retirar(x)}>
                  <Undo2 size={12} /> {ocupado === x.id ? '…' : 'Retirar'}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
