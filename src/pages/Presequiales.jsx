import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { db } from '@/lib/supabase'
import { fmt, waLink, today, parseDate, petEmoji } from '@/lib/utils'
import {
  NIVELES, cargarConfigAfiliaciones, generarNumeroContrato, calcularCobroActivacion,
  sumarUnAnio, subirComprobanteAfiliacion, abrirArchivoStorage, generarContratoPdf,
} from '@/lib/afiliaciones'
import { Plus, RefreshCw, Rocket, FileText, Paperclip, MessageCircle, Search, RotateCw } from 'lucide-react'

// Afiliaciones pre-exequiales: ANUAL (renovable, cláusula 5×/3× solo el primer
// año) y VITALICIO (un pago, cubierta de por vida). Reglas y formato del número
// de contrato en src/lib/afiliaciones.js.

const FILTROS = [
  { key: 'VIGENTES',  label: 'Vigentes' },
  { key: 'POR_VENCER', label: 'Por vencer' },
  { key: 'VENCIDAS',  label: 'Vencidas' },
  { key: 'ACTIVADAS', label: 'Activadas' },
  { key: 'CANCELADAS', label: 'Canceladas' },
  { key: 'TODAS',     label: 'Todas' },
]

const NIVEL_COLORS = {
  BRONCE:   { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
  PLATA:    { bg: '#F0F0F0', text: '#555555', border: '#DDDDDD' },
  ORO:      { bg: '#FFF8E1', text: '#8A6D00', border: '#C4A87A' },
  DIAMANTE: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
}

const ESTADO_BADGE = {
  VIGENTE:   'bg-green-light text-primary-dark',
  VENCIDA:   'bg-[#FFF3DC] text-[#9A5500]',
  ACTIVADA:  'bg-[#EDE9FE] text-[#5B21B6]',
  CANCELADA: 'bg-danger-light text-danger',
}

const LABEL = 'text-[11px] font-bold text-ink3 block mb-1'

// Contrato vigente = el de mayor número (el vitalicio solo tiene el 0)
const contratoVigente = a =>
  (a.afiliacion_contratos || []).reduce((max, c) => (!max || c.numero > max.numero ? c : max), null)

const diasPara = fechaISO => {
  if (!fechaISO) return null
  return Math.round((parseDate(fechaISO) - parseDate(today())) / 86400000)
}

export default function Presequiales() {
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const { personalData } = useAuth()

  const [data, setData]         = useState([])
  const [config, setConfig]     = useState(null)
  const [planes, setPlanes]     = useState([])
  const [especies, setEspecies] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [filtro, setFiltro]     = useState('VIGENTES')
  const [busqueda, setBusqueda] = useState('')

  const [modalNueva, setModalNueva]   = useState(false)
  const [ficha, setFicha]             = useState(null)   // afiliación abierta
  const [modalRenovar, setModalRenovar] = useState(null)
  const [modalActivar, setModalActivar] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [cfg, { data: d, error: e1 }, { data: pls }, { data: esp }] = await Promise.all([
        cargarConfigAfiliaciones(),
        db.from('afiliaciones')
          .select('*, clientes(id_cliente,nombre,apellido,whatsapp,cedula_nit,direccion,ciudad), mascotas(id_mascota,nombre,fallecida,especies(nombre)), afiliacion_contratos(*)')
          .order('created_at', { ascending: false }),
        db.from('planes').select('id,codigo,nombre').eq('activo', true),
        db.from('especies').select('id,nombre').order('nombre'),
      ])
      if (e1) throw e1
      setConfig(cfg)
      setData(d || [])
      setPlanes(pls || [])
      setEspecies(esp || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // La ficha abierta se refresca desde la lista recargada
  useEffect(() => {
    if (ficha) setFicha(data.find(a => a.id === ficha.id) || null)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const diasAviso = parseInt(config?.dias_aviso_renovacion) || 30

  const porVencer = a => {
    if (a.tipo !== 'ANUAL' || !['VIGENTE', 'VENCIDA'].includes(a.estado)) return false
    const d = diasPara(contratoVigente(a)?.fecha_vencimiento)
    return d !== null && d <= diasAviso
  }

  const filtrados = useMemo(() => {
    let out = data
    if (filtro === 'VIGENTES')  out = data.filter(a => a.estado === 'VIGENTE')
    if (filtro === 'POR_VENCER') out = data.filter(porVencer)
    if (filtro === 'VENCIDAS')  out = data.filter(a => a.estado === 'VENCIDA')
    if (filtro === 'ACTIVADAS') out = data.filter(a => a.estado === 'ACTIVADA')
    if (filtro === 'CANCELADAS') out = data.filter(a => a.estado === 'CANCELADA')
    const q = busqueda.trim().toLowerCase()
    if (q) out = out.filter(a =>
      `${a.clientes?.nombre} ${a.clientes?.apellido} ${a.clientes?.cedula_nit} ${a.mascotas?.nombre}`.toLowerCase().includes(q) ||
      (a.afiliacion_contratos || []).some(c => (c.numero_contrato || '').toLowerCase().includes(q)))
    return out
  }, [data, filtro, busqueda, diasAviso]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const vigentes  = data.filter(a => a.estado === 'VIGENTE').length
  const nPorVencer = data.filter(porVencer).length
  const recaudado = data.reduce((acc, a) => acc + (a.afiliacion_contratos || []).reduce((s, c) => s + (parseFloat(c.valor) || 0), 0), 0)
  const activadas = data.filter(a => a.estado === 'ACTIVADA').length

  return (
    <div>
      <Topbar actions={
        <>
          <Button size="sm" onClick={() => setModalNueva(true)}><Plus size={14} /> Nueva afiliación</Button>
          <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
            <RefreshCw size={15} />
          </button>
        </>
      } />
      <div className="p-4 sm:p-7">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Vigentes" value={vigentes} valueColor="#1D8A55" />
          <StatCard label="Por vencer" value={nPorVencer} valueColor="#9A5500" />
          <StatCard label="Recaudado" value={fmt(recaudado)} valueColor="#3B6FBF" />
          <StatCard label="Activadas" value={activadas} valueColor="#5B21B6" />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {FILTROS.map(f => (
              <button key={f.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => setFiltro(f.key)}>
                {f.label}{f.key === 'POR_VENCER' && nPorVencer > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#9A5500] text-white text-[10px]">{nPorVencer}</span>}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Cliente, mascota o Nº contrato..." className="pl-8 w-64" />
          </div>
        </div>

        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th><Th>Mascota</Th><Th>Plan</Th><Th>Contrato vigente</Th>
                <Th>Vence</Th><Th>Valor</Th><Th>Estado</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(a => {
                const c = a.clientes, m = a.mascotas
                const ct = contratoVigente(a)
                const nc = NIVEL_COLORS[a.nivel] || {}
                const dias = a.tipo === 'ANUAL' ? diasPara(ct?.fecha_vencimiento) : null
                return (
                  <Tr key={a.id} className="cursor-pointer" onClick={() => setFicha(a)}>
                    <Td>
                      <div className="font-semibold text-ink">{c?.nombre} {c?.apellido}</div>
                      <div className="text-[10px] text-ink3">{c?.cedula_nit}</div>
                    </Td>
                    <Td className="text-ink2">{petEmoji(m?.especies?.nombre)} {m?.nombre}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: nc.bg, color: nc.text, borderColor: nc.border }}>{a.nivel}</span>
                      <span className="ml-1.5 text-[10px] font-semibold text-ink3">{a.tipo === 'VITALICIO' ? 'Vitalicio' : 'Anual'}</span>
                    </Td>
                    <Td className="font-mono text-[11px] text-ink2">{ct?.numero_contrato || '—'}</Td>
                    <Td>
                      {a.tipo === 'VITALICIO'
                        ? <span className="text-[11px] font-semibold text-primary-dark">De por vida</span>
                        : ct?.fecha_vencimiento
                          ? <div>
                              <div className="text-[12px] text-ink2">{ct.fecha_vencimiento}</div>
                              {['VIGENTE','VENCIDA'].includes(a.estado) && dias !== null && (
                                <div className={`text-[10px] font-bold ${dias < 0 ? 'text-danger' : dias <= diasAviso ? 'text-[#9A5500]' : 'text-ink3'}`}>
                                  {dias < 0 ? `Vencida hace ${-dias} d` : `Faltan ${dias} d`}
                                </div>)}
                            </div>
                          : '—'}
                    </Td>
                    <Td className="font-semibold text-ink">{fmt(ct?.valor)}</Td>
                    <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[a.estado] || ''}`}>{a.estado}</span></Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {porVencer(a) && c?.whatsapp && (
                          <a href={waLink(c.whatsapp, mensajeRenovacion(a, ct, config))} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-primary-dark bg-green-light hover:opacity-80">
                            <MessageCircle size={11} /> Recordar
                          </a>
                        )}
                        {['VIGENTE','VENCIDA'].includes(a.estado) && (
                          <Button size="sm" variant="gold" onClick={() => setModalActivar({ afiliacion: a })}>
                            <Rocket size={11} /> Activar
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-ink3 text-sm">Sin afiliaciones en este filtro</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {modalNueva && (
        <ModalNuevaAfiliacion config={config} especies={especies} personalData={personalData}
          onClose={() => setModalNueva(false)}
          onSaved={async () => { setModalNueva(false); await cargar() }} />
      )}

      {ficha && (
        <ModalFicha afiliacion={ficha} config={config} personalData={personalData}
          onClose={() => setFicha(null)}
          onRenovar={() => setModalRenovar({ afiliacion: ficha })}
          onActivar={() => setModalActivar({ afiliacion: ficha })}
          onCancelar={async () => {
            const ok = await confirm(
              `La afiliación de ${ficha.mascotas?.nombre} quedará CANCELADA. Si el cliente quiere volver, se afilia de nuevo desde cero (contrato 0, cláusulas reactivadas). ¿Continuar?`,
              { title: 'Cancelar afiliación', confirmLabel: 'Sí, cancelar' },
            )
            if (!ok) return
            await db.from('afiliaciones').update({ estado: 'CANCELADA' }).eq('id', ficha.id)
            await cargar()
          }}
          onChanged={cargar} />
      )}

      {modalRenovar && (
        <ModalRenovar afiliacion={modalRenovar.afiliacion} config={config} personalData={personalData}
          onClose={() => setModalRenovar(null)}
          onSaved={async () => { setModalRenovar(null); await cargar() }} />
      )}

      {modalActivar && (
        <ModalActivar afiliacion={modalActivar.afiliacion} config={config} planes={planes}
          onClose={() => setModalActivar(null)}
          onConfirm={({ plan, cobro, motivo }) => {
            navigate('/registro', {
              state: {
                presequial: {
                  id:          modalActivar.afiliacion.id,
                  cliente_id:  modalActivar.afiliacion.cliente_id,
                  mascota_id:  modalActivar.afiliacion.mascota_id,
                  plan_id:     plan.id,
                  nivel:       modalActivar.afiliacion.nivel,
                  tipo:        modalActivar.afiliacion.tipo,
                  valor_plan_override: cobro,
                  motivo,
                },
              },
            })
          }} />
      )}
    </div>
  )
}

function mensajeRenovacion(a, ct, config) {
  const precio = parseFloat(config?.precios?.ANUAL?.[a.nivel]) || parseFloat(ct?.valor) || 0
  return `Hola ${a.clientes?.nombre} 👋 Te escribimos de Camino al Cielo 🌈\n\n` +
    `La afiliación pre-exequial ${a.nivel} de ${a.mascotas?.nombre} vence el ${ct?.fecha_vencimiento}. ` +
    `Renovarla por un año más tiene un valor de ${fmt(precio)} y mantiene a ${a.mascotas?.nombre} con su servicio cubierto.\n\n¿Deseas renovarla?`
}

// ─── Nueva afiliación: buscar-o-crear cliente y mascota + primer contrato ────
function ModalNuevaAfiliacion({ config, especies, personalData, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const [saving, setSaving] = useState(false)

  // cliente
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [cliente, setCliente] = useState(null)
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [formCliente, setFormCliente] = useState({ nombre: '', apellido: '', cedula_nit: '', whatsapp: '', email: '', direccion: '', ciudad: 'Bogotá' })
  const debounceRef = useRef(null)

  // mascota
  const [mascotasCliente, setMascotasCliente] = useState([])
  const [mascota, setMascota] = useState(null)
  const [mascotaNueva, setMascotaNueva] = useState(false)
  const [formMascota, setFormMascota] = useState({ nombre: '', especie_id: '', raza: '', sexo: 'Macho', tamano: 'Pequeño', peso_kg: '' })

  // plan + pago
  const [tipo, setTipo]   = useState('ANUAL')
  const [nivel, setNivel] = useState('BRONCE')
  const [fechaInicio, setFechaInicio] = useState(today())
  const [valor, setValor] = useState('')
  const [valorTocado, setValorTocado] = useState(false)
  const [metodoPago, setMetodoPago] = useState('EFECTIVO')
  const [fechaPago, setFechaPago] = useState(today())
  const [comprobanteFile, setComprobanteFile] = useState(null)
  const [notas, setNotas] = useState('')

  // Precio de configuración al cambiar tipo/nivel (editable si el coordinador lo pisa)
  useEffect(() => {
    if (valorTocado) return
    const p = parseFloat(config?.precios?.[tipo]?.[nivel])
    setValor(p > 0 ? String(p) : '')
  }, [tipo, nivel]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = clienteBusqueda.trim()
    if (!q || cliente) { setResultados([]); return }
    debounceRef.current = setTimeout(async () => {
      const { data } = await db.from('clientes')
        .select('id_cliente,nombre,apellido,cedula_nit,whatsapp')
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,cedula_nit.ilike.%${q}%,whatsapp.ilike.%${q}%`)
        .limit(8)
      setResultados(data || [])
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [clienteBusqueda, cliente])

  async function elegirCliente(c) {
    setCliente(c); setClienteNuevo(false); setResultados([]); setClienteBusqueda('')
    const { data } = await db.from('mascotas')
      .select('id_mascota,nombre,fallecida,peso_kg,especies(nombre)')
      .eq('cliente_id', c.id_cliente).order('nombre')
    setMascotasCliente(data || [])
  }

  const clienteListo = cliente || (clienteNuevo && formCliente.nombre.trim() && formCliente.whatsapp.trim() && formCliente.cedula_nit.trim())
  const mascotaLista = mascota || (mascotaNueva && formMascota.nombre.trim() && formMascota.especie_id)
  const valorNum = parseFloat(valor) || 0
  const puedeGuardar = clienteListo && mascotaLista && valorNum > 0 && !saving

  const previewCodigo = (clienteListo && !saving) ? generarNumeroContrato({
    fechaInicio,
    cliente: cliente || formCliente,
    nivel, tipo, numero: 0,
  }) : null

  async function guardar() {
    setSaving(true)
    try {
      let clienteId = cliente?.id_cliente
      if (!clienteId) {
        const { data, error } = await db.from('clientes').insert({
          nombre: formCliente.nombre.trim(), apellido: formCliente.apellido.trim() || null,
          cedula_nit: formCliente.cedula_nit.trim(), whatsapp: formCliente.whatsapp.trim(),
          email: formCliente.email.trim() || null, direccion: formCliente.direccion.trim() || null,
          ciudad: formCliente.ciudad || 'Bogotá', tipo_cliente: 'NORMAL',
        }).select('id_cliente').single()
        if (error) throw error
        clienteId = data.id_cliente
      }

      let mascotaId = mascota?.id_mascota
      if (!mascotaId) {
        const { data, error } = await db.from('mascotas').insert({
          nombre: formMascota.nombre.trim(),
          especie_id: parseInt(formMascota.especie_id) || null,
          raza: formMascota.raza.trim() || null,
          sexo: formMascota.sexo, tamano: formMascota.tamano,
          peso_kg: parseFloat(formMascota.peso_kg) || 0,
          cliente_id: clienteId, fallecida: false,
        }).select('id_mascota').single()
        if (error) throw error
        mascotaId = data.id_mascota
      }

      const { data: afil, error: e1 } = await db.from('afiliaciones').insert({
        tipo, nivel, cliente_id: clienteId, mascota_id: mascotaId,
        estado: 'VIGENTE', notas: notas.trim() || null,
        creado_por: personalData?.id || null,
      }).select('id').single()
      if (e1) {
        if (e1.code === '23505') throw new Error('Esta mascota ya tiene una afiliación viva. Búscala en la lista.')
        throw e1
      }

      const comprobantes = []
      if (comprobanteFile) comprobantes.push(await subirComprobanteAfiliacion(afil.id, comprobanteFile))

      const numeroContrato = generarNumeroContrato({
        fechaInicio, cliente: cliente || formCliente, nivel, tipo, numero: 0,
      })
      const { error: e2 } = await db.from('afiliacion_contratos').insert({
        afiliacion_id: afil.id, numero: 0, numero_contrato: numeroContrato,
        fecha_inicio: fechaInicio,
        fecha_vencimiento: tipo === 'ANUAL' ? sumarUnAnio(fechaInicio) : null,
        valor: valorNum, metodo_pago: metodoPago, fecha_pago: fechaPago || null,
        comprobantes, creado_por: personalData?.id || null,
      })
      if (e2) throw e2
      await onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  const cfgPrecio = parseFloat(config?.precios?.[tipo]?.[nivel]) || 0

  return (
    <Modal open onClose={onClose} title="Nueva afiliación pre-exequial" maxWidth="max-w-2xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={!puedeGuardar}>{saving ? 'Guardando...' : 'Afiliar'}</Button>
      </>}>
      <div className="space-y-5">
        {/* Cliente */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide">1 · Titular</h4>
            {!cliente && (
              <button className="text-[11px] font-semibold text-primary-dark hover:underline"
                onClick={() => { setClienteNuevo(v => !v); setResultados([]) }}>
                {clienteNuevo ? '← Buscar cliente existente' : '+ Cliente nuevo (no ha tomado servicio)'}
              </button>
            )}
          </div>
          {cliente ? (
            <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
              <div>
                <div className="font-semibold text-ink text-[13px]">{cliente.nombre} {cliente.apellido}</div>
                <div className="text-[11px] text-ink3">{cliente.cedula_nit} · {cliente.whatsapp}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => { setCliente(null); setMascota(null); setMascotasCliente([]) }}>Cambiar</Button>
            </div>
          ) : clienteNuevo ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL}>Nombre *</label><Input value={formCliente.nombre} onChange={e => setFormCliente(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div><label className={LABEL}>Apellido</label><Input value={formCliente.apellido} onChange={e => setFormCliente(p => ({ ...p, apellido: e.target.value }))} /></div>
              <div><label className={LABEL}>Cédula / NIT *</label><Input value={formCliente.cedula_nit} onChange={e => setFormCliente(p => ({ ...p, cedula_nit: e.target.value }))} /></div>
              <div><label className={LABEL}>WhatsApp *</label><Input value={formCliente.whatsapp} onChange={e => setFormCliente(p => ({ ...p, whatsapp: e.target.value }))} /></div>
              <div><label className={LABEL}>Email</label><Input value={formCliente.email} onChange={e => setFormCliente(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className={LABEL}>Ciudad</label><Input value={formCliente.ciudad} onChange={e => setFormCliente(p => ({ ...p, ciudad: e.target.value }))} /></div>
              <div className="col-span-2"><label className={LABEL}>Dirección</label><Input value={formCliente.direccion} onChange={e => setFormCliente(p => ({ ...p, direccion: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-[13px] text-ink3" />
              <Input value={clienteBusqueda} onChange={e => setClienteBusqueda(e.target.value)}
                placeholder="Buscar por nombre, cédula o WhatsApp..." className="pl-8" />
              {resultados.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                  {resultados.map(r => (
                    <button key={r.id_cliente} onClick={() => elegirCliente(r)}
                      className="w-full text-left px-3 py-2 hover:bg-surface2 border-b last:border-0" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                      <div className="font-semibold text-ink text-[13px]">{r.nombre} {r.apellido}</div>
                      <div className="text-[11px] text-ink3">{r.cedula_nit} · {r.whatsapp}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {clienteNuevo && !formCliente.cedula_nit.trim() && formCliente.nombre && (
            <p className="text-[11px] text-[#9A5500] mt-1">La cédula es necesaria: hace parte del número de contrato.</p>
          )}
        </section>

        {/* Mascota */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide">2 · Mascota</h4>
            {!mascota && (cliente || clienteNuevo) && (
              <button className="text-[11px] font-semibold text-primary-dark hover:underline"
                onClick={() => setMascotaNueva(v => !v)}>
                {mascotaNueva ? '← Elegir de la lista' : '+ Mascota nueva'}
              </button>
            )}
          </div>
          {mascota ? (
            <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
              <div className="font-semibold text-ink text-[13px]">{petEmoji(mascota.especies?.nombre)} {mascota.nombre} <span className="text-ink3 font-normal">({mascota.especies?.nombre})</span></div>
              <Button size="sm" variant="ghost" onClick={() => setMascota(null)}>Cambiar</Button>
            </div>
          ) : (mascotaNueva || clienteNuevo || !cliente) ? (
            <div className="grid grid-cols-3 gap-3">
              <div><label className={LABEL}>Nombre *</label><Input value={formMascota.nombre} onChange={e => setFormMascota(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div><label className={LABEL}>Especie *</label>
                <Select value={formMascota.especie_id} onChange={e => setFormMascota(p => ({ ...p, especie_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {especies.map(e2 => <option key={e2.id} value={e2.id}>{e2.nombre}</option>)}
                </Select></div>
              <div><label className={LABEL}>Raza</label><Input value={formMascota.raza} onChange={e => setFormMascota(p => ({ ...p, raza: e.target.value }))} /></div>
              <div><label className={LABEL}>Sexo</label>
                <Select value={formMascota.sexo} onChange={e => setFormMascota(p => ({ ...p, sexo: e.target.value }))}>
                  <option>Macho</option><option>Hembra</option>
                </Select></div>
              <div><label className={LABEL}>Tamaño</label>
                <Select value={formMascota.tamano} onChange={e => setFormMascota(p => ({ ...p, tamano: e.target.value }))}>
                  <option>Mini</option><option>Pequeño</option><option>Mediano</option><option>Grande</option><option>Gigante</option>
                </Select></div>
              <div><label className={LABEL}>Peso (kg)</label><Input type="number" min="0" step="0.1" value={formMascota.peso_kg} onChange={e => setFormMascota(p => ({ ...p, peso_kg: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {mascotasCliente.filter(m => !m.fallecida).map(m => (
                <button key={m.id_mascota} onClick={() => setMascota(m)}
                  className="w-full text-left px-3 py-2 rounded-lg border hover:bg-surface2 flex items-center justify-between" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                  <span className="font-semibold text-ink text-[13px]">{petEmoji(m.especies?.nombre)} {m.nombre} <span className="text-ink3 font-normal">({m.especies?.nombre})</span></span>
                </button>
              ))}
              {mascotasCliente.filter(m => !m.fallecida).length === 0 && (
                <p className="text-[12px] text-ink3">Este cliente no tiene mascotas registradas vivas — crea una con "+ Mascota nueva".</p>
              )}
            </div>
          )}
        </section>

        {/* Plan */}
        <section>
          <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">3 · Plan</h4>
          <div className="flex gap-2 mb-3">
            {['ANUAL', 'VITALICIO'].map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className={`flex-1 px-3 py-2 rounded-xl border-2 text-left transition-all ${tipo === t ? 'border-primary-dark bg-green-light' : 'border-transparent bg-surface2 hover:bg-surface3'}`}>
                <div className="font-bold text-ink text-[13px]">{t === 'ANUAL' ? 'Anual' : 'Vitalicio'}</div>
                <div className="text-[10px] text-ink3">{t === 'ANUAL' ? 'Un pago cada año · renovable · cláusula el primer año' : 'Un solo pago · cubierta de por vida'}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {NIVELES.map(n => {
              const ncol = NIVEL_COLORS[n]
              const precio = parseFloat(config?.precios?.[tipo]?.[n]) || 0
              return (
                <button key={n} onClick={() => setNivel(n)}
                  className={`px-2 py-2 rounded-xl border-2 text-center transition-all ${nivel === n ? '' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: ncol.bg, borderColor: nivel === n ? ncol.text : 'transparent' }}>
                  <div className="text-[11px] font-bold" style={{ color: ncol.text }}>{n}</div>
                  <div className="text-[10px] font-semibold text-ink2">{precio > 0 ? fmt(precio) : 'Sin precio'}</div>
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={LABEL}>Fecha de afiliación</label>
              <Input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} /></div>
            <div><label className={LABEL}>Valor {cfgPrecio > 0 && valorNum !== cfgPrecio ? '(pisado a mano)' : ''}</label>
              <Input type="number" min="0" value={valor} onChange={e => { setValor(e.target.value); setValorTocado(true) }} /></div>
            <div><label className={LABEL}>Vence</label>
              <Input value={tipo === 'ANUAL' ? sumarUnAnio(fechaInicio) : 'Nunca (vitalicio)'} disabled readOnly /></div>
          </div>
          {cfgPrecio === 0 && (
            <p className="text-[11px] text-[#9A5500] mt-1.5">Este nivel no tiene precio en Configuración › Afiliaciones — se usará el valor que digites.</p>
          )}
          {previewCodigo && (
            <p className="text-[11px] text-ink3 mt-2">Nº de contrato: <span className="font-mono font-bold text-ink">{previewCodigo}</span></p>
          )}
        </section>

        {/* Pago */}
        <section>
          <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">4 · Pago</h4>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={LABEL}>Método</label>
              <Select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="TARJETA">Tarjeta</option>
                <option value="OTRO">Otro</option>
              </Select></div>
            <div><label className={LABEL}>Fecha de pago</label>
              <Input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} /></div>
            <div><label className={LABEL}>Comprobante</label>
              <input type="file" accept="image/*,application/pdf" className="text-[11px] w-full pt-1.5"
                onChange={e => setComprobanteFile(e.target.files?.[0] || null)} /></div>
          </div>
          <div className="mt-3"><label className={LABEL}>Notas</label>
            <Textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} /></div>
        </section>
      </div>
    </Modal>
  )
}

// ─── Ficha: cadena de contratos, comprobantes, PDF, acciones ─────────────────
function ModalFicha({ afiliacion: a, config, personalData, onClose, onRenovar, onActivar, onCancelar, onChanged }) {
  const { alert: showAlert } = useConfirm()
  const [subiendo, setSubiendo] = useState(null)   // id del contrato al que se le sube comprobante
  const [pdfGen, setPdfGen] = useState(null)
  const nc = NIVEL_COLORS[a.nivel] || {}
  const contratos = [...(a.afiliacion_contratos || [])].sort((x, y) => y.numero - x.numero)

  async function subirComprobante(contrato, file) {
    if (!file) return
    setSubiendo(contrato.id)
    try {
      const comp = await subirComprobanteAfiliacion(a.id, file)
      await db.from('afiliacion_contratos')
        .update({ comprobantes: [...(contrato.comprobantes || []), comp] })
        .eq('id', contrato.id)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error subiendo el comprobante' })
    } finally {
      setSubiendo(null)
    }
  }

  async function pdfContrato(contrato) {
    setPdfGen(contrato.id)
    try {
      const doc = await generarContratoPdf({ contrato, afiliacion: a, cliente: a.clientes, mascota: a.mascotas })
      const nombre = `Contrato_${contrato.numero_contrato}.pdf`
      // El PDF queda SIEMPRE en storage además de descargarse
      const blob = doc.output('blob')
      const path = `afiliaciones/${a.id}/${nombre}`
      await db.storage.from('evidencias').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
      if (contrato.pdf_path !== path)
        await db.from('afiliacion_contratos').update({ pdf_path: path }).eq('id', contrato.id)
      doc.save(nombre)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error generando el PDF' })
    } finally {
      setPdfGen(null)
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl"
      title={<span>{a.clientes?.nombre} {a.clientes?.apellido} · {petEmoji(a.mascotas?.especies?.nombre)} {a.mascotas?.nombre}</span>}
      footer={<>
        {['VIGENTE','VENCIDA'].includes(a.estado) && (
          <Button variant="ghost" className="text-danger mr-auto" onClick={onCancelar}>Cancelar afiliación</Button>
        )}
        {a.tipo === 'ANUAL' && ['VIGENTE','VENCIDA'].includes(a.estado) && (
          <Button variant="secondary" onClick={onRenovar}><RotateCw size={13} /> Renovar</Button>
        )}
        {['VIGENTE','VENCIDA'].includes(a.estado) && (
          <Button variant="gold" onClick={onActivar}><Rocket size={13} /> Activar (falleció)</Button>
        )}
      </>}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ background: nc.bg, color: nc.text, borderColor: nc.border }}>{a.nivel}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-ink2">{a.tipo === 'VITALICIO' ? 'VITALICIO' : 'ANUAL'}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[a.estado] || ''}`}>{a.estado}</span>
        <span className="text-[11px] text-ink3">CC {a.clientes?.cedula_nit} · {a.clientes?.whatsapp}</span>
      </div>

      {a.estado === 'ACTIVADA' && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-[#EDE9FE] text-[#5B21B6] text-[12px] font-medium">
          Activada el {a.fecha_activacion} — el servicio quedó vinculado a esta afiliación.
        </div>
      )}

      <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">Contratos</h4>
      <div className="space-y-2">
        {contratos.map(c => (
          <div key={c.id} className="border rounded-xl px-3 py-2.5" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-mono font-bold text-ink text-[13px]">{c.numero_contrato}</div>
                <div className="text-[11px] text-ink3">
                  {c.numero === 0 ? (a.tipo === 'VITALICIO' ? 'Contrato vitalicio' : 'Contrato nuevo') : `Renovación Nº ${c.numero}`}
                  {' · '}{c.fecha_inicio}{c.fecha_vencimiento ? ` → ${c.fecha_vencimiento}` : ' → de por vida'}
                </div>
                <div className="text-[11px] text-ink2 font-semibold">{fmt(c.valor)}{c.metodo_pago ? ` · ${c.metodo_pago}` : ''}{c.fecha_pago ? ` · pagado ${c.fecha_pago}` : ''}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {(c.comprobantes || []).map((comp, i) => (
                  <button key={i} onClick={() => abrirArchivoStorage(comp.storage_path, comp.bucket)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-surface2 text-ink2 hover:bg-surface3">
                    <Paperclip size={11} /> Comp. {i + 1}
                  </button>
                ))}
                <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-surface2 text-ink2 hover:bg-surface3 cursor-pointer">
                  <Paperclip size={11} /> {subiendo === c.id ? 'Subiendo...' : '+ Comprobante'}
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; subirComprobante(c, f) }} />
                </label>
                <Button size="sm" variant="ghost" onClick={() => pdfContrato(c)} disabled={pdfGen === c.id}>
                  <FileText size={12} /> {pdfGen === c.id ? '...' : 'PDF'}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {contratos.length === 0 && <p className="text-[12px] text-ink3">Sin contratos — esto no debería pasar.</p>}
      </div>

      {a.notas && <p className="text-[12px] text-ink3 mt-4"><span className="font-bold">Notas:</span> {a.notas}</p>}
    </Modal>
  )
}

// ─── Renovar (solo ANUAL): contrato N+1 con continuidad desde el vencimiento ─
function ModalRenovar({ afiliacion: a, config, personalData, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const ct = contratoVigente(a)
  const numero = (ct?.numero ?? 0) + 1
  // Continuidad: la renovación arranca donde venció la anterior (no se pierden
  // días por renovar antes; renovar dentro de la gracia conserva el aniversario).
  const inicio = ct?.fecha_vencimiento || today()
  const precioCfg = parseFloat(config?.precios?.ANUAL?.[a.nivel]) || 0

  const [valor, setValor] = useState(precioCfg > 0 ? String(precioCfg) : String(ct?.valor || ''))
  const [metodoPago, setMetodoPago] = useState('EFECTIVO')
  const [fechaPago, setFechaPago] = useState(today())
  const [comprobanteFile, setComprobanteFile] = useState(null)
  const [saving, setSaving] = useState(false)

  const numeroContrato = generarNumeroContrato({
    fechaInicio: ct?.fecha_inicio || inicio,   // el código conserva la fecha de LA AFILIACIÓN original
    cliente: a.clientes, nivel: a.nivel, tipo: a.tipo, numero,
  })

  async function guardar() {
    setSaving(true)
    try {
      const comprobantes = []
      if (comprobanteFile) comprobantes.push(await subirComprobanteAfiliacion(a.id, comprobanteFile))
      const { error } = await db.from('afiliacion_contratos').insert({
        afiliacion_id: a.id, numero, numero_contrato: numeroContrato,
        fecha_inicio: inicio, fecha_vencimiento: sumarUnAnio(inicio),
        valor: parseFloat(valor) || 0, metodo_pago: metodoPago, fecha_pago: fechaPago || null,
        comprobantes, creado_por: personalData?.id || null,
      })
      if (error) throw error
      // Desde la primera renovación la cláusula queda suspendida y vuelve a VIGENTE
      await db.from('afiliaciones').update({ estado: 'VIGENTE' }).eq('id', a.id)
      await onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo renovar' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Renovar afiliación — ${a.mascotas?.nombre}`} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !(parseFloat(valor) > 0)}>{saving ? 'Guardando...' : 'Renovar'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="bg-surface2 rounded-lg px-3 py-2 text-[12px] text-ink2">
          Renovación <strong>Nº {numero}</strong> · vigencia <strong>{inicio} → {sumarUnAnio(inicio)}</strong><br />
          Nº de contrato: <span className="font-mono font-bold text-ink">{numeroContrato}</span><br />
          <span className="text-primary-dark font-semibold">Al renovar se suspenden las cláusulas del primer año.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Valor {precioCfg > 0 ? '' : '(sin precio en Config)'}</label>
            <Input type="number" min="0" value={valor} onChange={e => setValor(e.target.value)} /></div>
          <div><label className={LABEL}>Método de pago</label>
            <Select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="OTRO">Otro</option>
            </Select></div>
          <div><label className={LABEL}>Fecha de pago</label>
            <Input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} /></div>
          <div><label className={LABEL}>Comprobante</label>
            <input type="file" accept="image/*,application/pdf" className="text-[11px] w-full pt-1.5"
              onChange={e => setComprobanteFile(e.target.files?.[0] || null)} /></div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Activar (falleció): cobro por cláusula + plan de servicio equivalente ───
function ModalActivar({ afiliacion: a, config, planes, onClose, onConfirm }) {
  const ct = contratoVigente(a)
  const { cobro, motivo } = calcularCobroActivacion({ afiliacion: a, contratoVigente: ct, config })

  const planPorCodigo = codigo => planes.find(p => p.codigo === codigo)
  const planFijo = a.nivel !== 'ORO' ? planPorCodigo(config?.plan_equivalente?.[a.nivel]) : null
  const oroOpciones = (config?.oro_opciones || []).map(planPorCodigo).filter(Boolean)
  const [planElegido, setPlanElegido] = useState(planFijo || null)

  return (
    <Modal open onClose={onClose} title={`Activar afiliación — ${a.mascotas?.nombre}`} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="gold" disabled={!planElegido}
          onClick={() => onConfirm({ plan: planElegido, cobro, motivo })}>
          <Rocket size={13} /> Continuar al registro
        </Button>
      </>}>
      <div className="space-y-4">
        <div className={`rounded-xl px-4 py-3 ${cobro > 0 ? 'bg-[#FFF3DC]' : 'bg-green-light'}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-0.5" style={{ color: cobro > 0 ? '#9A5500' : '#1D8A55' }}>
            Cobro del servicio
          </div>
          <div className="text-[20px] font-bold" style={{ color: cobro > 0 ? '#9A5500' : '#1D8A55' }}>
            {cobro > 0 ? fmt(cobro) : 'Cubierto — $0'}
          </div>
          <div className="text-[11px] text-ink2 mt-0.5">{motivo}</div>
          <div className="text-[10px] text-ink3 mt-1">El transporte fuera de Bogotá se suma en el registro según la tarifa del municipio.</div>
        </div>

        {a.nivel === 'ORO' ? (
          <div>
            <div className={LABEL}>El plan ORO elige su servicio:</div>
            <div className="grid grid-cols-1 gap-1.5">
              {oroOpciones.map(p => (
                <button key={p.id} onClick={() => setPlanElegido(p)}
                  className={`px-3 py-2 rounded-xl border-2 text-left text-[13px] font-semibold transition-all ${planElegido?.id === p.id ? 'border-primary-dark bg-green-light text-ink' : 'border-transparent bg-surface2 text-ink2 hover:bg-surface3'}`}>
                  {p.nombre}
                </button>
              ))}
              {oroOpciones.length === 0 && <p className="text-[12px] text-danger">No se encontraron los planes ORO en el catálogo — revisar Configuración.</p>}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink2">
            Plan de servicio: <strong>{planFijo?.nombre || `No encontrado (${config?.plan_equivalente?.[a.nivel] || '—'})`}</strong>
          </p>
        )}

        <p className="text-[11px] text-ink3">
          Se abrirá el registro con el cliente, la mascota y el plan precargados. La afiliación quedará
          ACTIVADA solo cuando el servicio se cree (si cancelas el registro, no pasa nada).
        </p>
      </div>
    </Modal>
  )
}
