// Finanzas › Compras recordatorios: lo que se debe de las compras SIN servicio
// (migración 168) y el registro de sus abonos.
//
// Es una pestaña aparte de la cartera de servicios a propósito: esas compras
// tienen su propio libro (`compra_recordatorio_pagos`, trigger que mantiene
// `valor_pagado`, `estado_pago` generado), así que aquí no hay "descuadre" ni
// marca vieja que perseguir, y nada de `guardarPago()` de servicios se toca.
// Todo pasa por el backend (lib/comprasRecordatorios.js).
import { useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { fmt, petEmoji } from '@/lib/utils'
import {
  listarCompras, registrarPago, subirArchivoCompra, METODOS_PAGO, ESTADO_PAGO, ESTADO_COMPRA,
} from '@/lib/comprasRecordatorios'
import { Search, Wallet, Paperclip, Loader2, RefreshCw } from 'lucide-react'

const LABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1'
const fecha = ts => ts ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function ComprasCartera() {
  const { alert: showAlert } = useConfirm()
  const [compras, setCompras] = useState([])
  const [resumen, setResumen] = useState(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [soloSaldo, setSoloSaldo] = useState(true)
  const [abono, setAbono]     = useState(null)   // compra

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const r = await listarCompras({})
      setCompras(r.compras || []); setResumen(r.resumen || null)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudieron cargar las compras' })
    } finally { setLoading(false) }
  }

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return compras
      .map(c => ({ ...c, saldo: Math.max(0, Number(c.total) - Number(c.valor_pagado)) }))
      .filter(c => !c.anulada_en)
      .filter(c => !soloSaldo || c.saldo > 0)
      .filter(c => !t
        || `${c.cliente_nombre} ${c.cliente_apellido}`.toLowerCase().includes(t)
        || (c.mascota_nombre || '').toLowerCase().includes(t)
        || (c.cliente_whatsapp || '').includes(t)
        || `cr-${c.numero}`.includes(t))
  }, [compras, q, soloSaldo])

  const totalSaldo = filas.reduce((a, c) => a + c.saldo, 0)

  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Por cobrar" value={resumen ? fmt(resumen.por_cobrar) : '—'} color="#B45309" />
        <Kpi label="Vendido este mes" value={resumen ? fmt(resumen.vendido_mes) : '—'} />
        <Kpi label="Compras este mes" value={resumen?.compras_mes ?? '—'} />
        <Kpi label="Con saldo" value={compras.filter(c => !c.anulada_en && Number(c.total) > Number(c.valor_pagado)).length} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-9" placeholder="Buscar por cliente, mascota, WhatsApp o número…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-gray-600 cursor-pointer">
          <input type="checkbox" checked={soloSaldo} onChange={e => setSoloSaldo(e.target.checked)} className="accent-[#1A5CD8]" />
          Solo con saldo
        </label>
        <Button size="sm" variant="secondary" onClick={cargar} disabled={loading}><RefreshCw size={12} /> Refrescar</Button>
        <span className="ml-auto text-[12px] text-gray-500">Saldo de lo visible: <b className="text-red-600">{fmt(totalSaldo)}</b></span>
      </div>

      <TableWrap>
        <Table>
          <thead><tr>
            <Th>#</Th><Th>Fecha</Th><Th>Cliente</Th><Th>Mascota</Th><Th>Recordatorios</Th>
            <Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th>Pago</Th><Th>Estado</Th><Th></Th>
          </tr></thead>
          <tbody>
            {loading && !compras.length && <tr><Td colSpan={11} className="text-center text-gray-400 py-8"><Loader2 size={16} className="inline animate-spin mr-2" />Cargando…</Td></tr>}
            {!loading && !filas.length && <tr><Td colSpan={11} className="text-center text-gray-400 py-8">
              {soloSaldo ? 'Ninguna compra de recordatorios debe dinero.' : 'Sin compras registradas.'}</Td></tr>}
            {filas.map(c => (
              <Tr key={c.id}>
                <Td className="font-mono text-[12px] text-gray-500">CR-{c.numero}</Td>
                <Td className="text-[12px] text-gray-500 whitespace-nowrap">{fecha(c.created_at)}</Td>
                <Td><div className="font-semibold text-gray-900 text-[13px]">{c.cliente_nombre} {c.cliente_apellido}</div>
                    <div className="text-[11px] text-gray-400">{c.cliente_whatsapp}</div></Td>
                <Td className="text-[13px]">{petEmoji(c.especie_nombre)} {c.mascota_nombre}</Td>
                <Td className="text-[12px] text-gray-600 max-w-[220px] truncate" title={c.resumen || ''}>{c.resumen || '—'}</Td>
                <Td className="text-right whitespace-nowrap">{fmt(c.total)}</Td>
                <Td className="text-right whitespace-nowrap text-green-700">{fmt(c.valor_pagado)}</Td>
                <Td className="text-right whitespace-nowrap font-bold text-red-600">{c.saldo > 0 ? fmt(c.saldo) : '—'}</Td>
                <Td><Badge variant={ESTADO_PAGO[c.estado_pago]?.variant || 'gray'}>{ESTADO_PAGO[c.estado_pago]?.label || c.estado_pago}</Badge></Td>
                <Td><Badge variant={ESTADO_COMPRA[c.estado]?.variant || 'gray'}>{ESTADO_COMPRA[c.estado]?.label || c.estado}</Badge></Td>
                <Td>{c.saldo > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setAbono(c)}><Wallet size={12} /> Registrar pago</Button>
                )}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {abono && <ModalAbono compra={abono} onClose={() => setAbono(null)} onGuardado={() => { setAbono(null); cargar() }} showAlert={showAlert} />}
    </div>
  )
}

