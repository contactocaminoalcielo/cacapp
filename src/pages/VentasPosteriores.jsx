// VENTAS POSTERIORES — las oportunidades de la oferta posterior al servicio (migr. 210).
//
// REPORTE ORBIT 2026-11-17: «un módulo que permita visualizar todas las
// oportunidades generadas por esta automatización», por categoría
// (Recordatorios · Pre-exequiales · Cédulas), con su estado y seguimiento hasta
// cerrar la venta o el caso.
//
// Cuatro pestañas:
//   · Oportunidades — cada interés de una familia, con su estado y su bitácora.
//   · Envíos        — lo programado y enviado cada día (como /condolencias).
//   · No contactar  — familias que no reciben ofertas.
//   · Configuración — descuentos, tiempos y contenido visual de los planes.
//
// Todo se lee y escribe por orbit-backend: las tablas no están abiertas al
// navegador porque la solicitud trae cédula, dirección y teléfono.
//
// 🔒 Pre-exequiales: esta pantalla NO crea contratos. Valida el pago (una
// persona) y, con el pago validado, lleva a /presequiales con los datos puestos
// para que coordinación cree el contrato como siempre.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { fmt, fmtDateTime, waLink } from '@/lib/utils'
import EnviosOferta from '@/components/ventas-posteriores/EnviosOferta'
import NoContactar from '@/components/ventas-posteriores/NoContactar'
import ConfigOferta from '@/components/ventas-posteriores/ConfigOferta'
import {
  RefreshCw, MessageCircle, Search, ExternalLink, ShieldCheck, FileCheck2, PawPrint, IdCard, Copy, Check,
} from 'lucide-react'

const PESTANAS = [
  { clave: 'oportunidades', label: 'Oportunidades' },
  { clave: 'envios',        label: 'Envíos' },
  { clave: 'no-contactar',  label: 'No contactar' },
  { clave: 'configuracion', label: 'Configuración' },
]

const CATEGORIA = {
  RECORDATORIOS: { label: 'Recordatorios', Icono: PawPrint,    area: 'Diseño / Producción' },
  PREEXEQUIALES: { label: 'Pre-exequiales', Icono: ShieldCheck, area: 'Coordinación' },
  CEDULAS:       { label: 'Cédulas',        Icono: IdCard,      area: 'Diseño / Producción' },
}

const AZUL = { bg: '#EEF3FB', fg: '#3B6FBF' }, AMBAR = { bg: '#FFF8E6', fg: '#9A5500' }
const VERDE = { bg: '#DCFCE7', fg: '#166534' }, GRIS = { bg: '#F3F4F6', fg: '#6B7280' }
// INTERESADO y FORMULARIO_INICIADO van en GRIS y dicen «sin compra»: tocar el
// botón o abrir el enlace NO es una venta (David, 27-nov). Se leían como ventas.
export const ESTADO_VENTA = {
  INTERESADO:          { label: 'Solo tocó el botón · sin compra',   ...GRIS },
  FORMULARIO_INICIADO: { label: 'Abrió el formulario · sin compra', ...GRIS },
  FORMULARIO_COMPLETO: { label: 'Solicitud enviada',    ...AZUL },
  PENDIENTE_PAGO:      { label: 'Pendiente de pago',    ...AMBAR },
  PAGO_REPORTADO:      { label: 'Pago reportado',       ...AMBAR },
  PAGO_VALIDADO:       { label: 'Pago validado',        ...VERDE },
  PENDIENTE_CONTRATO:  { label: 'Pendiente de contrato', ...AMBAR },
  CONTRATO_GENERADO:   { label: 'Contrato generado',    ...VERDE },
  AFILIACION_ACTIVA:   { label: 'Afiliación activa',    ...VERDE },
  COMPRA_REGISTRADA:   { label: 'Compra registrada',    ...VERDE },
  CERRADA_SIN_VENTA:   { label: 'Cerrada sin venta',    ...GRIS },
}
const NIVEL = { BRONCE: 'Bronce', PLATA: 'Plata', ORO: 'Oro', DIAMANTE: 'Diamante' }
const TIPO = { ANUAL: 'Anual', VITALICIO: 'Vitalicio' }
const nombrePlan = p => p ? `${NIVEL[p.nivel] || p.nivel} ${TIPO[p.tipo] || p.tipo}` : '—'
const METODO = { TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', OTRO: 'Otro' }

function Chip({ estado }) {
  const e = ESTADO_VENTA[estado] || { label: estado, ...GRIS }
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: e.bg, color: e.fg }}>{e.label}</span>
}

