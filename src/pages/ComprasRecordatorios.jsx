// Compras de recordatorios SIN servicio — cédula de mascota y recuerdos sueltos.
//
// Es el registro de un servicio recortado a lo que hace falta: se combina
// cliente + mascota igual que en Registro.jsx, pero en vez de crear un servicio
// se crea la compra de uno o varios recordatorios del catálogo. La mascota
// puede estar VIVA (la cédula se le hace a la que está en casa).
//
// La compra tiene su propia cola: cada línea avanza PENDIENTE → EN_PROCESO →
// LISTO → ENTREGADO desde el detalle. No entra al tablero de Producción, que
// cuelga del servicio (ver migración 168 para el porqué).
//
// Todo lo que escribe pasa por orbit-backend (lib/comprasRecordatorios.js);
// aquí solo se leen catálogos y se buscan clientes y mascotas por PostgREST.
import { useState, useEffect, useMemo, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { StatCard } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import CasillaDatos from '@/components/CasillaDatos'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { fmt, fmtDateTime, petEmoji, parsearErrorDB } from '@/lib/utils'
import { VERSION as VERSION_POLITICA } from '@/lib/privacidad'
import {
  listarCompras, detalleCompra, crearCompra, registrarPago, actualizarItem, anularCompra,
  cargarCatalogos, buscarClientes, mascotasDeCliente, subirArchivoCompra, urlFirmada,
  METODOS_PAGO, ESTADOS_ITEM, ESTADO_ITEM_META, ESTADO_COMPRA, ESTADO_PAGO,
} from '@/lib/comprasRecordatorios'
import {
  Plus, Search, ShoppingBag, Wallet, Layers, PackageCheck, ChevronRight, ChevronLeft,
  User, Trash2, Paperclip, Loader2, Ban, ImagePlus, Save, AlertTriangle,
} from 'lucide-react'

const LABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1'
const CARD_SEL = 'rounded-xl p-3 border bg-green-50/60 border-green-200'
const BTN_DASHED = 'w-full py-3 text-[12px] font-semibold text-[#1A5CD8] border-2 border-dashed border-green-200 rounded-xl hover:bg-green-50 transition-all flex items-center justify-center gap-2'

const fecha = ts => ts ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const nombreCompleto = c => [c?.nombre, c?.apellido].filter(Boolean).join(' ')

function BadgeCompra({ estado }) {
  const m = ESTADO_COMPRA[estado] || { label: estado, variant: 'gray' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}
function BadgePago({ estado }) {
  const m = ESTADO_PAGO[estado] || { label: estado, variant: 'gray' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

// ═════════════════════════════════════════════════════════════════════════════
export default function ComprasRecordatorios() {
  const { alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  const rol = personalData?.rol
  // El PRODUCTOR mira y mueve las líneas (es quien hace la cédula); vender,
  // cobrar y anular es de coordinación. El backend lo revalida.
  const esCoordinador = rol === 'ADMIN' || rol === 'COORDINADOR'

  const [compras, setCompras]   = useState([])
  const [resumen, setResumen]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [catalogos, setCatalogos] = useState({ recordatorios: [], especies: [], personal: [] })

  const [q, setQ]                 = useState('')
  const [estado, setEstado]       = useState('')
  const [estadoPago, setEstadoPago] = useState('')
  const [desde, setDesde]         = useState('')
  const [hasta, setHasta]         = useState('')

  const [nueva, setNueva]         = useState(false)
  const [verId, setVerId]         = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    cargarCatalogos().then(setCatalogos).catch(() => {})
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(cargar, q ? 350 : 0)
    return () => clearTimeout(debounceRef.current)
  }, [q, estado, estadoPago, desde, hasta])

  async function cargar() {
    setLoading(true)
    try {
      const r = await listarCompras({ q: q.trim(), estado, estadoPago, desde, hasta })
      setCompras(r.compras || []); setResumen(r.resumen || null)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudieron cargar las compras' })
    } finally { setLoading(false) }
  }

  return (
    <>
      <Topbar />
      <div className="p-4 sm:p-6 space-y-5">

        {/* Cifras */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Este mes" value={resumen?.compras_mes ?? '—'}
            sub={resumen ? `${fmt(resumen.vendido_mes)} vendidos` : ''} icon={ShoppingBag} />
          <StatCard label="Por producir" value={resumen?.por_producir ?? '—'} icon={Layers} delay={0.05} />
          <StatCard label="Listas para entregar" value={resumen?.listas ?? '—'} icon={PackageCheck} delay={0.1}
            valueColor={resumen?.listas ? '#059669' : undefined} />
          <StatCard label="Por cobrar" value={resumen ? fmt(resumen.por_cobrar) : '—'} icon={Wallet} delay={0.15}
            valueColor={Number(resumen?.por_cobrar) > 0 ? '#B45309' : undefined} />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="pl-9" placeholder="Buscar por cliente, mascota, cédula, WhatsApp o número…"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select value={estado} onChange={e => setEstado(e.target.value)} className="w-auto">
            <option value="">Todos los estados</option>
            {Object.entries(ESTADO_COMPRA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select value={estadoPago} onChange={e => setEstadoPago(e.target.value)} className="w-auto">
            <option value="">Pago: todos</option>
            {Object.entries(ESTADO_PAGO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="w-auto" title="Desde" />
          <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="w-auto" title="Hasta" />
          {esCoordinador && (
            <Button onClick={() => setNueva(true)}><Plus size={14} /> Nueva compra</Button>
          )}
        </div>

        {/* Lista */}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>#</Th><Th>Fecha</Th><Th>Cliente</Th><Th>Mascota</Th><Th>Recordatorios</Th>
                <Th className="text-right">Total</Th><Th>Pago</Th><Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {loading && compras.length === 0 && (
                <tr><Td colSpan={8} className="text-center text-gray-400 py-10">
                  <Loader2 size={16} className="inline animate-spin mr-2" />Cargando…</Td></tr>
              )}
              {!loading && compras.length === 0 && (
                <tr><Td colSpan={8} className="text-center text-gray-400 py-10">
                  {q || estado || estadoPago || desde || hasta
                    ? 'Ninguna compra coincide con el filtro.'
                    : 'Todavía no hay compras registradas. La primera se crea con «Nueva compra».'}
                </Td></tr>
              )}
              {compras.map(c => (
                <Tr key={c.id} onClick={() => setVerId(c.id)} className={c.anulada_en ? 'opacity-60' : ''}>
                  <Td className="font-mono text-[12px] text-gray-500">CR-{c.numero}</Td>
                  <Td className="text-[12px] text-gray-500 whitespace-nowrap">{fecha(c.created_at)}</Td>
                  <Td>
                    <div className="font-semibold text-gray-900 text-[13px]">{c.cliente_nombre} {c.cliente_apellido}</div>
                    <div className="text-[11px] text-gray-400">{c.cliente_whatsapp}</div>
                  </Td>
                  <Td className="text-[13px]">{petEmoji(c.especie_nombre)} {c.mascota_nombre}</Td>
                  <Td className="text-[12px] text-gray-600 max-w-[260px] truncate" title={c.resumen || ''}>{c.resumen || '—'}</Td>
                  <Td className="text-right font-semibold whitespace-nowrap">{fmt(c.total)}</Td>
                  <Td><BadgePago estado={c.estado_pago} /></Td>
                  <Td><BadgeCompra estado={c.estado} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {nueva && (
        <ModalNuevaCompra
          catalogos={catalogos}
          onClose={() => setNueva(false)}
          onCreada={d => { setNueva(false); cargar(); setVerId(d.id) }}
        />
      )}
      {verId && (
        <ModalDetalle
          id={verId}
          personal={catalogos.personal}
          esCoordinador={esCoordinador}
          onClose={() => setVerId(null)}
          onCambio={cargar}
        />
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// NUEVA COMPRA — cliente → mascota → recordatorios → pago
// ═════════════════════════════════════════════════════════════════════════════
const PASOS = ['Cliente', 'Mascota', 'Recordatorios', 'Pago']

const CLIENTE_VACIO = {
  nombre: '', apellido: '', cedula_nit: '', whatsapp: '', telefono: '',
  email: '', direccion: '', ciudad: 'Bogotá', tipo_cliente: 'NORMAL',
}
const MASCOTA_VACIA = {
  nombre: '', especie_id: '', raza: '', sexo: 'Macho', tamano: 'Mediano',
  peso_kg: '', edad_anios: '', notas: '',
}

function ModalNuevaCompra({ catalogos, onClose, onCreada }) {
  const { alert: showAlert } = useConfirm()
  const { recordatorios, especies } = catalogos
  const [paso, setPaso]     = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Paso 0 — cliente
  const [busq, setBusq]                 = useState('')
  const [resultados, setResultados]     = useState([])
  const [buscando, setBuscando]         = useState(false)
  const [cliente, setCliente]           = useState(null)
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [formCliente, setFormCliente]   = useState(CLIENTE_VACIO)
  const debounceRef = useRef(null)

  // Paso 1 — mascota
  const [mascotas, setMascotas]         = useState([])
  const [mascota, setMascota]           = useState(null)
  const [mascotaNueva, setMascotaNueva] = useState(false)
  const [formMascota, setFormMascota]   = useState(MASCOTA_VACIA)

  // Paso 2 — líneas
  const [items, setItems] = useState([])

  // Paso 3 — pago
  const [pagoOn, setPagoOn]       = useState(false)
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMetodo, setPagoMetodo] = useState('EFECTIVO')
  const [pagoRef, setPagoRef]     = useState('')
  const [comprobante, setComprobante] = useState(null)
  const [notas, setNotas]         = useState('')
  const [autorizo, setAutorizo]   = useState(false)
  const [errAutorizo, setErrAutorizo] = useState(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const t = busq.trim()
    if (!t) { setResultados([]); return }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true)
      try { setResultados(await buscarClientes(t)) } catch { setResultados([]) }
      finally { setBuscando(false) }
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [busq])

  async function elegirCliente(c) {
    setCliente(c); setResultados([]); setBusq('')
    try { setMascotas(await mascotasDeCliente(c.id_cliente)) } catch { setMascotas([]) }
  }

  const total = useMemo(() => items.reduce((a, i) =>
    a + (parseInt(i.cantidad) || 0) * (Number(i.precio_unitario) || 0), 0), [items])
  const hayPrecioCero = items.some(i => i.recordatorio_id && !(Number(i.precio_unitario) > 0))

  function agregarLinea(recId = '') {
    const rec = recordatorios.find(r => r.id === recId)
    setItems(p => [...p, {
      _k: crypto.randomUUID(), recordatorio_id: recId, cantidad: 1,
      precio_unitario: rec ? Number(rec.precio_base) || 0 : '', datos_cliente: {}, notas: '',
    }])
  }
  function cambiarLinea(k, patch) {
    setItems(p => p.map(i => i._k === k ? { ...i, ...patch } : i))
  }
  function elegirRecordatorio(k, recId) {
    const rec = recordatorios.find(r => r.id === recId)
    cambiarLinea(k, { recordatorio_id: recId, precio_unitario: rec ? Number(rec.precio_base) || 0 : '', datos_cliente: {} })
  }

  // Validación por paso: lo mismo que Registro, en pequeño.
  function validarPaso() {
    if (paso === 0) {
      if (cliente) return null
      if (!clienteNuevo) return 'Elige un cliente o crea uno nuevo.'
      if (!formCliente.nombre.trim()) return 'El nombre del cliente es obligatorio.'
      if (!formCliente.whatsapp.trim()) return 'El WhatsApp del cliente es obligatorio.'
      return null
    }
    if (paso === 1) {
      if (mascota) return null
      if (!mascotaNueva) return 'Elige una mascota o registra una nueva.'
      if (!formMascota.nombre.trim()) return 'El nombre de la mascota es obligatorio.'
      return null
    }
    if (paso === 2) {
      if (!items.length) return 'Agrega al menos un recordatorio.'
      if (items.some(i => !i.recordatorio_id)) return 'Hay una línea sin recordatorio elegido.'
      if (items.some(i => !(parseInt(i.cantidad) >= 1))) return 'Cada línea necesita cantidad de al menos 1.'
      if (items.some(i => Number(i.precio_unitario) < 0 || i.precio_unitario === '')) return 'Cada línea necesita un precio (puede ser 0).'
      return null
    }
    return null
  }

  function siguiente() {
    const e = validarPaso()
    if (e) { setError(e); return }
    setError(null)
    if (paso === 2 && !pagoMonto) setPagoMonto(String(total))
    setPaso(p => p + 1)
  }

  async function guardar() {
    setError(null)
    if (!autorizo) { setErrAutorizo('Marca la autorización de datos para guardar.'); return }
    if (pagoOn) {
      const m = Number(pagoMonto)
      if (!(m > 0)) { setError('El monto del pago debe ser mayor a cero.'); return }
      if (m > total) { setError('El pago no puede superar el total de la compra.'); return }
    }
    setSaving(true)
    try {
      // El id nace aquí: el comprobante se sube ANTES bajo esa carpeta y, si la
      // red se cae a mitad, el reintento encuentra la compra en vez de duplicarla.
      const id = crypto.randomUUID()
      let comprobante_path = null
      if (pagoOn && comprobante) comprobante_path = await subirArchivoCompra(id, comprobante, 'comprobantes')
      const body = {
        id,
        cliente: cliente ? { id_cliente: cliente.id_cliente } : { nuevo: formCliente },
        mascota: mascota ? { id_mascota: mascota.id_mascota } : { nueva: formMascota },
        items: items.map(i => ({
          recordatorio_id: i.recordatorio_id,
          cantidad: parseInt(i.cantidad) || 1,
          precio_unitario: Number(i.precio_unitario) || 0,
          datos_cliente: i.datos_cliente,
          notas: i.notas || null,
        })),
        pago: pagoOn ? { monto: Number(pagoMonto), metodo: pagoMetodo, referencia: pagoRef || null, comprobante_path } : null,
        notas: notas || null,
        autorizacion: { aceptada: true, politica_version: VERSION_POLITICA },
      }
      const d = await crearCompra(body)
      onCreada(d)
    } catch (e) {
      setError(e.message || parsearErrorDB(e))
    } finally { setSaving(false) }
  }

  const rec = k => recordatorios.find(r => r.id === k)

  return (
    <Modal open onClose={onClose} title="Nueva compra de recordatorios" maxWidth="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => paso > 0 ? setPaso(p => p - 1) : onClose()} disabled={saving}>
            <ChevronLeft size={14} /> {paso === 0 ? 'Cancelar' : 'Anterior'}
          </Button>
          {paso < PASOS.length - 1
            ? <Button onClick={siguiente}>Siguiente <ChevronRight size={14} /></Button>
            : <Button onClick={guardar} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Guardando…' : `Registrar compra · ${fmt(total)}`}
              </Button>}
        </>
      }>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-wider">
        {PASOS.map((p, i) => (
          <div key={p} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
              i === paso ? 'bg-[#1A5CD8] text-white' : i < paso ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{i + 1}</span>
            <span className={i === paso ? 'text-gray-900' : 'text-gray-400'}>{p}</span>
            {i < PASOS.length - 1 && <ChevronRight size={12} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* ── Paso 0: cliente ── */}
      {paso === 0 && (
        <div className="space-y-3">
          {!cliente && !clienteNuevo && (
            <>
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  {buscando ? <Loader2 size={14} className="animate-spin text-gray-400" /> : <Search size={14} className="text-gray-400" />}
                </div>
                <Input className="pl-9" autoFocus placeholder="Buscar por nombre, cédula o WhatsApp…"
                  value={busq} onChange={e => setBusq(e.target.value)} />
              </div>
              {resultados.map(c => (
                <button key={c.id_cliente} onClick={() => elegirCliente(c)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#1A5CD8]/30 hover:bg-green-50 transition-all text-left">
                  <Avatar nombre={c.nombre} apellido={c.apellido} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{nombreCompleto(c)}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {c.cedula_nit && <span>{c.cedula_nit} · </span>}{c.whatsapp}
                      {c.mascotas && <span className="ml-2 text-[#1A5CD8] font-semibold">{c.mascotas.length} mascota{c.mascotas.length !== 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              ))}
              {busq && !buscando && resultados.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-2">No se encontraron clientes</p>
              )}
              <button className={BTN_DASHED} onClick={() => setClienteNuevo(true)}>
                <User size={14} /> Crear nuevo cliente
              </button>
            </>
          )}

          {cliente && (
            <div className={CARD_SEL}>
              <div className="flex items-center gap-3">
                <Avatar nombre={cliente.nombre} apellido={cliente.apellido} />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{nombreCompleto(cliente)}</div>
                  <div className="text-[12px] text-gray-500">
                    {cliente.whatsapp}{cliente.cedula_nit && ` · CC ${cliente.cedula_nit}`}
                  </div>
                </div>
                <button className="text-[11px] text-red-500 font-semibold"
                  onClick={() => { setCliente(null); setMascotas([]); setMascota(null) }}>Cambiar</button>
              </div>
            </div>
          )}

          {clienteNuevo && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={LABEL}>Nombre *</label>
                  <Input value={formCliente.nombre} maxLength={80} autoFocus
                    onChange={e => setFormCliente(p => ({ ...p, nombre: e.target.value.toUpperCase() }))} /></div>
                <div><label className={LABEL}>Apellido</label>
                  <Input value={formCliente.apellido} maxLength={80}
                    onChange={e => setFormCliente(p => ({ ...p, apellido: e.target.value.toUpperCase() }))} /></div>
                <div><label className={LABEL}>Cédula / NIT</label>
                  <Input value={formCliente.cedula_nit} maxLength={30}
                    onChange={e => setFormCliente(p => ({ ...p, cedula_nit: e.target.value }))} />
                  <p className="text-[10px] text-gray-400 mt-1">Si ya existe un cliente con esta cédula, se usa ese.</p></div>
                <div><label className={LABEL}>WhatsApp *</label>
                  <Input value={formCliente.whatsapp} maxLength={25} placeholder="3001234567"
                    onChange={e => setFormCliente(p => ({ ...p, whatsapp: e.target.value }))} /></div>
                <div><label className={LABEL}>Segundo contacto</label>
                  <Input value={formCliente.telefono} maxLength={25}
                    onChange={e => setFormCliente(p => ({ ...p, telefono: e.target.value }))} /></div>
                <div><label className={LABEL}>Email</label>
                  <Input type="email" value={formCliente.email}
                    onChange={e => setFormCliente(p => ({ ...p, email: e.target.value }))} /></div>
                <div className="sm:col-span-2"><label className={LABEL}>Dirección</label>
                  <Input value={formCliente.direccion}
                    onChange={e => setFormCliente(p => ({ ...p, direccion: e.target.value.toUpperCase() }))} /></div>
                <div><label className={LABEL}>Ciudad</label>
                  <Input value={formCliente.ciudad}
                    onChange={e => setFormCliente(p => ({ ...p, ciudad: e.target.value }))} /></div>
                <div><label className={LABEL}>Tipo cliente</label>
                  <Select value={formCliente.tipo_cliente} onChange={e => setFormCliente(p => ({ ...p, tipo_cliente: e.target.value }))}>
                    <option value="NORMAL">Normal</option><option value="VIP">VIP</option><option value="RECURRENTE">Recurrente</option>
                  </Select></div>
              </div>
              <button className="text-[11px] text-red-500 font-semibold mt-3" onClick={() => setClienteNuevo(false)}>Cancelar</button>
            </div>
          )}
        </div>
      )}

      {/* ── Paso 1: mascota ── */}
      {paso === 1 && (
        <div className="space-y-3">
          {!mascota && !mascotaNueva && (
            <>
              {cliente && mascotas.length > 0 && mascotas.map(m => (
                <button key={m.id_mascota} onClick={() => setMascota(m)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#1A5CD8]/30 hover:bg-green-50 transition-all text-left">
                  <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-lg">{petEmoji(m.especies?.nombre)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900">{m.nombre}
                      {m.fallecida && <span className="ml-2 text-[10px] font-bold text-gray-400 uppercase">fallecida</span>}</div>
                    <div className="text-[11px] text-gray-500">{m.especies?.nombre}{m.raza && ` · ${m.raza}`}{m.peso_kg ? ` · ${m.peso_kg} kg` : ''}</div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              ))}
              {cliente && mascotas.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-2">Este cliente no tiene mascotas registradas.</p>
              )}
              <button className={BTN_DASHED} onClick={() => setMascotaNueva(true)}>+ Registrar nueva mascota</button>
            </>
          )}

          {mascota && (
            <div className={CARD_SEL}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl">{petEmoji(mascota.especies?.nombre)}</div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{mascota.nombre}</div>
                  <div className="text-[12px] text-gray-500">{mascota.especies?.nombre}{mascota.raza && ` · ${mascota.raza}`}</div>
                </div>
                <button className="text-[11px] text-red-500 font-semibold" onClick={() => setMascota(null)}>Cambiar</button>
              </div>
            </div>
          )}

          {mascotaNueva && (
            <div>
              <p className="text-[11px] text-gray-500 mb-3">La mascota se registra <strong>viva</strong>: es la que está en casa y a la que se le hace la cédula.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={LABEL}>Nombre *</label>
                  <Input value={formMascota.nombre} maxLength={80} autoFocus
                    onChange={e => setFormMascota(p => ({ ...p, nombre: e.target.value }))} /></div>
                <div><label className={LABEL}>Especie</label>
                  <Select value={formMascota.especie_id} onChange={e => setFormMascota(p => ({ ...p, especie_id: e.target.value }))}>
                    <option value="">Elegir…</option>
                    {especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </Select></div>
                <div><label className={LABEL}>Raza</label>
                  <Input value={formMascota.raza} maxLength={80} onChange={e => setFormMascota(p => ({ ...p, raza: e.target.value }))} /></div>
                <div><label className={LABEL}>Sexo</label>
                  <Select value={formMascota.sexo} onChange={e => setFormMascota(p => ({ ...p, sexo: e.target.value }))}>
                    <option value="Macho">Macho</option><option value="Hembra">Hembra</option>
                  </Select></div>
                <div><label className={LABEL}>Tamaño</label>
                  <Select value={formMascota.tamano} onChange={e => setFormMascota(p => ({ ...p, tamano: e.target.value }))}>
                    {['Mini', 'Pequeño', 'Mediano', 'Grande', 'Gigante'].map(t => <option key={t} value={t}>{t}</option>)}
                  </Select></div>
                <div><label className={LABEL}>Peso (kg)</label>
                  <Input inputMode="decimal" value={formMascota.peso_kg} placeholder="Opcional"
                    onChange={e => setFormMascota(p => ({ ...p, peso_kg: e.target.value.replace(',', '.') }))} /></div>
                <div><label className={LABEL}>Edad (años)</label>
                  <Input type="number" min="0" max="40" value={formMascota.edad_anios} placeholder="Opcional"
                    onChange={e => setFormMascota(p => ({ ...p, edad_anios: e.target.value }))} /></div>
                <div className="sm:col-span-2"><label className={LABEL}>Notas</label>
                  <Input value={formMascota.notas} onChange={e => setFormMascota(p => ({ ...p, notas: e.target.value }))} /></div>
              </div>
              <button className="text-[11px] text-red-500 font-semibold mt-3" onClick={() => setMascotaNueva(false)}>Cancelar</button>
            </div>
          )}
        </div>
      )}

      {/* ── Paso 2: recordatorios ── */}
      {paso === 2 && (
        <div className="space-y-3">
          {items.map((it, idx) => {
            const r = rec(it.recordatorio_id)
            const campos = r?.campos_texto || []
            return (
              <div key={it._k} className="rounded-xl border border-gray-200 p-3 space-y-2">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className={LABEL}>Recordatorio {idx + 1}</label>
                    <Select value={it.recordatorio_id} onChange={e => elegirRecordatorio(it._k, e.target.value)}>
                      <option value="">Elegir…</option>
                      {recordatorios.map(o => (
                        <option key={o.id} value={o.id}>{o.nombre}{Number(o.precio_base) > 0 ? ` — ${fmt(o.precio_base)}` : ''}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-20">
                    <label className={LABEL}>Cant.</label>
                    <Input type="number" min={1} max={99} value={it.cantidad} className="text-center"
                      onChange={e => cambiarLinea(it._k, { cantidad: e.target.value })} />
                  </div>
                  <div className="w-32">
                    <label className={LABEL}>Precio unit.</label>
                    <Input inputMode="numeric" value={it.precio_unitario}
                      onChange={e => cambiarLinea(it._k, { precio_unitario: e.target.value.replace(/[^\d]/g, '') })} />
                  </div>
                  <button onClick={() => setItems(p => p.filter(x => x._k !== it._k))}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50" title="Quitar">
                    <Trash2 size={14} />
                  </button>
                </div>
                {r && !(Number(it.precio_unitario) > 0) && (
                  <p className="text-[11px] text-amber-700 flex items-center gap-1">
                    <AlertTriangle size={12} /> Este recordatorio queda en $0. Si tiene precio, escríbelo aquí o fíjalo en Configuración › Recordatorios.
                  </p>
                )}
                {campos.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {campos.map(c => (
                      <div key={c.label}>
                        <label className={LABEL}>{c.label}</label>
                        <Input value={it.datos_cliente?.[c.label]?.[0] || ''}
                          onChange={e => cambiarLinea(it._k, { datos_cliente: { ...it.datos_cliente, [c.label]: [e.target.value] } })} />
                      </div>
                    ))}
                  </div>
                )}
                {r?.requiere_imagen && !r?.solo_nombre && (
                  <p className="text-[11px] text-gray-400">Lleva foto: se adjunta en el detalle de la compra, después de registrarla.</p>
                )}
              </div>
            )
          })}
          <button className={BTN_DASHED} onClick={() => agregarLinea('')}><Plus size={14} /> Agregar recordatorio</button>
          <div className="flex justify-between items-center pt-2 text-[13px]">
            <span className="text-gray-500">{items.length} línea{items.length !== 1 ? 's' : ''}</span>
            <span className="font-bold text-gray-900 text-[15px]">Total {fmt(total)}</span>
          </div>
        </div>
      )}

      {/* ── Paso 3: pago y confirmación ── */}
      {paso === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-[12px] space-y-1">
            <div><span className="text-gray-500">Cliente:</span> <strong>{cliente ? nombreCompleto(cliente) : `${formCliente.nombre} ${formCliente.apellido}`.trim()}</strong> · {cliente?.whatsapp || formCliente.whatsapp}</div>
            <div><span className="text-gray-500">Mascota:</span> <strong>{mascota?.nombre || formMascota.nombre}</strong></div>
            <div><span className="text-gray-500">Recordatorios:</span> {items.map(i => `${rec(i.recordatorio_id)?.nombre}${parseInt(i.cantidad) > 1 ? ` ×${i.cantidad}` : ''}`).join(', ')}</div>
            <div className="text-[14px] pt-1"><span className="text-gray-500">Total:</span> <strong>{fmt(total)}</strong></div>
            {hayPrecioCero && <div className="text-amber-700 font-semibold flex items-center gap-1"><AlertTriangle size={12} /> Hay líneas en $0.</div>}
          </div>

          <div className="rounded-xl p-3 space-y-2" style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-amber-800 cursor-pointer select-none">
              <input type="checkbox" checked={pagoOn} onChange={e => setPagoOn(e.target.checked)} className="accent-[#D97706]" />
              El cliente ya pagó (total o abono)
            </label>
            {pagoOn && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className={LABEL}>Monto</label>
                  <Input inputMode="numeric" value={pagoMonto} onChange={e => setPagoMonto(e.target.value.replace(/[^\d]/g, ''))} /></div>
                <div><label className={LABEL}>Medio</label>
                  <Select value={pagoMetodo} onChange={e => setPagoMetodo(e.target.value)}>
                    {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select></div>
                <div><label className={LABEL}>Referencia</label>
                  <Input value={pagoRef} onChange={e => setPagoRef(e.target.value)} placeholder="Opcional" /></div>
                <div className="sm:col-span-3">
                  <label className="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-dashed cursor-pointer text-[11px] font-semibold text-amber-700 hover:bg-amber-50 w-fit" style={{ borderColor: '#FBBF24' }}>
                    <Paperclip size={12} /> {comprobante ? comprobante.name : 'Adjuntar comprobante (imagen o PDF)'}
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={e => { setComprobante(e.target.files?.[0] || null); e.target.value = '' }} />
                  </label>
                </div>
                {Number(pagoMonto) > 0 && Number(pagoMonto) < total && (
                  <p className="sm:col-span-3 text-[11px] text-amber-700">Queda pendiente {fmt(total - Number(pagoMonto))}. Los abonos siguientes se registran desde el detalle.</p>
                )}
              </div>
            )}
            {!pagoOn && <p className="text-[11px] text-amber-700">La compra queda <strong>sin pagar</strong> y aparece en «Por cobrar».</p>}
          </div>

          <div><label className={LABEL}>Notas de la compra</label>
            <Textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Cómo se entrega, quién recoge, detalles del diseño…" /></div>

          <CasillaDatos variante="interno" checked={autorizo}
            onChange={v => { setAutorizo(v); if (v) setErrAutorizo(null) }} error={errAutorizo} />
        </div>
      )}
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// DETALLE — líneas con su estado, pagos, anulación y bitácora
// ═════════════════════════════════════════════════════════════════════════════
function ModalDetalle({ id, personal, esCoordinador, onClose, onCambio }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [d, setD]             = useState(null)
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [urls, setUrls]       = useState({})   // path → url firmada

  // Abono
  const [abono, setAbono]       = useState(false)
  const [abMonto, setAbMonto]   = useState('')
  const [abMetodo, setAbMetodo] = useState('EFECTIVO')
  const [abRef, setAbRef]       = useState('')
  const [abFile, setAbFile]     = useState(null)

  // Anular
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo]     = useState('')

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    setLoading(true)
    try {
      const det = await detalleCompra(id)
      setD(det)
      firmar(det)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo abrir la compra' })
      onClose()
    } finally { setLoading(false) }
  }

  // Las rutas del bucket se firman al abrir; una URL pública no serviría (el
  // bucket es privado) y una vieja apuntaría al Cloud muerto.
  async function firmar(det) {
    const paths = new Set()
    det.items.forEach(i => (i.imagenes_urls || []).forEach(p => paths.add(p)))
    det.pagos.forEach(p => p.comprobante_path && paths.add(p.comprobante_path))
    const entries = await Promise.all([...paths].map(async p => [p, await urlFirmada(p)]))
    setUrls(Object.fromEntries(entries))
  }

  async function ejecutar(fn, ok) {
    setOcupado(true)
    try {
      const det = await fn()
      setD(det); firmar(det); onCambio?.()
      if (ok) await showAlert(ok, { title: 'Listo', variant: 'success' })
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally { setOcupado(false) }
  }

  const saldo = d ? Number(d.total) - Number(d.valor_pagado) : 0
  const activa = d && !d.anulada_en

  async function guardarAbono() {
    const m = Number(abMonto)
    if (!(m > 0)) return showAlert('Escribe el monto del abono.', { title: 'Falta el monto' })
    if (m > saldo) return showAlert(`El abono supera lo pendiente (${fmt(saldo)}).`, { title: 'Monto muy alto' })
    await ejecutar(async () => {
      const comprobante_path = abFile ? await subirArchivoCompra(id, abFile, 'comprobantes') : null
      return registrarPago(id, { monto: m, metodo: abMetodo, referencia: abRef || null, comprobante_path })
    })
    setAbono(false); setAbMonto(''); setAbRef(''); setAbFile(null)
  }

  async function confirmarAnular() {
    if (!motivo.trim()) return showAlert('Escribe el motivo.', { title: 'Falta el motivo' })
    const ok = await confirm('La compra quedará anulada. Los pagos registrados se conservan como constancia.',
      { title: `¿Anular la CR-${d.numero}?`, variant: 'danger', confirmLabel: 'Anular' })
    if (!ok) return
    await ejecutar(() => anularCompra(id, motivo.trim()))
    setAnulando(false)
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-4xl"
      title={d ? `Compra CR-${d.numero} · ${fecha(d.created_at)}` : 'Compra'}>
      {loading || !d ? (
        <div className="py-10 text-center text-gray-400"><Loader2 size={18} className="inline animate-spin mr-2" />Cargando…</div>
      ) : (
        <div className="space-y-5">

          {/* Cabecera */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-100 p-3">
              <div className={LABEL}>Cliente</div>
              <div className="font-semibold text-gray-900">{nombreCompleto(d.cliente)}</div>
              <div className="text-[12px] text-gray-500">{d.cliente?.whatsapp}{d.cliente?.cedula_nit && ` · CC ${d.cliente.cedula_nit}`}</div>
              {d.cliente?.direccion && <div className="text-[11px] text-gray-400 mt-1">{d.cliente.direccion}{d.cliente.ciudad && `, ${d.cliente.ciudad}`}</div>}
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <div className={LABEL}>Mascota</div>
              <div className="font-semibold text-gray-900">{petEmoji(d.mascota?.especie)} {d.mascota?.nombre}
                {d.mascota?.fallecida && <span className="ml-2 text-[10px] font-bold text-gray-400 uppercase">fallecida</span>}</div>
              <div className="text-[12px] text-gray-500">
                {[d.mascota?.especie, d.mascota?.raza, d.mascota?.sexo,
                  d.mascota?.edad_anios != null ? `${d.mascota.edad_anios} años` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 p-3 space-y-1">
              <div className="flex items-center gap-2"><BadgeCompra estado={d.estado} /><BadgePago estado={d.estado_pago} /></div>
              <div className="text-[13px]"><span className="text-gray-500">Total</span> <strong>{fmt(d.total)}</strong>
                <span className="text-gray-400"> · pagado {fmt(d.valor_pagado)}</span></div>
              {saldo > 0 && activa && <div className="text-[12px] font-semibold text-amber-700">Pendiente {fmt(saldo)}</div>}
              <div className="text-[11px] text-gray-400">Registró {d.registrado_por_nombre || '—'}</div>
            </div>
          </div>

          {d.anulada_en && (
            <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
              <strong>Anulada</strong> el {fmtDateTime(d.anulada_en)} por {d.anulada_por_nombre || '—'}: {d.motivo_anulacion}
            </div>
          )}
          {d.notas && <div className="text-[12px] text-gray-600 rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-400">Notas:</span> {d.notas}</div>}

          {/* Líneas */}
          <div>
            <div className={LABEL}>Recordatorios</div>
            <div className="space-y-2">
              {d.items.map(it => (
                <LineaItem key={it.id} it={it} compraId={id} personal={personal} urls={urls}
                  activa={activa} ocupado={ocupado} onGuardar={fn => ejecutar(fn)} />
              ))}
            </div>
          </div>

          {/* Pagos */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className={LABEL}>Pagos</div>
              {esCoordinador && activa && saldo > 0 && !abono && (
                <Button size="sm" variant="secondary" onClick={() => { setAbono(true); setAbMonto(String(saldo)) }}>
                  <Wallet size={12} /> Registrar abono
                </Button>
              )}
            </div>
            {d.pagos.length === 0 && <p className="text-[12px] text-gray-400">Sin pagos registrados.</p>}
            {d.pagos.map(p => (
              <div key={p.id} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-400 whitespace-nowrap">{fmtDateTime(p.created_at)}</span>
                <span className="font-semibold text-gray-900">{fmt(p.monto)}</span>
                <Badge variant="gray">{p.metodo}</Badge>
                {p.referencia && <span className="text-gray-500">ref. {p.referencia}</span>}
                <span className="text-gray-400 flex-1 truncate">{p.registrado_por_nombre}</span>
                {p.comprobante_path && (
                  urls[p.comprobante_path]
                    ? <a href={urls[p.comprobante_path]} target="_blank" rel="noopener noreferrer" className="text-[#1A5CD8] font-semibold flex items-center gap-1"><Paperclip size={12} /> comprobante</a>
                    : <span className="text-gray-300"><Paperclip size={12} /></span>
                )}
              </div>
            ))}
            {abono && (
              <div className="mt-2 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end" style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
                <div><label className={LABEL}>Monto</label>
                  <Input inputMode="numeric" value={abMonto} onChange={e => setAbMonto(e.target.value.replace(/[^\d]/g, ''))} /></div>
                <div><label className={LABEL}>Medio</label>
                  <Select value={abMetodo} onChange={e => setAbMetodo(e.target.value)}>
                    {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select></div>
                <div><label className={LABEL}>Referencia</label>
                  <Input value={abRef} onChange={e => setAbRef(e.target.value)} /></div>
                <label className="flex items-center justify-center gap-1.5 h-10 px-2 rounded-lg border border-dashed cursor-pointer text-[11px] font-semibold text-amber-700 hover:bg-amber-50 truncate" style={{ borderColor: '#FBBF24' }}>
                  <Paperclip size={12} /> {abFile ? abFile.name : 'Comprobante'}
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { setAbFile(e.target.files?.[0] || null); e.target.value = '' }} />
                </label>
                <div className="sm:col-span-4 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAbono(false)} disabled={ocupado}>Cancelar</Button>
                  <Button size="sm" onClick={guardarAbono} disabled={ocupado}>Guardar abono</Button>
                </div>
              </div>
            )}
          </div>

          {/* Anular */}
          {esCoordinador && activa && (
            <div className="border-t border-gray-100 pt-3">
              {!anulando ? (
                <button onClick={() => setAnulando(true)} className="text-[12px] font-semibold text-red-500 hover:text-red-700 flex items-center gap-1">
                  <Ban size={12} /> Anular esta compra
                </button>
              ) : (
                <div className="flex gap-2 items-end">
                  <div className="flex-1"><label className={LABEL}>Motivo de la anulación</label>
                    <Input value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus placeholder="Por qué se anula" /></div>
                  <Button size="sm" variant="ghost" onClick={() => setAnulando(false)}>Cancelar</Button>
                  <Button size="sm" variant="danger" onClick={confirmarAnular} disabled={ocupado}>Anular</Button>
                </div>
              )}
            </div>
          )}

          {/* Bitácora */}
          <div>
            <div className={LABEL}>Bitácora</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {d.eventos.map(ev => (
                <div key={ev.id} className="text-[11px] text-gray-500 flex gap-2">
                  <span className="whitespace-nowrap text-gray-400">{fmtDateTime(ev.created_at)}</span>
                  <span className="text-gray-700">{textoEvento(ev)}</span>
                  <span className="text-gray-400 ml-auto whitespace-nowrap">{ev.por_nombre || ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function textoEvento(ev) {
  const x = ev.detalle || {}
  switch (ev.tipo) {
    case 'CREADA':      return `Compra registrada · ${x.items} línea${x.items !== 1 ? 's' : ''} · ${fmt(x.total)}${x.cliente_nuevo ? ' · cliente nuevo' : ''}${x.mascota_nueva ? ' · mascota nueva' : ''}`
    case 'PAGO':        return `Pago ${fmt(x.monto)} por ${x.metodo}${x.inicial ? ' (al registrar)' : ''}`
    case 'ESTADO_ITEM': return `${x.item}: ${ESTADO_ITEM_META[x.de]?.label || x.de} → ${ESTADO_ITEM_META[x.a]?.label || x.a}`
    case 'DATOS_ITEM':  return `${x.item}: se actualizó ${(x.campos || []).join(', ')}`
    case 'ANULADA':     return `Anulada: ${x.motivo}`
    default:            return ev.tipo
  }
}

// Una línea de la compra: estado, asignado, datos del cliente, fotos y notas.
function LineaItem({ it, compraId, personal, urls, activa, ocupado, onGuardar }) {
  const { alert: showAlert } = useConfirm()
  const campos = it.campos_texto || []
  const [datos, setDatos]   = useState(it.datos_cliente || {})
  const [notas, setNotas]   = useState(it.notas || '')
  const [sucio, setSucio]   = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  useEffect(() => { setDatos(it.datos_cliente || {}); setNotas(it.notas || ''); setSucio(false) }, [it.id, it.datos_cliente, it.notas])

  const meta = ESTADO_ITEM_META[it.estado] || ESTADO_ITEM_META.PENDIENTE
  const tomaFotos = it.requiere_imagen && !it.solo_nombre && (it.max_fotos ?? 1) > 0
  const fotos = it.imagenes_urls || []

  async function subirFoto(file) {
    if (!file) return
    setSubiendo(true)
    try {
      const path = await subirArchivoCompra(compraId, file, 'fotos')
      await onGuardar(() => actualizarItem(compraId, it.id, { imagenes_urls: [...fotos, path] }))
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo subir la foto' })
    } finally { setSubiendo(false) }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[160px]">
          <div className="font-semibold text-gray-900 text-[13px]">{it.nombre}{it.cantidad > 1 && <span className="text-gray-400"> ×{it.cantidad}</span>}</div>
          <div className="text-[11px] text-gray-400">{fmt(it.precio_unitario)} c/u · {fmt(it.subtotal)}
            {it.fecha_inicio_prod && ` · inicio ${it.fecha_inicio_prod}`}{it.fecha_fin_prod && ` · listo ${it.fecha_fin_prod}`}{it.fecha_entrega && ` · entregado ${it.fecha_entrega}`}</div>
        </div>
        {/* Estado: pastillas, la actual resaltada. Un clic cambia y guarda. */}
        <div className="flex gap-1">
          {ESTADOS_ITEM.map(e => {
            const on = e.valor === it.estado
            return (
              <button key={e.valor} disabled={!activa || ocupado || on}
                onClick={() => onGuardar(() => actualizarItem(compraId, it.id, { estado: e.valor }))}
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all disabled:cursor-default"
                style={on
                  ? { background: e.bg, color: e.text, border: `1.5px solid ${e.border}` }
                  : { background: '#fff', color: '#9CA3AF', border: '1.5px solid #E5E7EB', opacity: activa ? 1 : 0.5 }}>
                {e.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Asignado a</label>
          <Select value={it.asignado_a || ''} disabled={!activa || ocupado}
            onChange={e => onGuardar(() => actualizarItem(compraId, it.id, { asignado_a: e.target.value || null }))}>
            <option value="">Sin asignar</option>
            {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido || ''}</option>)}
          </Select>
        </div>
        <div>
          <label className={LABEL}>Notas de producción</label>
          <Input value={notas} disabled={!activa} onChange={e => { setNotas(e.target.value); setSucio(true) }} />
        </div>
        {campos.map(c => (
          <div key={c.label}>
            <label className={LABEL}>{c.label}</label>
            <Input value={datos?.[c.label]?.[0] || ''} disabled={!activa}
              onChange={e => { setDatos(p => ({ ...p, [c.label]: [e.target.value] })); setSucio(true) }} />
          </div>
        ))}
      </div>
      {sucio && activa && (
        <div className="flex justify-end">
          <Button size="sm" disabled={ocupado}
            onClick={() => onGuardar(() => actualizarItem(compraId, it.id, { datos_cliente: datos, notas })).then(() => setSucio(false))}>
            <Save size={12} /> Guardar datos
          </Button>
        </div>
      )}

      {tomaFotos && (
        <div>
          <label className={LABEL}>Foto{(it.max_fotos ?? 1) > 1 ? `s (${fotos.length}/${it.max_fotos})` : ''}</label>
          <div className="flex flex-wrap gap-2 items-center">
            {fotos.map(p => (
              urls[p]
                ? <a key={p} href={urls[p]} target="_blank" rel="noopener noreferrer">
                    <img src={urls[p]} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                  </a>
                : <div key={p} className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200" />
            ))}
            {activa && fotos.length < (it.max_fotos ?? 1) && (
              <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-[#1A5CD8] hover:text-[#1A5CD8] cursor-pointer text-[10px] font-semibold">
                {subiendo ? <Loader2 size={14} className="animate-spin" /> : <><ImagePlus size={16} /> Subir</>}
                <input type="file" accept="image/*" className="hidden" disabled={subiendo || ocupado}
                  onChange={e => { subirFoto(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
            {fotos.length === 0 && !activa && <span className="text-[11px] text-gray-400">Sin foto</span>}
          </div>
        </div>
      )}
    </div>
  )
}