function Kpi({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <div className="text-[18px] font-bold mt-1" style={{ color: color || '#111827' }}>{value}</div>
    </div>
  )
}

function ModalAbono({ compra, onClose, onGuardado, showAlert }) {
  const [monto, setMonto]   = useState(String(compra.saldo))
  const [metodo, setMetodo] = useState('EFECTIVO')
  const [ref, setRef]       = useState('')
  const [file, setFile]     = useState(null)
  const [saving, setSaving] = useState(false)

  async function guardar() {
    const m = Number(monto)
    if (!(m > 0)) return showAlert('Escribe el monto.', { title: 'Falta el monto' })
    if (m > compra.saldo) return showAlert(`El abono supera el saldo (${fmt(compra.saldo)}).`, { title: 'Monto muy alto' })
    setSaving(true)
    try {
      const comprobante_path = file ? await subirArchivoCompra(compra.id, file, 'comprobantes') : null
      await registrarPago(compra.id, { monto: m, metodo, referencia: ref || null, comprobante_path })
      onGuardado()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo registrar el pago' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Registrar pago · CR-${compra.numero}`} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar pago'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="text-[12px] text-gray-600">
          <b>{compra.cliente_nombre} {compra.cliente_apellido}</b> · {compra.mascota_nombre}<br />
          Total {fmt(compra.total)} · pagado {fmt(compra.valor_pagado)} · <span className="text-red-600 font-semibold">saldo {fmt(compra.saldo)}</span>
        </div>
        <div><label className={LABEL}>Monto</label>
          <Input inputMode="numeric" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d]/g, ''))} /></div>
        <div><label className={LABEL}>Medio</label>
          <Select value={metodo} onChange={e => setMetodo(e.target.value)}>
            {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
          </Select></div>
        <div><label className={LABEL}>Referencia</label>
          <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="Opcional" /></div>
        <label className="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-dashed cursor-pointer text-[11px] font-semibold text-amber-700 hover:bg-amber-50 w-fit" style={{ borderColor: '#FBBF24' }}>
          <Paperclip size={12} /> {file ? file.name : 'Adjuntar comprobante (imagen o PDF)'}
          <input type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = '' }} />
        </label>
      </div>
    </Modal>
  )
}