/** Qué pasó en cada evento de la bitácora, en una línea que se entienda sola. */
function textoEvento(ev) {
  const d = ev.detalle || {}
  const est = x => ESTADO_VENTA[x]?.label || x
  switch (ev.tipo) {
    case 'CREADA': return d.origen === 'BOTON_WHATSAPP' ? 'Tocó el botón en WhatsApp' : 'Abrió la sección en el portal'
    case 'ESTADO': return `${est(d.de)} → ${est(d.a)}${d.compra ? ` · ${d.compra}` : ''}${d.items ? ` · ${d.items}` : ''}${d.plan ? ` · ${d.plan}` : ''}${d.nota ? ` · «${d.nota}»` : ''}${d.origen === 'EQUIPO' ? ' · registrada por el equipo' : ''}`
    case 'PAGO_VALIDADO': return `Pago validado${d.nota ? ` · «${d.nota}»` : ''}`
    case 'PAGO_REPORTADO': return `La familia reemplazó el comprobante${d.metodo ? ` (${METODO[d.metodo] || d.metodo})` : ''}`
    case 'CONTRATO_GENERADO': return `Contrato ${d.numero_contrato || ''} creado en Pre-exequiales`
    case 'SOLICITUD_ACTUALIZADA': return `La familia corrigió su solicitud${d.plan ? ` · ${d.plan}` : ''}`
    case 'COMPRA': return `Otra compra: ${d.compra || ''}${d.items ? ` · ${d.items}` : ''}${d.total ? ` · ${fmt(d.total)}` : ''}`
    case 'NOTA': return `Nota: «${d.nota || ''}»`
    default: return ev.tipo
  }
}

export default function VentasPosteriores() {
  const [pestana, setPestana] = useState('oportunidades')
  return (
    <>
      <Topbar />
      <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        <div role="tablist" aria-label="Ventas posteriores" className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
          {PESTANAS.map(p => (
            <button key={p.clave} role="tab" aria-selected={pestana === p.clave} onClick={() => setPestana(p.clave)}
              className={`px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${pestana === p.clave
                ? 'border-primary-dark text-primary-dark' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {pestana === 'oportunidades' && <Oportunidades />}
        {pestana === 'envios' && <EnviosOferta />}
        {pestana === 'no-contactar' && <NoContactar />}
        {pestana === 'configuracion' && <ConfigOferta />}
      </div>
    </>
  )
}

// ─── Oportunidades ──────────────────────────────────────────────────────────
function Oportunidades() {
  const [datos, setDatos]       = useState(null)
  const [categoria, setCategoria] = useState('')
  // Lo primero que se ve es QUIÉN COMPRÓ. Quien solo tocó el botón o abrió el
  // enlace va aparte («Solo interés»): no es una venta (David, 27-nov).
  const [grupo, setGrupo]       = useState('COMPRA')
  const [estado, setEstado]     = useState('')
  const [q, setQ]               = useState('')
  const [buscando, setBuscando] = useState('')     // lo que realmente se consulta (con espera)
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState('')
  const [abierta, setAbierta]   = useState(null)   // id de la venta en detalle

  useEffect(() => {
    const t = setTimeout(() => setBuscando(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const p = new URLSearchParams()
      if (categoria) p.set('categoria', categoria)
      if (grupo) p.set('grupo', grupo)
      if (estado) p.set('estado', estado)
      if (buscando) p.set('q', buscando)
      const r = await orbitApi(`/ventas-posteriores${p.toString() ? `?${p}` : ''}`)
      setDatos(r); setError('')
    } catch (e) {
      setError(e.message || 'No se pudo cargar')
    } finally { setCargando(false) }
  }, [categoria, grupo, estado, buscando])

  useEffect(() => { cargar() }, [cargar])

  const ventas = datos?.ventas || []
  const resumen = datos?.resumen || []
  // `grupo` lo calcula el backend (COMPRA · INTERES · CERRADA), el mismo CASE de la lista.
  const suma = filas => filas.reduce((a, r) => a + r.n, 0)
  const cuenta = cat => {
    const filas = resumen.filter(r => r.categoria === cat)
    return {
      compraron: suma(filas.filter(r => r.grupo === 'COMPRA')),
      interes: suma(filas.filter(r => r.grupo === 'INTERES')),
    }
  }
  const totalGrupo = g => suma(resumen.filter(r => r.grupo === g && (!categoria || r.categoria === categoria)))
  const porValidar = resumen.filter(r => r.estado === 'PAGO_REPORTADO').reduce((a, r) => a + r.n, 0)

  return (
    <div className="space-y-4">
      {/* Categorías: son el filtro y a la vez el resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(CATEGORIA).map(([clave, c]) => {
          const n = cuenta(clave)
          const activa = categoria === clave
          return (
            <button key={clave} onClick={() => setCategoria(activa ? '' : clave)} aria-pressed={activa}
              className={`text-left rounded-xl border p-3.5 transition-colors ${activa ? 'bg-primary-dark text-white border-transparent' : 'bg-white hover:bg-gray-50'}`}
              style={activa ? undefined : { borderColor: 'rgba(30,80,40,0.12)' }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold"><c.Icono size={15} /> {c.label}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-[22px] font-bold leading-none">{n.compraron}</span>
                <span className={`text-[11.5px] ${activa ? 'text-white/80' : 'text-gray-500'}`}>
                  {clave === 'PREEXEQUIALES' ? `solicitud${n.compraron === 1 ? '' : 'es'}` : `compra${n.compraron === 1 ? '' : 's'}`} · {n.interes} solo interés
                </span>
              </div>
              <div className={`text-[11px] mt-1 ${activa ? 'text-white/70' : 'text-gray-400'}`}>{c.area}</div>
            </button>
          )
        })}
      </div>

      {porValidar > 0 && (
        <button onClick={() => { setEstado('PAGO_REPORTADO'); setCategoria('PREEXEQUIALES') }}
          className="w-full text-left rounded-lg border border-[#FFD980] bg-[#FFF8E6] text-[#9A5500] p-3 text-[12.5px] hover:bg-[#FFF3D1]">
          <strong>{porValidar}</strong> pago{porValidar === 1 ? '' : 's'} de plan pre-exequial por validar. Sin validar el pago no se puede generar el contrato. <span className="underline">Ver</span>
        </button>
      )}

      {/* Compraron / solo interés / cerradas: lo primero es saber quién SÍ compró */}
      <div role="tablist" aria-label="Qué hizo la familia" className="inline-flex rounded-lg border bg-white p-0.5" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
        {[
          ['COMPRA',  'Compraron'],
          ['INTERES', 'Solo interés (sin compra)'],
          ['CERRADA', 'Cerradas sin venta'],
        ].map(([g, label]) => (
          <button key={g} role="tab" aria-selected={grupo === g} onClick={() => { setGrupo(g); setEstado('') }}
            className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${grupo === g ? 'bg-primary-dark text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            {label} <span className={grupo === g ? 'text-white/80' : 'text-gray-400'}>{totalGrupo(g)}</span>
          </button>
        ))}
      </div>
      {grupo === 'INTERES' && (
        <p className="text-[12px] text-gray-500 -mt-2">
          Familias que tocaron un botón de la oferta o abrieron el enlace, pero <strong>no han comprado</strong>. No le llegan a Diseño.
          Si una compra por chat o por teléfono, ábrela y usa «Registrar la compra».
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-9" placeholder="Buscar por mascotica, familia o WhatsApp" aria-label="Buscar" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select aria-label="Estado" value={estado} onChange={e => setEstado(e.target.value)}
          className="text-[13px] border border-gray-200 rounded-lg px-3 py-2.5 bg-white font-medium text-gray-900">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_VENTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          onClick={cargar} title="Actualizar" aria-label="Actualizar"><RefreshCw size={14} /></button>
      </div>

      {error && (
        <div className="rounded-xl border-2 p-4 text-[13px]" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>{error}</div>
      )}

      {cargando && !datos && (
        <div className="flex items-center justify-center h-32 gap-3"><div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span></div>
      )}

      {datos && ventas.length === 0 && (
        <div className="rounded-xl border bg-white p-8 text-center text-[13px] text-gray-500" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {grupo === 'COMPRA' && !estado && !buscando
            ? 'Todavía ninguna familia ha comprado por la oferta. Las que solo tocaron el botón o abrieron el enlace están en «Solo interés».'
            : 'No hay nada con estos filtros.'}
        </div>
      )}

      {ventas.length > 0 && (
        <div className="rounded-xl border bg-white divide-y" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {ventas.map(v => {
            const c = CATEGORIA[v.categoria]
            return (
              <button key={v.id} onClick={() => setAbierta(v.id)}
                className="w-full text-left p-3.5 flex flex-wrap items-start gap-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-[14rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px] text-gray-900">{v.propietario || 'Sin propietario'}</span>
                    <Chip estado={v.estado} />
                    <span className="text-[11px] font-semibold text-gray-500 flex items-center gap-1"><c.Icono size={12} /> {c.label}</span>
                  </div>
                  <div className="text-[12px] text-gray-600 mt-0.5">
                    Servicio de 🐾 {v.mascota}{v.whatsapp ? ` · ${v.whatsapp}` : ''}
                  </div>
                  {/* QUÉ compró: lo primero que tiene que ver Diseño */}
                  {v.compras > 0 && (
                    <div className="text-[12.5px] font-semibold text-gray-900 mt-1">
                      {v.categoria === 'CEDULAS' ? '🪪' : '🛒'} {v.compras_items || 'Compra sin líneas'}
                    </div>
                  )}
                  {v.grupo === 'INTERES' && (
                    <div className="text-[11.5px] text-gray-400 mt-1">Sin compra todavía</div>
                  )}
                  <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
                    {v.categoria === 'PREEXEQUIALES' && v.plan && (
                      <span>Plan {nombrePlan(v.plan)} · {v.n_mascotas} mascotica{v.n_mascotas === 1 ? '' : 's'} · {fmt(Number(v.valor) * v.n_mascotas)}</span>
                    )}
                    {v.numero_contrato && <span>Contrato {v.numero_contrato}</span>}
                    {v.compras > 0 && <span>{v.compras_numeros} · {fmt(v.compras_total)}{Number(v.compras_pagado) >= Number(v.compras_total) ? ' · pagada' : ' · por cobrar'}</span>}
                    {v.motivo_cierre && <span>Cerrada: {v.motivo_cierre}</span>}
                    <span>Último movimiento {fmtDateTime(v.updated_at)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {abierta && <DetalleVenta id={abierta} onClose={() => setAbierta(null)} onCambio={cargar} />}
    </div>
  )
}

// ─── Detalle de una oportunidad ─────────────────────────────────────────────
function Dato({ et, children }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{et}</div>
      <div className="text-[13px] text-gray-900 break-words">{children || '—'}</div>
    </div>
  )
}

function DetalleVenta({ id, onClose, onCambio }) {
  const navigate = useNavigate()
  const { alert: showAlert, confirm } = useConfirm()
  const [d, setD]             = useState(null)
  const [error, setError]     = useState('')
  const [ocupado, setOcupado] = useState('')
  const [nuevoEstado, setNuevoEstado] = useState('')
  const [nota, setNota]       = useState('')
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(async () => {
    try { setD(await orbitApi(`/ventas-posteriores/${id}`)); setError('') }
    catch (e) { setError(e.message || 'No se pudo cargar') }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  async function hacer(clave, fn) {
    setOcupado(clave)
    try { await fn(); await cargar(); onCambio?.() }
    catch (e) { showAlert(e.message, { title: 'No se pudo completar' }) }
    finally { setOcupado('') }
  }

  const v = d?.venta
  const sol = v?.solicitud
  const pc = v?.pago_cliente
  const esPre = v?.categoria === 'PREEXEQUIALES'
  const total = sol ? Number(v.valor || 0) * (sol.mascotas?.length || 0) : 0
  const enlace = v ? `https://orbit.orbitacac.com/#/oferta/${v.codigo}` : ''

  async function validarPago() {
    const ok = await confirm(
      `Vas a confirmar que el pago de ${fmt(total)} YA LLEGÓ. Con esto se puede generar el contrato.`,
      { title: '¿Validar el pago?', variant: 'warning', confirmLabel: 'Sí, el pago llegó' })
    if (!ok) return
    await hacer('validar', () => orbitApi(`/ventas-posteriores/${id}/validar-pago`, { method: 'POST', body: { nota } }))
    setNota('')
  }

  // La familia compró por chat o por teléfono: se registra la compra en
  // Compras de recordatorios con todo puesto (familia, mascotica, descuento).
  // Al guardarla queda ligada a esta oportunidad y entra sola a Producción.
  function registrarCompra() {
    navigate('/compras-recordatorios', {
      state: {
        ventaPosterior: {
          id: v.id, categoria: v.categoria,
          cliente: v.cliente_id ? {
            id_cliente: v.cliente_id, nombre: v.cliente_nombre, apellido: v.cliente_apellido,
            cedula_nit: v.cliente_cedula, whatsapp: v.cliente_whatsapp,
          } : null,
          // Recordatorios: de la mascotica del servicio. Cédula: de una viva (se elige).
          mascota: v.categoria === 'RECORDATORIOS' && v.mascota_id ? { id_mascota: v.mascota_id, nombre: v.mascota } : null,
          descuento_pct: Number(v.descuento_sugerido) || 0,
        },
      },
    })
  }

  function crearAfiliacion() {
    // Coordinación crea el contrato en /presequiales, con los datos de la
    // solicitud ya puestos. Al guardarlo, esa pantalla enlaza el contrato aquí.
    navigate('/presequiales', {
      state: {
        ventaPosterior: {
          id: v.id,
          cliente: v.cliente_id ? {
            id_cliente: v.cliente_id, nombre: v.cliente_nombre, apellido: v.cliente_apellido,
            cedula_nit: v.cliente_cedula, whatsapp: v.cliente_whatsapp,
          } : null,
          propietario: sol.propietario, mascotas: sol.mascotas, plan: sol.plan,
          descuento_pct: Number(v.descuento_pct) || 0, valor_lista: Number(v.valor_lista) || 0,
          metodo: pc?.metodo || null,
        },
      },
    })
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-3xl"
      title={v ? `${CATEGORIA[v.categoria].label} · ${[v.cliente_nombre, v.cliente_apellido].filter(Boolean).join(' ') || 'Sin propietario'}` : 'Oportunidad'}>
      {error && <div className="rounded-lg border p-3 text-[13px] text-red-700 bg-red-50 border-red-200">{error}</div>}
      {!d && !error && <div className="flex items-center justify-center h-32 gap-3"><div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span></div>}

      {v && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip estado={v.estado} />
            <span className="text-[12px] text-gray-500">Le toca a: <strong className="text-gray-700">{CATEGORIA[v.categoria].area}</strong></span>
            {v.cliente_whatsapp && (
              <a href={waLink(v.cliente_whatsapp)} target="_blank" rel="noreferrer"
                className="ml-auto text-[12px] font-semibold text-green-700 flex items-center gap-1 hover:underline">
                <MessageCircle size={13} /> {v.cliente_whatsapp}
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Dato et="Mascotica del servicio">🐾 {v.mascota}</Dato>
            <Dato et="Plan del servicio">{v.plan_servicio}</Dato>
            <Dato et="Oferta enviada">{v.fecha_envio ? fmtDateTime(v.fecha_envio) : 'Aún no (enlace compartido a mano)'}</Dato>
            <Dato et="Interés desde">{fmtDateTime(v.created_at)}</Dato>
          </div>

          {/* ── Recordatorios / cédulas: la compra manda ── */}
          {!esPre && (
            <section className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: '#E5E7EB' }}>
              <div className="text-[13px] font-semibold text-gray-800">
                {v.categoria === 'CEDULAS' ? 'COMPRA ADICIONAL – CÉDULA' : 'COMPRA ADICIONAL – RECORDATORIO'}
              </div>
              {d.compras.length === 0 && (
                <p className="text-[12.5px] text-gray-500">
                  <strong className="text-gray-700">Todavía no ha comprado</strong>: solo tocó el botón o abrió el enlace. Puedes escribirle o reenviarle el enlace de su portal (abajo).
                  Si compra por chat o por teléfono, regístrala aquí: así le llega a Diseño con el producto y los datos.
                </p>
              )}
              {d.compras.map(c => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <strong className="text-gray-900">CR-{c.numero}</strong>
                  <span className="text-gray-600 flex-1 min-w-[10rem]">{c.items}</span>
                  <span className="text-gray-900">{fmt(c.total)}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.anulada_en ? 'bg-gray-100 text-gray-500' : c.estado_pago === 'COMPLETO' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {c.anulada_en ? 'Anulada' : c.estado_pago === 'COMPLETO' ? 'Pagada' : c.estado_pago === 'PARCIAL' ? 'Pago parcial' : 'Por cobrar'}
                  </span>
                </div>
              ))}
              {d.compras.length > 0 && (
                <p className="text-[11.5px] text-gray-500">
                  Ya está en el tablero de Producción como «COMPRA ADICIONAL». El pago, la producción y la entrega se llevan en <button className="underline text-[#1A5CD8]" onClick={() => navigate('/compras-recordatorios')}>Compras de recordatorios</button>.
                </p>
              )}
              <div>
                <Button size="sm" variant={d.compras.length ? 'secondary' : 'gold'} onClick={registrarCompra}>
                  {d.compras.length ? 'Registrar otra compra' : 'Registrar la compra'}
                </Button>
              </div>
            </section>
          )}

          {/* ── Pre-exequiales: la solicitud ── */}
          {esPre && !sol && (
            <p className="text-[12.5px] text-gray-500 rounded-xl border p-3.5" style={{ borderColor: '#E5E7EB' }}>
              La familia mostró interés pero todavía no ha diligenciado el formulario. Puedes escribirle para acompañarla.
            </p>
          )}
          {esPre && sol && (
            <section className="rounded-xl border p-3.5 space-y-3" style={{ borderColor: '#E5E7EB' }}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[13px] font-semibold text-gray-800">Solicitud · Plan {nombrePlan(sol.plan)}</span>
                <span className="text-[12px] text-gray-500">
                  {fmt(v.valor)} por mascotica{Number(v.descuento_pct) > 0 ? ` (lista ${fmt(v.valor_lista)}, −${Number(v.descuento_pct)}%)` : ''} × {sol.mascotas.length} = <strong className="text-gray-900">{fmt(total)}</strong>
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Dato et="Titular">{sol.propietario.nombre} {sol.propietario.apellido}</Dato>
                <Dato et="Documento">{sol.propietario.documento}</Dato>
                <Dato et="Contacto">{sol.propietario.whatsapp}</Dato>
                <Dato et="Correo">{sol.propietario.email}</Dato>
                <Dato et="Dirección">{[sol.propietario.direccion, sol.propietario.ciudad].filter(Boolean).join(', ')}</Dato>
                <Dato et="Forma de pago">{METODO[sol.forma_pago] || sol.forma_pago}</Dato>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400">
                      <th className="py-1 pr-3 font-bold">Mascotica</th><th className="py-1 pr-3 font-bold">Especie</th>
                      <th className="py-1 pr-3 font-bold">Raza</th><th className="py-1 pr-3 font-bold">Sexo</th>
                      <th className="py-1 pr-3 font-bold">Nacimiento / edad</th><th className="py-1 font-bold">Peso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sol.mascotas.map((m, i) => (
                      <tr key={i} className="border-t text-gray-800" style={{ borderColor: '#F3F4F6' }}>
                        <td className="py-1.5 pr-3 font-semibold">{m.nombre}{m.notas ? <span className="block font-normal text-[11px] text-gray-500">{m.notas}</span> : null}</td>
                        <td className="py-1.5 pr-3">{m.especie || '—'}</td>
                        <td className="py-1.5 pr-3">{m.raza || '—'}</td>
                        <td className="py-1.5 pr-3">{m.sexo}</td>
                        <td className="py-1.5 pr-3">{m.fecha_nacimiento || m.edad || '—'}</td>
                        <td className="py-1.5">{m.peso_kg} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pago: lo que la familia DECLARA vs. lo que una persona validó */}
              <div className="rounded-lg p-3 space-y-2" style={{ background: v.pago_validado_en ? '#F0FDF4' : '#FFF8E6' }}>
                {v.pago_validado_en ? (
                  <p className="text-[12.5px] text-green-800 flex items-center gap-1.5">
                    <FileCheck2 size={14} /> Pago validado el {fmtDateTime(v.pago_validado_en)}{v.pago_validado_por_nombre ? ` por ${v.pago_validado_por_nombre}` : ''}.
                  </p>
                ) : pc ? (
                  <p className="text-[12.5px] text-[#7A4A00]">
                    La familia reportó el pago por <strong>{METODO[pc.metodo] || pc.metodo}</strong> el {fmtDateTime(pc.declarado_en)}. <strong>Todavía no está validado.</strong>
                  </p>
                ) : (
                  <p className="text-[12.5px] text-[#7A4A00]">La familia aún no ha reportado el pago.</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {pc?.comprobante_url && (
                    <a href={pc.comprobante_url} target="_blank" rel="noopener noreferrer"
                      className="text-[12.5px] font-semibold text-[#1A5CD8] flex items-center gap-1 hover:underline">
                      <ExternalLink size={12} /> Ver el comprobante
                    </a>
                  )}
                  {!v.pago_validado_en && (
                    <Button size="sm" variant="gold" disabled={ocupado === 'validar'} onClick={validarPago}>
                      {ocupado === 'validar' ? 'Validando…' : 'Validar el pago'}
                    </Button>
                  )}
                  {v.pago_validado_en && !v.afiliacion_id && (
                    <Button size="sm" onClick={crearAfiliacion}>Crear el contrato en Pre-exequiales</Button>
                  )}
                  {v.numero_contrato && <span className="text-[12.5px] text-green-800 font-semibold">Contrato {v.numero_contrato}</span>}
                </div>
                {!v.pago_validado_en && (
                  <p className="text-[11.5px] text-[#7A4A00]">Sin pago validado no se puede generar el contrato ni activar la afiliación.</p>
                )}
              </div>
            </section>
          )}

          {/* Mover de estado / anotar */}
          <section className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: '#E5E7EB' }}>
            <div className="text-[13px] font-semibold text-gray-800">Seguimiento</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select aria-label="Cambiar el estado" value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value)}
                className="text-[12.5px] border border-gray-200 rounded-lg px-2.5 py-2 bg-white">
                <option value="">Solo dejar una nota</option>
                {d.estados.filter(e => e !== v.estado).map(e => <option key={e} value={e}>Pasar a: {ESTADO_VENTA[e]?.label || e}</option>)}
              </select>
              <input value={nota} onChange={e => setNota(e.target.value)} maxLength={500}
                placeholder={nuevoEstado === 'CERRADA_SIN_VENTA' ? '¿Por qué se cierra sin venta? (obligatorio)' : 'Nota (opcional al cambiar de estado)'}
                className="flex-1 min-w-[14rem] text-[12.5px] border border-gray-200 rounded-lg px-2.5 py-2" />
              <Button size="sm" variant="secondary"
                disabled={ocupado === 'mover' || (!nuevoEstado && !nota.trim()) || (nuevoEstado === 'CERRADA_SIN_VENTA' && !nota.trim())}
                onClick={async () => {
                  await hacer('mover', () => nuevoEstado
                    ? orbitApi(`/ventas-posteriores/${id}/estado`, { method: 'POST', body: { estado: nuevoEstado, nota } })
                    : orbitApi(`/ventas-posteriores/${id}/nota`, { method: 'POST', body: { texto: nota } }))
                  setNuevoEstado(''); setNota('')
                }}>
                {ocupado === 'mover' ? '…' : 'Guardar'}
              </Button>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11.5px] text-gray-500 truncate">Portal de esta familia: {enlace}</span>
              <button onClick={async () => { try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sin portapapeles */ } }}
                className="shrink-0 text-[11.5px] font-semibold text-[#1A5CD8] flex items-center gap-1 hover:underline">
                {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
              </button>
            </div>
          </section>

          <section>
            <div className="text-[13px] font-semibold text-gray-800 mb-2">Bitácora</div>
            <ol className="space-y-1.5">
              {d.eventos.map(ev => (
                <li key={ev.id} className="text-[12.5px] text-gray-700 flex flex-wrap gap-x-2">
                  <span className="text-gray-400 whitespace-nowrap">{fmtDateTime(ev.created_at)}</span>
                  <span className="flex-1 min-w-[12rem]">{textoEvento(ev)}</span>
                  <span className="text-gray-400">{ev.por_nombre || 'la familia'}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  )
}
