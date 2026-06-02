import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { EstadoBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { db, dbAdmin } from '@/lib/supabase'
import { petEmoji, fmt, parsearErrorDB, today } from '@/lib/utils'
import { ESTADO_COLOR, ESTADO_LABEL } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { crearNotificacion, obtenerNoLeidas, marcarLeida } from '@/lib/notificaciones'
import {
  MessageCircle, RefreshCw, AlertTriangle, Package,
  LayoutGrid, Table2, Search, X, ChevronUp, ChevronDown,
  User, MapPin, CreditCard, Pencil, Save, MessageSquare, Send,
  Camera, Download, Images, Truck,
} from 'lucide-react'
import ModalPreparaEntrega from '@/components/delivery/ModalPreparaEntrega'

// ── Columnas por tablero ──────────────────────────────────────────────────────
const COLS_COORDINACION = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO']
const COLS_PRODUCCION   = ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO']
const TODAS_COLS        = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO']

const COLS_POR_ROL = {
  COORDINADOR: COLS_COORDINACION,
  PRODUCTOR:   COLS_PRODUCCION,
}

const COL_STYLE = {
  INGRESADO:      { bar: '#3B82F6', dot: '#DBEAFE' },
  EN_RECOGIDA:    { bar: '#F59E0B', dot: '#FEF3C7' },
  EN_CUARTO_FRIO: { bar: '#06B6D4', dot: '#CFFAFE' },
  EN_PROCESO:     { bar: '#8B5CF6', dot: '#EDE9FE' },
  EN_PRODUCCION:  { bar: '#F97316', dot: '#FFEDD5' },
  LISTO:          { bar: '#10B981', dot: '#D1FAE5' },
  EN_ENTREGA:     { bar: '#6366F1', dot: '#E0E7FF' },
  ENTREGADO:      { bar: '#6B7280', dot: '#F3F4F6' },
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return null
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="text-gray-600" />
    : <ChevronDown size={11} className="text-gray-600" />
}

function EvidenciasColapsable({ fotos }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#FED7AA' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-orange-50"
        style={{ background: '#FFF7ED' }}
      >
        <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: '#C2410C' }}>
          <Camera size={12} /> Evidencias del técnico ({fotos.length} foto{fotos.length !== 1 ? 's' : ''})
        </span>
        {open ? <ChevronUp size={13} style={{ color: '#C2410C' }} /> : <ChevronDown size={13} style={{ color: '#C2410C' }} />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 grid grid-cols-3 gap-2" style={{ background: '#FFF7ED' }}>
          {fotos.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="group relative rounded-lg overflow-hidden bg-orange-100 block"
              style={{ aspectRatio: '1/1' }}
              title={f.label}
            >
              <img src={f.url} alt={f.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[9px] font-semibold text-white leading-tight"
                style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}>
                {f.emoji} {f.label}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Kanban() {
  const { alert: showAlert, confirm } = useConfirm()
  const { personalData } = useAuth()
  const rol = personalData?.rol

  // ── Estado tablero activo (solo para ADMIN) ───────────────────────────────
  const [tableroActivo, setTableroActivo] = useState('coordinacion') // 'coordinacion' | 'produccion'

  // Derivados de rol
  const esAdmin     = rol === 'ADMIN'
  const esProductor = rol === 'PRODUCTOR'
  const puedeVerImagenes = esAdmin || esProductor

  const COLUMNAS = esAdmin
    ? (tableroActivo === 'produccion' ? COLS_PRODUCCION : COLS_COORDINACION)
    : (COLS_POR_ROL[rol] ?? TODAS_COLS)

  const esVistaProd = esProductor || (esAdmin && tableroActivo === 'produccion')
  const colLabel    = col => (esVistaProd && col === 'EN_CUARTO_FRIO') ? 'Pendiente' : ESTADO_LABEL[col]

  // ── Estado botones Contactar / Notificar técnico ──
  const [contactarLoadingId,  setContactarLoadingId]  = useState(null)
  const [notifTecLoadingId,   setNotifTecLoadingId]   = useState(null)

  // ── Solicitudes de clientes ───────────────────────────────────────────────
  const [solicitudes,    setSolicitudes]    = useState([])
  const [selSolicitud,   setSelSolicitud]   = useState(null)
  const [convirtiendo,   setConvirtiendo]   = useState(false)
  const [planesKanban,   setPlanesKanban]   = useState([])
  const [especiesKanban, setEspeciesKanban] = useState([])
  const [aliados,        setAliados]        = useState([])
  const [convForm, setConvForm] = useState({
    tipo_acompanamiento: 'PRESENCIAL', estado_pago: 'PENDIENTE',
    metodo_pago: '', tecnico_id: '', valor_total: '', mascota_sexo: 'Macho',
  })

  // ── Data ──────────────────────────────────────────────────────────────────
  const [servicios, setServicios]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [vista, setVista]                 = useState('kanban')
  const [busqueda, setBusqueda]           = useState('')
  const [filtroEstado, setFiltroEstado]   = useState('todos')
  const [filtroPlan, setFiltroPlan]       = useState('todos')
  const [sortField, setSortField]         = useState('fecha_ingreso')
  const [sortDir, setSortDir]             = useState('desc')

  // ── DnD ───────────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId]       = useState(null)
  const [dragOverCol, setDragOverCol]     = useState(null)
  const [groupsOpen, setGroupsOpen]       = useState({}) // `${col}-${tierKey}` → bool

  // ── Alertas inicio ruta ───────────────────────────────────────────────────
  const [alertaRuta, setAlertaRuta]       = useState(null) // notificación TECNICO_INICIO_RUTA activa

  // ── Modal ─────────────────────────────────────────────────────────────────
  const [selected, setSelected]           = useState(null)
  const [detalle, setDetalle]             = useState(null)
  const [recordatorios, setRecordatorios] = useState([])
  const [saving, setSaving]               = useState(false)
  const [guardando, setGuardando]         = useState(false)
  const [mensajeros, setMensajeros]       = useState([])
  const [tecnicos, setTecnicos]           = useState([])
  const [mensajeroId, setMensajeroId]     = useState('')
  const [modalEntrega, setModalEntrega]   = useState(null) // servicioId para modal entrega
  const [editTecnicoId, setEditTecnicoId] = useState('')
  const [editEstadoPago, setEditEstadoPago] = useState('')
  const [editNotas, setEditNotas]         = useState('')
  const [novedades, setNovedades]         = useState([])
  const [nuevoComentario, setNuevoComentario] = useState('')
  const [guardandoComentario, setGuardandoComentario] = useState(false)

  async function cargarSolicitudes() {
    const { data } = await db.from('solicitudes_servicio')
      .select('*').eq('estado', 'PENDIENTE').order('created_at', { ascending: true })
    setSolicitudes(data || [])
  }

  function abrirSolicitud(s) {
    const precio = planesKanban.find(p => p.id === s.plan_id)
    setConvForm({
      tipo_acompanamiento: 'PRESENCIAL', estado_pago: 'PENDIENTE',
      metodo_pago: '', tecnico_id: '', mascota_sexo: s.mascota_sexo || 'Macho',
      valor_total: precio ? String(precio.precio_referencia || '') : '',
    })
    setSelSolicitud(s)
  }

  async function convertirSolicitud() {
    if (!selSolicitud) return
    setConvirtiendo(true)
    try {
      // 1. Buscar o crear cliente
      const { data: clis } = await db.from('clientes')
        .select('id_cliente,tipo_cliente').eq('whatsapp', selSolicitud.cliente_whatsapp).limit(1)
      let clienteId
      if (clis?.length) {
        clienteId = clis[0].id_cliente
      } else {
        const { data: nc, error: ce } = await db.from('clientes').insert({
          nombre: selSolicitud.cliente_nombre, apellido: selSolicitud.cliente_apellido || null,
          whatsapp: selSolicitud.cliente_whatsapp, email: selSolicitud.cliente_email || null,
          tipo_cliente: 'NORMAL',
        }).select('id_cliente')
        if (ce) throw ce
        clienteId = nc[0].id_cliente
      }

      // 2. Crear mascota
      const pesoKg = parseFloat(selSolicitud.mascota_peso_kg) || 0
      const tamano = pesoKg < 1 ? 'Mini' : pesoKg <= 10 ? 'Pequeño' : pesoKg <= 20 ? 'Mediano' : pesoKg <= 35 ? 'Grande' : 'Gigante'
      const { data: nm, error: me } = await db.from('mascotas').insert({
        nombre: selSolicitud.mascota_nombre, especie_id: selSolicitud.especie_id || null,
        raza: selSolicitud.mascota_raza || null, sexo: convForm.mascota_sexo,
        tamano, peso_kg: pesoKg, cliente_id: clienteId,
        fallecida: true, fecha_fallecimiento: today(),
      }).select('id_mascota')
      if (me) throw me
      const mascotaId = nm[0].id_mascota

      // 3. Crear servicio (el trigger de DB crea recogida, entrega y cuarto_frio)
      const valorTotal = parseFloat(convForm.valor_total) || 0
      const puntoRecogida = selSolicitud.tipo_recogida === 'veterinaria' ? 'VETERINARIA' : 'DOMICILIO'
      const { data: sv, error: se } = await db.from('servicios').insert({
        mascota_id: mascotaId, plan_id: selSolicitud.plan_id || null,
        estado: 'INGRESADO', fecha_ingreso: today(),
        tipo_acompanamiento: convForm.tipo_acompanamiento,
        canal_entrada: 'DIRECTO',
        aliado_origen_id: selSolicitud.aliado_id || null,
        valor_total: valorTotal, valor_pagado: 0,
        estado_pago: convForm.estado_pago,
        metodo_pago: convForm.metodo_pago || null,
        tecnico_id: convForm.tecnico_id || null,
        punto_recogida: puntoRecogida,
        direccion_recogida: selSolicitud.direccion || null,
        ciudad_recogida: selSolicitud.ciudad || 'Bogotá',
        barrio_recogida: selSolicitud.barrio || null,
        indicaciones_recogida: selSolicitud.notas_cliente || null,
        tipo_cliente: 'NORMAL', comision_aliado: 0, comision_descontada: false,
        notas: selSolicitud.aliado_nombre_otro
          ? `Veterinaria indicada por cliente: ${selSolicitud.aliado_nombre_otro}` : null,
      }).select('id')
      if (se) throw se
      const servicioId = sv[0].id

      // 4. Actualizar recogida con info adicional
      await db.from('recogidas').update({
        aliado_id: selSolicitud.aliado_id || null,
        tecnico_id: convForm.tecnico_id || null,
      }).eq('servicio_id', servicioId)

      // 5. Marcar solicitud como convertida
      await db.from('solicitudes_servicio').update({
        estado: 'CONVERTIDO', servicio_id: servicioId,
      }).eq('id', selSolicitud.id)

      setSelSolicitud(null)
      await Promise.all([cargar(), cargarSolicitudes()])
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al crear servicio' })
    } finally {
      setConvirtiendo(false)
    }
  }

  async function descartarSolicitud(id) {
    if (!await confirm('Esta solicitud se marcará como descartada y no se procesará.', {
      title: '¿Descartar solicitud?', variant: 'danger', confirmLabel: 'Descartar',
    })) return
    await db.from('solicitudes_servicio').update({ estado: 'DESCARTADO' }).eq('id', id)
    setSelSolicitud(null)
    cargarSolicitudes()
  }

  useEffect(() => {
    cargar()
    cargarSolicitudes()
    Promise.all([
      db.from('planes').select('id,nombre').order('nombre'),
      db.from('especies').select('id,nombre').order('nombre'),
      db.from('aliados').select('id_aliado,nombre').eq('activo', true).order('nombre'),
    ]).then(([p, e, a]) => {
      setPlanesKanban(p.data || [])
      setEspeciesKanban(e.data || [])
      setAliados(a.data || [])
    })
    db.from('personal').select('id,nombre,apellido,rol_principal_id,whatsapp')
      .eq('activo', true).order('nombre')
      .then(({ data }) => {
        const all = data || []
        setTecnicos(all.filter(p => p.rol_principal_id === 2))
        setMensajeros(all.filter(p => p.rol_principal_id === 3))
      })

    // Realtime: recarga el tablero cuando un servicio cambia de estado
    // (ej: cliente sube fotos → EN_PROCESO, técnico avanza estado, etc.)
    const canal = db
      .channel('kanban-servicios-cambios')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servicios' }, () => {
        cargar()
      })
      .subscribe()

    return () => { db.removeChannel(canal) }
  }, [])

  // Polling alertas de inicio de ruta para coordinador/admin
  useEffect(() => {
    if (!personalData?.id) return
    const esCoord = ['COORDINADOR','ADMIN'].includes(personalData?.rol)
    if (!esCoord) return
    const verificar = async () => {
      const notifs = await obtenerNoLeidas(personalData.id)
      const rutaNotif = notifs.find(n => n.tipo === 'TECNICO_INICIO_RUTA')
      if (rutaNotif && !alertaRuta) setAlertaRuta(rutaNotif)
    }
    verificar()
    const iv = setInterval(verificar, 20_000)
    return () => clearInterval(iv)
  }, [personalData?.id, personalData?.rol])

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await db
        .from('v_kanban').select('*').order('fecha_ingreso', { ascending: false })
      if (err) throw err
      setServicios(data || [])
      await autoCorregirDesdeKanban(data || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function autoCorregirDesdeKanban(svcs) {
    const candidatos = svcs
      .filter(s => ['EN_PRODUCCION', 'EN_PROCESO', 'EN_CUARTO_FRIO', 'INGRESADO'].includes(s.estado))
      .map(s => s.servicio_id)
    if (!candidatos.length) return
    const { data: items } = await db.from('servicio_recordatorios')
      .select('servicio_id, estado')
      .in('servicio_id', candidatos)
      .neq('origen', 'REMOVIDO')
      .neq('estado', 'NA')
    if (!items?.length) return
    const porSvc = {}
    items.forEach(i => {
      if (!porSvc[i.servicio_id]) porSvc[i.servicio_id] = []
      porSvc[i.servicio_id].push(i)
    })
    const fijarListo = Object.entries(porSvc)
      .filter(([_, its]) => its.length > 0 && its.every(i => i.estado === 'LISTO' || i.estado === 'ENTREGADO'))
      .map(([id]) => id)
    if (!fijarListo.length) return
    await db.from('servicios').update({ estado: 'LISTO' }).in('id', fijarListo)
    setServicios(prev => prev.map(s => fijarListo.includes(s.servicio_id) ? { ...s, estado: 'LISTO' } : s))
  }

  async function abrirModal(s) {
    setSelected(s); setMensajeroId(''); setDetalle(null)
    setEditTecnicoId(s.tecnico_id || ''); setEditEstadoPago(s.estado_pago || '')
    setEditNotas(s.notas || '')

    const [{ data: svcFull }, { data: rec }, { data: recs }, { data: novs }, { data: cf }] = await Promise.all([
      db.from('servicios')
        .select('punto_recogida, direccion_recogida, ciudad_recogida, barrio_recogida, indicaciones_recogida, mensajero_id, comision_aliado, comision_descontada, metodo_pago, fecha_limite_cambio_plan, aliado_origen_id, plan_id')
        .eq('id', s.servicio_id).maybeSingle(),
      db.from('recogidas')
        .select('contacto_nombre, contacto_telefono, estado, tecnico_id, foto_recogida_url')
        .eq('servicio_id', s.servicio_id).maybeSingle(),
      db.from('servicio_recordatorios')
        .select('*, recordatorios(nombre)')
        .eq('servicio_id', s.servicio_id).neq('origen', 'REMOVIDO'),
      db.from('novedades_servicio')
        .select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
        .eq('servicio_id', s.servicio_id)
        .in('tipo_novedad', ['NOTA', 'PAGO_RECIBIDO'])
        .order('created_at', { ascending: true }),
      db.from('cuarto_frio')
        .select('foto_ingreso_url, foto_pesaje_url, peso_kg')
        .eq('servicio_id', s.servicio_id).maybeSingle(),
    ])

    setDetalle({ ...svcFull, recogida: rec, cuartoFrio: cf })
    setRecordatorios(recs || [])
    setNovedades(novs || [])
    setNuevoComentario('')
  }

  async function guardarCambios() {
    if (!selected) return
    setGuardando(true)
    const updates = {}
    if (editTecnicoId !== (selected.tecnico_id || ''))   updates.tecnico_id  = editTecnicoId  || null
    if (editEstadoPago !== (selected.estado_pago || '')) updates.estado_pago = editEstadoPago
    if (editNotas !== (selected.notas || ''))            updates.notas       = editNotas       || null

    if (Object.keys(updates).length > 0) {
      const { error } = await db.from('servicios').update(updates).eq('id', selected.servicio_id)
      if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); setGuardando(false); return }

      if ('tecnico_id' in updates) {
        await db.from('recogidas').update({ tecnico_id: updates.tecnico_id }).eq('servicio_id', selected.servicio_id)

        const mascotaNombre = selected.mascota || 'la mascota'
        // Notificar al técnico anterior que fue removido
        if (selected.tecnico_id && selected.tecnico_id !== updates.tecnico_id) {
          await crearNotificacion({
            para_personal_id: selected.tecnico_id,
            de_personal_id:   personalData?.id,
            tipo:             'REASIGNACION_REMOVIDO',
            titulo:           'Te reasignaron una recogida',
            mensaje:          `Ya no estás asignado a la recogida de ${mascotaNombre}. Otro técnico tomará el servicio.`,
            servicio_id:      selected.servicio_id,
          })
        }
        // Notificar al nuevo técnico
        if (updates.tecnico_id) {
          await crearNotificacion({
            para_personal_id: updates.tecnico_id,
            de_personal_id:   personalData?.id,
            tipo:             'REASIGNACION_TECNICO',
            titulo:           'Nueva recogida asignada',
            mensaje:          `Se te asignó la recogida de ${mascotaNombre}. Revisa los detalles en tu app.`,
            servicio_id:      selected.servicio_id,
          })
        }
      }

      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, ...updates } : s))
      setSelected(prev => ({ ...prev, ...updates }))
    }
    setGuardando(false)
  }

  async function cambiarEstado(servicioId, nuevoEstado) {
    setServicios(prev => prev.map(s => s.servicio_id === servicioId ? { ...s, estado: nuevoEstado } : s))
    if (selected?.servicio_id === servicioId) setSelected(prev => ({ ...prev, estado: nuevoEstado }))
    const { error: err } = await db.from('servicios').update({ estado: nuevoEstado }).eq('id', servicioId)
    if (err) { await showAlert(parsearErrorDB(err), { title: 'Error' }); cargar() }
  }

  async function confirmarEntrega() {
    if (!selected || saving) return
    setSaving(true)
    try {
      await db.from('servicios').update({ estado: 'EN_ENTREGA' }).eq('id', selected.servicio_id)
      if (mensajeroId)
        await db.from('entregas').update({ mensajero_id: mensajeroId }).eq('servicio_id', selected.servicio_id).in('estado', ['PENDIENTE'])
      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, estado: 'EN_ENTREGA' } : s))
      setSelected(prev => ({ ...prev, estado: 'EN_ENTREGA' })); setMensajeroId('')
    } catch (e) { await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' }) }
    finally { setSaving(false) }
  }

  async function ciclarRecordatorio(rec) {
    if (rec.estado === 'NA') return
    const ciclo = { PENDIENTE: 'EN_PROCESO', EN_PROCESO: 'LISTO', LISTO: 'ENTREGADO', ENTREGADO: 'PENDIENTE' }
    const next = ciclo[rec.estado] || 'PENDIENTE'
    await db.from('servicio_recordatorios').update({ estado: next }).eq('id', rec.id)

    const updatedRecs = recordatorios.map(r => r.id === rec.id ? { ...r, estado: next } : r)
    setRecordatorios(updatedRecs)

    const esTerminado = e => e === 'LISTO' || e === 'ENTREGADO'
    const cambio = (esTerminado(next) ? 1 : 0) - (esTerminado(rec.estado) ? 1 : 0)
    if (cambio !== 0) {
      setServicios(prev => prev.map(s =>
        s.servicio_id === selected?.servicio_id
          ? { ...s, items_listos: Math.max(0, (s.items_listos || 0) + cambio) }
          : s
      ))
    }

    // Recalcular estado del servicio dinámicamente
    const svcId = selected?.servicio_id
    if (!svcId) return
    try {
      const activos = updatedRecs.filter(r => r.estado !== 'NA' && r.origen !== 'REMOVIDO')
      if (!activos.length) return
      const { data: svc } = await db.from('servicios').select('estado').eq('id', svcId).maybeSingle()
      const estadoActual = svc?.estado
      if (['EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estadoActual)) return
      const todosTerminados = activos.every(r => esTerminado(r.estado))
      const algunoEnProceso = activos.some(r => r.estado === 'EN_PROCESO')
      let nuevoEstado = null
      if (todosTerminados && estadoActual !== 'LISTO') {
        nuevoEstado = 'LISTO'
      } else if (!todosTerminados && estadoActual === 'LISTO') {
        nuevoEstado = 'EN_PRODUCCION'
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estadoActual)) {
        nuevoEstado = 'EN_PRODUCCION'
      }
      if (nuevoEstado) {
        await db.from('servicios').update({ estado: nuevoEstado }).eq('id', svcId)
        setServicios(prev => prev.map(s => s.servicio_id === svcId ? { ...s, estado: nuevoEstado } : s))
        setSelected(prev => ({ ...prev, estado: nuevoEstado }))
      }
    } catch (_) { /* silencioso */ }
  }

  async function agregarComentario() {
    if (!nuevoComentario.trim() || !selected) return
    setGuardandoComentario(true)
    try {
      const { data: inserted } = await db.from('novedades_servicio').insert({
        servicio_id:    selected.servicio_id,
        tipo_novedad:   'NOTA',
        descripcion:    nuevoComentario.trim(),
        registrado_por: personalData?.id || null,
      }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
      setNuevoComentario('')
      if (inserted?.[0]) setNovedades(prev => [...prev, inserted[0]])
    } finally { setGuardandoComentario(false) }
  }

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function generateCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  async function contactar(e, s) {
    e.stopPropagation()
    if (contactarLoadingId || !s.cliente_wa) return
    setContactarLoadingId(s.servicio_id)
    try {
      const { data: svcRow, error: selErr } = await dbAdmin
        .from('servicios').select('codigo_fotos, fecha_codigo_enviado').eq('id', s.servicio_id).single()
      if (selErr) { await showAlert(parsearErrorDB(selErr), { title: 'Error al leer servicio' }); return }
      let codigo = svcRow?.codigo_fotos
      if (!codigo) {
        codigo = generateCodigo()
        const { error: updErr } = await dbAdmin.from('servicios').update({
          codigo_fotos: codigo,
          fecha_codigo_enviado: new Date().toISOString().split('T')[0],
        }).eq('id', s.servicio_id)
        if (updErr) { await showAlert(parsearErrorDB(updErr), { title: 'Error al generar código' }); return }
      } else if (!svcRow?.fecha_codigo_enviado) {
        // El código ya existía pero no se había registrado la fecha de envío
        await dbAdmin.from('servicios').update({ fecha_codigo_enviado: new Date().toISOString().split('T')[0] }).eq('id', s.servicio_id)
      }
      const base = window.location.href.split('#')[0]
      const portalUrl = `${base}#/fotos/${codigo}`
      const msg =
        `Hola, le escribimos de Camino al Cielo 🌿\n\n` +
        `Le informamos que hemos recibido a *${s.mascota}* y será atendido con el *${s.plan}*.\n\n` +
        `Para iniciar el proceso, ingrese al siguiente enlace y comparta las fotos de ${s.mascota}:\n` +
        `${portalUrl}\n\n` +
        `Si prefiere, puede ingresar el código: *${codigo}*\n\n` +
        `Gracias por confiar en nosotros 🙏`
      window.open(`https://wa.me/57${s.cliente_wa.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
    } finally { setContactarLoadingId(null) }
  }

  async function notificarTecnico(e, s) {
    e.stopPropagation()
    if (notifTecLoadingId || !s.tecnico_id) return
    const tec = tecnicos.find(t => t.id === s.tecnico_id)
    if (!tec?.whatsapp) {
      await showAlert('El técnico asignado no tiene número de WhatsApp registrado.', { title: 'Sin WhatsApp' })
      return
    }
    setNotifTecLoadingId(s.servicio_id)
    try {
      const { data: svc } = await db.from('servicios')
        .select('direccion_recogida, barrio_recogida, ciudad_recogida, notas')
        .eq('id', s.servicio_id).maybeSingle()
      const { data: rec } = await db.from('recogidas')
        .select('hora_aproximada')
        .eq('servicio_id', s.servicio_id).maybeSingle()

      const direccion = svc?.direccion_recogida || ''
      const barrio    = svc?.barrio_recogida ? ` · ${svc.barrio_recogida}` : ''
      const ciudad    = svc?.ciudad_recogida && svc.ciudad_recogida !== 'Bogotá' ? ` (${svc.ciudad_recogida})` : ''
      const horaAprox = rec?.hora_aproximada ? `\n⏰ Hora aprox: *${rec.hora_aproximada}*` : ''
      const contacto  = s.cliente_wa ? `\n📞 Contacto: ${s.cliente_wa}` : ''
      const indicac   = svc?.notas ? `\n📋 Indicaciones: ${svc.notas}` : ''

      const mensaje = [
        `🐾 *Nueva recogida asignada — Camino al Cielo*`,
        ``,
        `Se te asignó un servicio:`,
        ``,
        `🐾 Mascota: *${s.mascota}* (${s.especie || ''})`,
        `👤 Propietario: ${s.cliente}${contacto}`,
        `📍 Dirección: ${direccion}${barrio}${ciudad}`,
        `📦 Plan: ${s.plan}`,
        horaAprox,
        indicac,
        ``,
        `Ingresa a la app para confirmar y ver los detalles. ¡Mucho éxito! 🙏`,
      ].filter(Boolean).join('\n')

      const numero = tec.whatsapp.replace(/\D/g, '')
      window.open(`https://wa.me/57${numero}?text=${encodeURIComponent(mensaje)}`, '_blank')
    } finally {
      setNotifTecLoadingId(null)
    }
  }

  function alertLevel(s) {
    if (s.dias_para_vencer == null) return null
    if (s.dias_para_vencer < 0)  return 'vencido'
    if (s.dias_para_vencer === 0) return 'hoy'
    if (s.dias_para_vencer <= 3) return 'pronto'
    return null
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const planesUnicos = [...new Set(servicios.map(s => s.plan).filter(Boolean))].sort()

  // ── Valores derivados del modal de solicitud (evita IIFE en JSX) ─────────
  const SOL_LABL = 'block text-[11px] font-bold text-gray-500 mb-1'
  const SOL_INP  = 'w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10 transition-all bg-white'
  const solPlanNombre    = selSolicitud ? (planesKanban.find(p => p.id === selSolicitud.plan_id)?.nombre || '—') : ''
  const solEspecieNombre = selSolicitud ? (especiesKanban.find(e => e.id === selSolicitud.especie_id)?.nombre || '') : ''
  const solAliadoNombre  = selSolicitud?.aliado_id
    ? (aliados.find(a => a.id_aliado === selSolicitud.aliado_id)?.nombre || '—')
    : (selSolicitud?.aliado_nombre_otro || '—')

  const filtrados = servicios.filter(s => {
    if (!COLUMNAS.includes(s.estado)) return false
    if (filtroEstado !== 'todos' && s.estado !== filtroEstado) return false
    if (filtroPlan   !== 'todos' && s.plan    !== filtroPlan)   return false
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase()
      return [s.mascota, s.cliente, s.plan, s.especie].some(v => v?.toLowerCase().includes(q))
    }
    return true
  })

  const sorted = [...filtrados].sort((a, b) => {
    const va = a[sortField] ?? '', vb = b[sortField] ?? ''
    return sortDir === 'asc'
      ? String(va).localeCompare(String(vb), 'es', { numeric: true })
      : String(vb).localeCompare(String(va), 'es', { numeric: true })
  })

  // ── DnD handlers ─────────────────────────────────────────────────────────
  function onDragStart(e, svc) { e.dataTransfer.setData('svc_id', svc.servicio_id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(svc.servicio_id) }
  function onDragEnd() { setDraggingId(null); setDragOverCol(null) }
  function onDragOver(e, col) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col) }
  function onDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null) }
  function onDrop(e, col) {
    e.preventDefault()
    const id  = e.dataTransfer.getData('svc_id')
    const svc = servicios.find(s => s.servicio_id === id)
    if (id && svc && svc.estado !== col) cambiarEstado(id, col)
    setDraggingId(null); setDragOverCol(null)
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" /><span className="text-sm font-medium">Cargando tablero…</span>
    </div>
  )
  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">Error: {error}</div>
    </div>
  )

  // ── Imágenes del cliente (para modal productor/admin) ────────────────────
  const imagenesDelCliente = recordatorios
    .filter(r => r.origen !== 'REMOVIDO')
    .flatMap(r => {
      const urls = r.imagenes_cliente_urls?.length
        ? r.imagenes_cliente_urls
        : r.imagen_cliente_url ? [r.imagen_cliente_url] : []
      return urls.map((url, i) => ({ url, nombre: r.recordatorios?.nombre || 'Foto', idx: i, total: urls.length, recId: r.id }))
    })

  // ── WhatsApp message según tipo_lugar ────────────────────────────────────
  function generarMsgRuta(notif) {
    const d        = notif.datos || {}
    const mascota  = d.mascota        || 'su mascota'
    const hora     = d.hora_llegada   || '(hora por confirmar)'
    const tecnico  = d.tecnico_nombre || 'nuestro técnico'
    const direccion = d.direccion     || d.lugar || ''

    return [
      `Hola, esperamos que te encuentres bien.`,
      ``,
      `Te informamos que nuestro técnico *${tecnico}* estará acompañándonos en la recolección de *${mascota}*${direccion ? ` en la dirección *${direccion}*` : ''}, aproximadamente a las *${hora}*.`,
      ``,
      `Agradecemos la confianza que has depositado en nosotros en este momento tan especial. Si tienes alguna inquietud, estaremos atentos para ayudarte.`,
      ``,
      `Con cariño,`,
      `Equipo Camino al Cielo 🤍🐾`,
    ].join('\n')
  }

  return (
    <>
    {/* ── ALERTA INICIO RUTA (popup coordinador) ── */}
    {alertaRuta && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="px-5 py-4 border-b" style={{ background: '#EEF3FB', borderColor: '#C5D8F5' }}>
            <div className="flex items-center gap-2">
              <span className="text-xl">🚗</span>
              <div>
                <p className="font-bold text-gray-900 text-sm">{alertaRuta.titulo}</p>
                <p className="text-[11px] text-gray-500">{alertaRuta.mensaje}</p>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <p className="text-[12px] text-gray-600 mb-3">¿Confirmar y notificar al cliente por WhatsApp?</p>
            {(() => {
              const d = alertaRuta.datos || {}
              const waNum = d.wa_cliente || d.wa_aliado || ''
              const msg   = generarMsgRuta(alertaRuta)
              return (
                <div className="space-y-2">
                  {waNum ? (
                    <a href={`https://wa.me/57${waNum.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`}
                      target="_blank" rel="noreferrer"
                      onClick={async () => { await marcarLeida(alertaRuta.id); setAlertaRuta(null) }}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold"
                      style={{ background: '#25D366', color: '#fff' }}>
                      <MessageCircle size={16} /> Enviar WhatsApp al cliente
                    </a>
                  ) : (
                    <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      ⚠️ No hay número WhatsApp registrado para este servicio.
                    </p>
                  )}
                  <button
                    onClick={async () => { await marcarLeida(alertaRuta.id); setAlertaRuta(null) }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border"
                    style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                    Marcar visto sin enviar
                  </button>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    )}
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar actions={
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={cargar} title="Actualizar">
          <RefreshCw size={14} />
        </button>
      } />

      <div className={`p-5 flex flex-col gap-4 ${vista === 'kanban' ? 'flex-1 min-h-0' : ''}`}>

        {/* ── Alerta fotos pendientes (3+ días hábiles sin subir) ──────────── */}
        {(() => {
          const pendientes = servicios.filter(s => s.alerta_fotos_pendientes)
          if (!pendientes.length) return null
          return (
            <div className="rounded-xl border-2 px-4 py-3 flex items-start gap-3" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-amber-800 mb-1">
                  {pendientes.length} servicio{pendientes.length > 1 ? 's' : ''} sin fotos ({'>'}3 días hábiles)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pendientes.map(s => (
                    <button key={s.servicio_id} onClick={() => { const item = servicios.find(x => x.servicio_id === s.servicio_id); if (item) abrirModal(item) }}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-all hover:opacity-80"
                      style={{ background: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }}>
                      {s.mascota} · {s.cliente.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Solicitudes de clientes (solo COORDINADOR / ADMIN) ──────────── */}
        {(esAdmin || rol === 'COORDINADOR') && solicitudes.length > 0 && (
          <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: '#C4A87A33', background: '#FFFDF7' }}>
            <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#C4A87A33', background: '#FFF9ED' }}>
              <span className="text-base">📋</span>
              <span className="text-[13px] font-bold text-[#9A5500]">Solicitudes de clientes</span>
              <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#C4A87A', color: '#fff' }}>
                {solicitudes.length}
              </span>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {solicitudes.map(s => {
                const planNombre    = planesKanban.find(p => p.id === s.plan_id)?.nombre || '—'
                const especieNombre = especiesKanban.find(e => e.id === s.especie_id)?.nombre || ''
                return (
                  <button key={s.id} onClick={() => abrirSolicitud(s)}
                    className="text-left bg-white border rounded-xl p-3 shadow-sm hover:shadow-md hover:-translate-y-px transition-all"
                    style={{ borderColor: '#F3E8CC' }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-lg">{petEmoji(especieNombre)}</span>
                      <div>
                        <div className="text-[13px] font-bold text-gray-900 leading-tight">{s.mascota_nombre}</div>
                        <div className="text-[11px] text-gray-400">{s.cliente_nombre} {s.cliente_apellido || ''}</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate mb-1">{planNombre}</div>
                    <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                      style={{ background: s.tipo_recogida === 'veterinaria' ? '#EFF5FF' : '#F0F7EB', color: s.tipo_recogida === 'veterinaria' ? '#1A5CD8' : '#3D5A27' }}>
                      {s.tipo_recogida === 'veterinaria' ? '🏥' : '🏠'}{' '}
                      {s.tipo_recogida === 'veterinaria' ? (s.aliado_nombre_otro || 'Veterinaria') : (s.barrio || s.ciudad || 'Domicilio')}
                    </div>
                    <div className="text-[10px] text-gray-300 mt-1.5">{new Date(s.created_at).toLocaleDateString('es-CO')}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Selector de tablero (solo ADMIN) ─────────────────────────────── */}
        {esAdmin && (
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 self-start">
            <button
              onClick={() => setTableroActivo('coordinacion')}
              className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${tableroActivo === 'coordinacion' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              🗂 Coordinación
            </button>
            <button
              onClick={() => setTableroActivo('produccion')}
              className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${tableroActivo === 'produccion' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              🎨 Producción / Diseño
            </button>
          </div>
        )}

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input className="pl-8 pr-7 h-9 text-[13px]" placeholder="Buscar mascota, cliente, plan…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {busqueda && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setBusqueda('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {planesUnicos.length > 1 && (
            <Select value={filtroPlan} onChange={e => setFiltroPlan(e.target.value)} className="h-9 text-[12px] w-44">
              <option value="todos">Todos los planes</option>
              {planesUnicos.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}

          {vista === 'tabla' && (
            <div className="flex flex-wrap gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${filtroEstado === 'todos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`} onClick={() => setFiltroEstado('todos')}>Todos</button>
              {COLUMNAS.map(col => {
                const cs = COL_STYLE[col]; const active = filtroEstado === col
                return (
                  <button key={col} className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${active ? 'bg-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`} style={active ? { color: cs.bar } : {}} onClick={() => setFiltroEstado(active ? 'todos' : col)}>
                    {colLabel(col)}
                  </button>
                )
              })}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-gray-400 font-medium hidden sm:block">{filtrados.length} servicio{filtrados.length !== 1 ? 's' : ''}</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              <button className={`w-8 h-7 flex items-center justify-center rounded-md transition-all ${vista === 'kanban' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} onClick={() => setVista('kanban')} title="Tablero Kanban"><LayoutGrid size={14} /></button>
              <button className={`w-8 h-7 flex items-center justify-center rounded-md transition-all ${vista === 'tabla' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} onClick={() => setVista('tabla')} title="Vista Tabla"><Table2 size={14} /></button>
            </div>
          </div>
        </div>

        {/* ── KANBAN VIEW ─────────────────────────────────────────────────── */}
        {vista === 'kanban' && (
          <div className="overflow-x-auto flex-1 pb-2 min-h-0">
            <div className="flex gap-3 h-full" style={{ minWidth: `${COLUMNAS.length * 256}px` }}>
              {COLUMNAS.map(col => {
                const items  = filtrados.filter(s => s.estado === col)
                const cs     = COL_STYLE[col]
                const isOver = dragOverCol === col

                return (
                  <div key={col} className="w-[248px] flex-shrink-0 flex flex-col gap-2"
                    onDragOver={e => onDragOver(e, col)} onDragLeave={onDragLeave} onDrop={e => onDrop(e, col)}>

                    {/* Cabecera columna */}
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-150"
                      style={{ backgroundColor: isOver ? cs.bar + '22' : cs.dot, outline: isOver ? `2px dashed ${cs.bar}66` : '2px solid transparent', outlineOffset: '-2px' }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cs.bar }} />
                      <span className="text-[12px] font-bold flex-1 truncate" style={{ color: cs.bar }}>{colLabel(col)}</span>
                      <span className="text-[11px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full" style={{ backgroundColor: cs.bar, color: '#fff' }}>{items.length}</span>
                    </div>

                    {/* Área de tarjetas */}
                    <div className="space-y-2 flex-1 rounded-xl p-1 -m-1 transition-colors duration-150 min-h-[80px]"
                      style={{ backgroundColor: isOver ? '#F9FAFB' : 'transparent' }}>
                      {(() => {
                        const TIERS = [
                          { key: 'vencido', label: 'Vencidos',    color: '#C03030', bg: '#FEE2E2', urgent: true,  test: s => s.dias_para_vencer != null && s.dias_para_vencer < 0 },
                          { key: 'hoy',    label: 'Vence hoy',   color: '#B45309', bg: '#FEF3C7', urgent: true,  test: s => s.dias_para_vencer === 0 },
                          { key: 'pronto', label: '≤ 3 días',    color: '#9A5500', bg: '#FFF3DC', urgent: true,  test: s => s.dias_para_vencer != null && s.dias_para_vencer >= 1 && s.dias_para_vencer <= 3 },
                          { key: 'proximo',label: '4-7 días',    color: '#1D8A55', bg: '#E8F3EB', urgent: false, test: s => s.dias_para_vencer != null && s.dias_para_vencer >= 4 && s.dias_para_vencer <= 7 },
                          { key: 'normal', label: 'Sin urgencia', color: '#3B6FBF', bg: '#EEF3FB', urgent: false, test: s => s.dias_para_vencer != null && s.dias_para_vencer > 7 },
                          { key: 'sin_fecha', label: 'Sin fecha', color: '#9CA3AF', bg: '#F3F4F6', urgent: false, test: s => s.dias_para_vencer == null },
                        ]

                        const renderCard = s => {
                          const al  = alertLevel(s)
                          const pct = s.total_items > 0 ? Math.round((s.items_listos / s.total_items) * 100) : 0
                          const tieneImagenes = s.fecha_imagenes_recibidas && s.estado === 'EN_PROCESO'
                          const puedeContactar = (esVistaProd || esAdmin) && col === 'EN_CUARTO_FRIO' && s.cliente_wa
                          const puedeNotifTec  = !esVistaProd && col === 'INGRESADO' && !!s.tecnico_id
                          return (
                            <div key={s.servicio_id} draggable
                              onDragStart={e => onDragStart(e, s)} onDragEnd={onDragEnd}
                              className="bg-white border rounded-xl p-3.5 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-px transition-all select-none"
                              style={{ borderColor: al === 'vencido' ? '#FECACA' : al === 'hoy' ? '#FDE68A' : '#F3F4F6', opacity: draggingId === s.servicio_id ? 0.35 : 1 }}
                              onClick={() => draggingId === null && abrirModal(s)}
                            >
                              <div className="flex items-start gap-2 mb-2.5">
                                <span className="text-xl leading-none flex-shrink-0">{petEmoji(s.especie)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-bold text-gray-900 truncate leading-tight">{s.mascota}</div>
                                  <div className="text-[11px] text-gray-400 truncate mt-0.5">{s.cliente}</div>
                                </div>
                              </div>
                              <div className="text-[11px] text-gray-500 font-medium mb-2 truncate">{s.plan}</div>
                              {al && (
                                <div className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 ${al === 'vencido' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                  <AlertTriangle size={9} />
                                  {s.dias_para_vencer < 0 ? `Vencido ${Math.abs(s.dias_para_vencer)}d` : s.dias_para_vencer === 0 ? 'Vence hoy' : `${s.dias_para_vencer}d`}
                                </div>
                              )}
                              {tieneImagenes && (
                                <div className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 bg-purple-100 text-purple-700">
                                  <Camera size={9} /> Imágenes listas
                                </div>
                              )}
                              {puedeContactar && (
                                <button
                                  onClick={e => contactar(e, s)}
                                  disabled={contactarLoadingId === s.servicio_id}
                                  className="mt-2.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                  style={{ backgroundColor: '#25D366' }}
                                >
                                  {contactarLoadingId === s.servicio_id
                                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                    : <MessageCircle size={11} />}
                                  Contactar cliente
                                </button>
                              )}
                              {puedeNotifTec && (
                                <button
                                  onClick={e => notificarTecnico(e, s)}
                                  disabled={notifTecLoadingId === s.servicio_id}
                                  className="mt-2.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                  style={{ backgroundColor: '#1A5CD8' }}
                                >
                                  {notifTecLoadingId === s.servicio_id
                                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                    : <Send size={11} />}
                                  Notificar técnico
                                </button>
                              )}
                            </div>
                          )
                        }

                        if (items.length === 0) return (
                          <div className="border-2 border-dashed rounded-xl p-5 text-center text-[12px] font-medium transition-all"
                            style={{ borderColor: isOver ? cs.bar : cs.dot, color: isOver ? cs.bar : '#D1D5DB' }}>
                            {isOver ? '↓ Soltar aquí' : 'Sin servicios'}
                          </div>
                        )

                        const tiered = TIERS.map(t => ({ ...t, items: items.filter(t.test) })).filter(t => t.items.length > 0)

                        // Un solo grupo → render directo sin cabecera
                        if (tiered.length === 1) return <div className="space-y-2">{tiered[0].items.map(renderCard)}</div>

                        // Múltiples grupos → jerarquía colapsable
                        return tiered.map(tier => {
                          const gKey = `${col}-${tier.key}`
                          const defaultOpen = tier.urgent || tier.items.length <= 3
                          const isOpenTier = gKey in groupsOpen ? groupsOpen[gKey] : defaultOpen
                          return (
                            <div key={tier.key} className="mb-0.5">
                              {/* Cabecera del grupo */}
                              <button
                                className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-colors hover:bg-gray-50 mb-1"
                                onClick={() => setGroupsOpen(prev => ({ ...prev, [gKey]: !isOpenTier }))}
                              >
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tier.color }} />
                                <span className="text-[11px] font-bold flex-1 text-left" style={{ color: tier.color }}>{tier.label}</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tier.color + '22', color: tier.color }}>{tier.items.length}</span>
                                <ChevronDown size={11} className="transition-transform flex-shrink-0" style={{ color: tier.color, transform: isOpenTier ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                              </button>

                              {isOpenTier ? (
                                <div className="space-y-2 pl-0.5">{tier.items.map(renderCard)}</div>
                              ) : (
                                /* Vista pila colapsada */
                                <button
                                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all hover:shadow-sm"
                                  style={{ background: tier.bg, borderColor: tier.color + '44' }}
                                  onClick={() => setGroupsOpen(prev => ({ ...prev, [gKey]: true }))}
                                >
                                  <div className="flex -space-x-2 flex-shrink-0">
                                    {tier.items.slice(0, 4).map((s, i) => (
                                      <div key={s.servicio_id}
                                        className="w-7 h-7 rounded-full bg-white border-2 flex items-center justify-center text-[13px] leading-none shadow-sm"
                                        style={{ borderColor: tier.color + '66', zIndex: 4 - i }}>
                                        {petEmoji(s.especie)}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex-1 text-left min-w-0">
                                    <div className="text-[11px] font-bold" style={{ color: tier.color }}>{tier.items.length} en cola</div>
                                    <div className="text-[10px] text-gray-400 truncate">{tier.items.map(s => s.mascota).join(', ')}</div>
                                  </div>
                                  <ChevronDown size={11} className="flex-shrink-0" style={{ color: tier.color, transform: 'rotate(-90deg)' }} />
                                </button>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TABLE VIEW ──────────────────────────────────────────────────── */}
        {vista === 'tabla' && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    {[
                      { field: 'mascota', label: 'Mascota' }, { field: 'cliente', label: 'Cliente' },
                      { field: 'plan', label: 'Plan' }, { field: 'estado', label: 'Estado' },
                      { field: 'fecha_ingreso', label: 'Ingreso' }, { field: 'dias_para_vencer', label: 'Días' },
                    ].map(({ field, label }) => (
                      <th key={field} className="text-left px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none transition-colors whitespace-nowrap" onClick={() => toggleSort(field)}>
                        <div className="flex items-center gap-1">{label}<SortIcon field={field} sortField={sortField} sortDir={sortDir} /></div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Ítems</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => {
                    const al  = alertLevel(s)
                    const pct = s.total_items > 0 ? Math.round((s.items_listos / s.total_items) * 100) : 0
                    return (
                      <tr key={s.servicio_id} className="hover:bg-gray-50/70 transition-colors cursor-pointer" style={{ borderBottom: i < sorted.length - 1 ? '1px solid #F9FAFB' : 'none' }} onClick={() => abrirModal(s)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xl leading-none">{petEmoji(s.especie)}</span>
                            <div>
                              <div className="text-[13px] font-semibold text-gray-900">{s.mascota}</div>
                              <div className="text-[11px] text-gray-400">{s.especie}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[13px] text-gray-700">{s.cliente}</td>
                        <td className="px-4 py-3 text-[12px] text-gray-500">{s.plan}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <EstadoBadge estado={s.estado} />
                            {s.fecha_imagenes_recibidas && s.estado === 'EN_PROCESO' && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 w-fit">
                                <Camera size={8} /> Imágenes listas
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-gray-500 whitespace-nowrap">
                          {s.fecha_ingreso ? new Date(s.fecha_ingreso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {s.dias_para_vencer != null ? (
                            <span className={`text-[12px] font-semibold ${al === 'vencido' ? 'text-red-600' : al === 'hoy' ? 'text-amber-600' : al === 'pronto' ? 'text-amber-500' : 'text-gray-500'}`}>
                              {s.dias_para_vencer < 0 ? `−${Math.abs(s.dias_para_vencer)}d` : s.dias_para_vencer === 0 ? 'Hoy' : `${s.dias_para_vencer}d`}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {s.total_items > 0 ? (
                            <div className="flex items-center gap-1.5 min-w-[80px]">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">{s.items_listos}/{s.total_items}</span>
                            </div>
                          ) : <span className="text-gray-300 text-[12px]">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {sorted.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">{busqueda.trim() ? `Sin resultados para "${busqueda}"` : 'Sin servicios'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal detalle / gestión ───────────────────────────────────────── */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={`${petEmoji(selected.especie)} ${selected.mascota}`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4">

            {/* Cabecera: estado + fechas */}
            <div className="flex flex-wrap items-center gap-3">
              <EstadoBadge estado={selected.estado} />
              {selected.fecha_imagenes_recibidas && selected.estado === 'EN_PROCESO' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                  <Camera size={11} /> Imágenes recibidas
                </span>
              )}
              <span className="text-[11px] text-gray-400">Ingreso: <strong className="text-gray-700">{selected.fecha_ingreso ? new Date(selected.fecha_ingreso).toLocaleDateString('es-CO') : '—'}</strong></span>
              {selected.fecha_limite_entrega && (
                <span className="text-[11px] text-gray-400">Límite: <strong className="text-gray-700">{new Date(selected.fecha_limite_entrega).toLocaleDateString('es-CO')}</strong></span>
              )}
              {selected.dias_para_vencer != null && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${selected.dias_para_vencer < 0 ? 'bg-red-50 text-red-600' : selected.dias_para_vencer <= 2 ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
                  {selected.dias_para_vencer < 0 ? `${Math.abs(selected.dias_para_vencer)}d vencido` : `${selected.dias_para_vencer}d restantes`}
                </span>
              )}
            </div>

            {/* ── Galería de imágenes del cliente (productor y admin) ── */}
            {puedeVerImagenes && imagenesDelCliente.length > 0 && (
              <div className="rounded-xl border-2 p-3 space-y-2.5" style={{ borderColor: '#E9D5FF', background: '#FAF5FF' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#7C3AED' }}>
                    <Images size={12} /> Imágenes del cliente ({imagenesDelCliente.length})
                  </div>
                  <span className="text-[10px] text-purple-400">Clic para abrir · clic derecho para descargar</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {imagenesDelCliente.map((img, i) => (
                    <a key={i} href={img.url} target="_blank" rel="noreferrer"
                      className="group relative rounded-lg overflow-hidden bg-purple-100 block"
                      style={{ aspectRatio: '1/1' }}
                      title={img.total > 1 ? `${img.nombre} — foto ${img.idx + 1}/${img.total}` : img.nombre}
                    >
                      <img src={img.url} alt={img.nombre} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <Download size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[8px] font-semibold text-white truncate leading-tight" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
                        {img.total > 1 ? `${img.nombre} ${img.idx + 1}` : img.nombre}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* ── Evidencias del técnico (colapsable) ── */}
            {detalle && (() => {
              const fotos = [
                detalle.recogida?.foto_recogida_url  && { url: detalle.recogida.foto_recogida_url,  label: 'Identidad mascota',  emoji: '🪪' },
                detalle.cuartoFrio?.foto_ingreso_url && { url: detalle.cuartoFrio.foto_ingreso_url, label: 'Ingreso cuarto frío', emoji: '❄️' },
                detalle.cuartoFrio?.foto_pesaje_url  && { url: detalle.cuartoFrio.foto_pesaje_url,  label: 'Foto pesaje',         emoji: '⚖️' },
              ].filter(Boolean)
              if (!fotos.length) return null
              return <EvidenciasColapsable fotos={fotos} />
            })()}

            {/* ── Frases y textos del cliente (productor y admin) ── */}
            {puedeVerImagenes && (() => {
              const conTextos = recordatorios.filter(r => r.datos_cliente && Object.keys(r.datos_cliente).length > 0)
              if (!conTextos.length) return null
              return (
                <div className="rounded-xl border-2 p-3 space-y-2.5" style={{ borderColor: '#BBF7D0', background: '#F0FFF4' }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#15803D' }}>
                    <MessageSquare size={12} /> Textos del cliente
                  </div>
                  <div className="space-y-3">
                    {conTextos.map(r => (
                      <div key={r.id}>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                          {r.recordatorios?.nombre || 'Recordatorio'}
                        </div>
                        <div className="space-y-1.5">
                          {Object.entries(r.datos_cliente).map(([label, valores]) => (
                            <div key={label}>
                              <div className="text-[10px] font-semibold mb-1" style={{ color: '#166534' }}>{label}</div>
                              {(Array.isArray(valores) ? valores : [valores]).filter(v => v?.trim()).map((v, i) => (
                                <div key={i} className="text-[12px] bg-white rounded-lg px-3 py-1.5 border mb-1" style={{ borderColor: '#BBF7D0' }}>
                                  "{v}"
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Columna izquierda */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><User size={10} /> Cliente</div>
                  <div>
                    <div className="text-[13px] font-bold text-gray-900">{selected.cliente}</div>
                    {selected.cliente_wa && <div className="text-[11px] text-gray-500">{selected.cliente_wa}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-gray-400">Especie:</span> <span className="font-semibold">{selected.especie}</span></div>
                    {selected.raza && <div><span className="text-gray-400">Raza:</span> <span className="font-semibold">{selected.raza}</span></div>}
                    <div><span className="text-gray-400">Plan:</span> <span className="font-semibold">{selected.plan}</span></div>
                    <div><span className="text-gray-400">Acomp.:</span> <span className="font-semibold">{selected.tipo_acompanamiento || '—'}</span></div>
                    {selected.aliado_origen && (
                      <div className="col-span-2"><span className="text-gray-400">Aliado:</span> <span className="font-semibold">{selected.aliado_origen}{selected.aliado_vip ? ' ⭐' : ''}</span></div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><MapPin size={10} /> Recogida</div>
                  {detalle ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-gray-400">Punto:</span> <span className="font-semibold">{detalle.punto_recogida === 'CLINICA_ALIADA' ? 'Clínica aliada' : detalle.punto_recogida === 'DOMICILIO' ? 'Domicilio' : detalle.punto_recogida === 'SEDE' ? 'Sede CaC' : detalle.punto_recogida || '—'}</span></div>
                        <div><span className="text-gray-400">Ciudad:</span> <span className="font-semibold">{detalle.ciudad_recogida || '—'}</span></div>
                      </div>
                      {detalle.direccion_recogida && <div><span className="text-gray-400">Dirección:</span> <span className="font-semibold">{detalle.direccion_recogida}</span>{detalle.barrio_recogida ? ` · ${detalle.barrio_recogida}` : ''}</div>}
                      {detalle.recogida?.contacto_nombre && <div><span className="text-gray-400">Contacto:</span> <span className="font-semibold">{detalle.recogida.contacto_nombre}</span>{detalle.recogida.contacto_telefono ? ` · ${detalle.recogida.contacto_telefono}` : ''}</div>}
                      {detalle.indicaciones_recogida && <div className="text-gray-500 italic">"{detalle.indicaciones_recogida}"</div>}
                    </div>
                  ) : <div className="text-[11px] text-gray-400">Cargando…</div>}
                </div>
              </div>

              {/* Columna derecha */}
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider flex items-center gap-1.5"><User size={10} /> Técnico de recogida</div>
                  <Select value={editTecnicoId} onChange={e => setEditTecnicoId(e.target.value)} className="w-full text-[12px]">
                    <option value="">Sin asignar</option>
                    {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.apellido}</option>)}
                  </Select>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><CreditCard size={10} /> Financiero</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-gray-400">Total:</span> <span className="font-bold text-gray-900">{fmt(selected.valor_total)}</span></div>
                    <div><span className="text-gray-400">Pagado:</span> <span className="font-semibold text-green-700">{fmt(selected.valor_pagado)}</span></div>
                    {selected.saldo_pendiente > 0 && <div><span className="text-gray-400">Saldo:</span> <span className="font-bold text-red-600">{fmt(selected.saldo_pendiente)}</span></div>}
                    {detalle?.comision_aliado > 0 && <div><span className="text-gray-400">Comisión:</span> <span className="font-semibold text-amber-700">{fmt(detalle.comision_aliado)}</span></div>}
                    {detalle?.metodo_pago && <div><span className="text-gray-400">Método:</span> <span className="font-semibold">{detalle.metodo_pago}</span></div>}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Estado de pago</div>
                    <Select value={editEstadoPago} onChange={e => setEditEstadoPago(e.target.value)} className="w-full text-[12px]">
                      <option value="PENDIENTE">Pendiente</option>
                      <option value="PARCIAL">Parcial</option>
                      <option value="COMPLETO">Completo</option>
                    </Select>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><Pencil size={10} /> Notas</div>
                  <textarea value={editNotas} onChange={e => setEditNotas(e.target.value)} rows={2} placeholder="Sin notas…" className="w-full text-[12px] text-gray-700 bg-white border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-200" />
                </div>

                <button onClick={guardarCambios} disabled={guardando} className="w-full py-2 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50" style={{ background: '#1A5CD8', color: '#fff' }}>
                  <Save size={13} />
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>

            {/* Preparar entrega (LISTO) */}
            {selected.estado === 'LISTO' && (
              <button
                onClick={() => { setModalEntrega(selected.servicio_id); setSelected(null) }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all hover:opacity-90"
                style={{ background: '#4F46E5', color: '#fff' }}>
                <Truck size={14} /> Preparar entrega
              </button>
            )}

            {/* Mover estado */}
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Mover a…</div>
              <div className="flex flex-wrap gap-1.5">
                {TODAS_COLS.filter(c => c !== selected.estado && !(selected.estado === 'LISTO' && c === 'EN_ENTREGA')).map(col => (
                  <button key={col} disabled={saving} onClick={() => cambiarEstado(selected.servicio_id, col)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 disabled:opacity-40"
                    style={ESTADO_COLOR[col] ? { background: ESTADO_COLOR[col].bg, color: ESTADO_COLOR[col].text, borderColor: ESTADO_COLOR[col].border } : { background: '#F3F4F6', color: '#6B7280', borderColor: '#E5E7EB' }}>
                    {ESTADO_LABEL[col]}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Opción anticipados compostaje ── */}
            {selected.tipo_proceso?.startsWith('COMPOSTAJE') && selected.recordatorios_anticipados !== null && selected.recordatorios_anticipados !== undefined && (
              <div className="rounded-xl border-2 px-3 py-2.5 flex items-center gap-2"
                style={{ borderColor: selected.recordatorios_anticipados ? '#86EFAC' : '#FDE68A', background: selected.recordatorios_anticipados ? '#F0FFF4' : '#FFFBEB' }}>
                <span className="text-base">{selected.recordatorios_anticipados ? '⚡' : '⏳'}</span>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: selected.recordatorios_anticipados ? '#15803D' : '#92400E' }}>
                    {selected.recordatorios_anticipados ? 'Cliente quiere recordatorios ANTICIPADOS' : 'Cliente prefiere ESPERAR al proceso completo'}
                  </div>
                  <div className="text-[10px]" style={{ color: selected.recordatorios_anticipados ? '#166534' : '#78350F' }}>
                    {selected.recordatorios_anticipados ? 'Producir mientras el compostaje avanza.' : 'No producir hasta terminar el compostaje (~2 meses).'}
                  </div>
                </div>
              </div>
            )}

            {/* ── Indicaciones de diseño del cliente ── */}
            {selected.comentarios_cliente && (
              <div className="rounded-xl border-2 p-3 space-y-1" style={{ borderColor: '#93C5FD', background: '#EFF6FF' }}>
                <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#1D4ED8' }}>
                  💬 Indicaciones del cliente
                </div>
                <p className="text-[12px] text-blue-800 leading-relaxed">"{selected.comentarios_cliente}"</p>
              </div>
            )}

            {/* Ítems del servicio */}
            {recordatorios.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Ítems del servicio ({recordatorios.filter(r => r.estado === 'LISTO' || r.estado === 'ENTREGADO').length}/{recordatorios.filter(r => r.estado !== 'NA' && r.origen !== 'REMOVIDO').length} listos)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recordatorios.map(r => (
                    r.estado === 'NA'
                      ? <span key={r.id} className="text-[11px] px-2.5 py-1.5 rounded-full line-through opacity-50"
                          style={{ background: '#F3F4F6', color: '#9CA3AF' }} title="Cliente no desea este recordatorio">
                          {r.recordatorios?.nombre || 'Ítem'} · No desea
                        </span>
                      : <button key={r.id} className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full cursor-pointer transition-all prod-pill-${r.estado}`} onClick={() => ciclarRecordatorio(r)}>
                          {r.recordatorios?.nombre || 'Ítem'} · {r.estado.replace(/_/g, ' ')}
                        </button>
                  ))}
                </div>
              </div>
            )}

            {/* Comentarios del proceso */}
            <div className="pt-2" style={{ borderTop: '1px solid #F0F0F0' }}>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MessageSquare size={11} /> Comentarios del proceso
              </div>
              {novedades.length === 0
                ? <p className="text-[11px] text-gray-400 mb-2">Sin comentarios aún</p>
                : (
                  <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-1">
                    {novedades.map(c => (
                      <div key={c.id} className="rounded-lg px-3 py-2"
                        style={{ background: c.tipo_novedad === 'PAGO_RECIBIDO' ? '#F0FDF4' : '#F9FAFB', border: `1px solid ${c.tipo_novedad === 'PAGO_RECIBIDO' ? '#86EFAC' : '#E5E7EB'}` }}>
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[11px] font-semibold text-gray-700">{c.personal ? `${c.personal.nombre} ${c.personal.apellido}` : 'Sistema'}</span>
                          <span className="text-[10px] text-gray-400">{c.created_at ? new Date(c.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-relaxed">{c.descripcion}</p>
                        {c.valor_ajuste != null && <p className="text-[11px] font-bold mt-0.5" style={{ color: '#15803D' }}>💰 {fmt(c.valor_ajuste)}</p>}
                      </div>
                    ))}
                  </div>
                )
              }
              <div className="flex gap-2">
                <input type="text" value={nuevoComentario}
                  onChange={e => setNuevoComentario(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agregarComentario() } }}
                  placeholder="Agregar comentario al proceso…"
                  className="flex-1 px-3 py-2 rounded-xl border text-[12px] outline-none"
                  style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }} />
                <button onClick={agregarComentario} disabled={guardandoComentario || !nuevoComentario.trim()}
                  className="px-3 py-2 rounded-xl font-bold text-[12px] flex items-center gap-1.5 disabled:opacity-40 transition-all hover:opacity-90"
                  style={{ background: '#1A5CD8', color: '#fff' }}>
                  <Send size={13} />
                </button>
              </div>
            </div>

            {/* WhatsApp */}
            {selected.cliente_wa && (
              <a href={`https://wa.me/57${selected.cliente_wa.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, le escribimos de Camino al Cielo sobre el servicio de ${selected.mascota}`)}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#25D366' }}>
                <MessageCircle size={14} /> Escribir por WhatsApp
              </a>
            )}
          </div>
        </Modal>
      )}

      {/* Modal preparar entrega */}
      {modalEntrega && (
        <ModalPreparaEntrega
          servicioId={modalEntrega}
          onClose={() => setModalEntrega(null)}
          onGuardado={() => { setModalEntrega(null); cargar() }}
        />
      )}

      {/* ── Modal revisión / conversión de solicitud ─────────────────────── */}
      {selSolicitud && (
        <Modal open={!!selSolicitud} onClose={() => setSelSolicitud(null)}
          title="Revisión de solicitud"
          maxWidth="max-w-xl"
          footer={
            <div className="flex items-center justify-between w-full gap-3">
              <button onClick={() => descartarSolicitud(selSolicitud.id)}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-red-600 border border-red-200 hover:bg-red-50 transition-all">
                Descartar
              </button>
              <div className="flex gap-2">
                <button onClick={() => setSelSolicitud(null)}
                  className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all">
                  Cancelar
                </button>
                <button onClick={convertirSolicitud} disabled={convirtiendo}
                  className="px-5 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#0B1D4F,#1A5CD8)' }}>
                  {convirtiendo
                    ? <><div className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />Creando...</>
                    : '✅ Crear servicio'}
                </button>
              </div>
            </div>
          }>
          <div className="space-y-4">
            {/* Datos del cliente */}
            <div className="rounded-xl p-4 space-y-2" style={{ background: '#F8F9FA', border: '1px solid #F0F2F0' }}>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Propietario</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><span className="text-gray-400">Nombre: </span><span className="font-semibold">{selSolicitud.cliente_nombre} {selSolicitud.cliente_apellido || ''}</span></div>
                <div><span className="text-gray-400">WhatsApp: </span><span className="font-semibold">{selSolicitud.cliente_whatsapp}</span></div>
                {selSolicitud.cliente_email && <div className="col-span-2"><span className="text-gray-400">Email: </span><span className="font-semibold">{selSolicitud.cliente_email}</span></div>}
              </div>
            </div>

            {/* Datos de la mascota */}
            <div className="rounded-xl p-4 space-y-2" style={{ background: '#F8F9FA', border: '1px solid #F0F2F0' }}>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Mascota</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><span className="text-gray-400">Nombre: </span><span className="font-semibold">{petEmoji(solEspecieNombre)} {selSolicitud.mascota_nombre}</span></div>
                <div><span className="text-gray-400">Especie: </span><span className="font-semibold">{solEspecieNombre}</span></div>
                <div><span className="text-gray-400">Peso: </span><span className="font-semibold">{selSolicitud.mascota_peso_kg ? `${selSolicitud.mascota_peso_kg} kg` : '—'}</span></div>
                {selSolicitud.mascota_raza && <div><span className="text-gray-400">Raza: </span><span className="font-semibold">{selSolicitud.mascota_raza}</span></div>}
              </div>
              <div className="pt-1">
                <label className={SOL_LABL}>Sexo (confirmar)</label>
                <div className="flex gap-2">
                  {['Macho','Hembra'].map(v => (
                    <button key={v} type="button"
                      onClick={() => setConvForm(prev => ({ ...prev, mascota_sexo: v }))}
                      className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-all ${convForm.mascota_sexo === v ? 'border-[#1A5CD8] bg-[#EFF5FF] text-[#1A5CD8]' : 'border-gray-200 text-gray-400'}`}>
                      {v === 'Macho' ? '♂' : '♀'} {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Plan y recogida */}
            <div className="rounded-xl p-4" style={{ background: '#F8F9FA', border: '1px solid #F0F2F0' }}>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Servicio</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><span className="text-gray-400">Plan: </span><span className="font-semibold">{solPlanNombre}</span></div>
                <div><span className="text-gray-400">Recogida: </span><span className="font-semibold">{selSolicitud.tipo_recogida === 'veterinaria' ? '🏥 Veterinaria' : '🏠 Domicilio'}</span></div>
                {selSolicitud.tipo_recogida === 'domicilio' && selSolicitud.direccion && (
                  <div className="col-span-2"><span className="text-gray-400">Dirección: </span><span className="font-semibold">{selSolicitud.barrio ? `${selSolicitud.barrio} · ` : ''}{selSolicitud.direccion}</span></div>
                )}
                {selSolicitud.tipo_recogida === 'veterinaria' && (
                  <div className="col-span-2">
                    <span className="text-gray-400">Veterinaria: </span>
                    <span className="font-semibold">{solAliadoNombre}</span>
                    {selSolicitud.aliado_nombre_otro && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Posible nuevo aliado</span>}
                  </div>
                )}
                {selSolicitud.hora_aproximada && <div><span className="text-gray-400">Hora aprox: </span><span className="font-semibold">{selSolicitud.hora_aproximada}</span></div>}
                {selSolicitud.notas_cliente && <div className="col-span-2"><span className="text-gray-400">Notas: </span><span className="font-semibold">{selSolicitud.notas_cliente}</span></div>}
              </div>
            </div>

            {/* Campos a completar */}
            <div className="rounded-xl p-4 space-y-3" style={{ border: '2px solid #EFF5FF', background: '#FAFCFF' }}>
              <p className="text-[11px] font-bold text-[#1A5CD8] uppercase tracking-wider">Completar para crear el servicio</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={SOL_LABL}>Técnico asignado</label>
                  <select value={convForm.tecnico_id} onChange={e => setConvForm(prev => ({ ...prev, tecnico_id: e.target.value }))} className={SOL_INP}>
                    <option value="">Sin asignar</option>
                    {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.apellido || ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={SOL_LABL}>Acompañamiento</label>
                  <select value={convForm.tipo_acompanamiento} onChange={e => setConvForm(prev => ({ ...prev, tipo_acompanamiento: e.target.value }))} className={SOL_INP}>
                    <option value="PRESENCIAL">Presencial</option>
                    <option value="VIDEOLLAMADA">Videollamada</option>
                    <option value="EVIDENCIA">Solo evidencias</option>
                  </select>
                </div>
                <div>
                  <label className={SOL_LABL}>Valor total (COP)</label>
                  <input type="number" className={SOL_INP} placeholder="0" value={convForm.valor_total}
                    onChange={e => setConvForm(prev => ({ ...prev, valor_total: e.target.value }))} />
                </div>
                <div>
                  <label className={SOL_LABL}>Estado de pago</label>
                  <select value={convForm.estado_pago} onChange={e => setConvForm(prev => ({ ...prev, estado_pago: e.target.value }))} className={SOL_INP}>
                    <option value="PENDIENTE">Pendiente</option>
                    <option value="PARCIAL">Parcial</option>
                    <option value="COMPLETO">Completo</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={SOL_LABL}>Método de pago</label>
                  <select value={convForm.metodo_pago} onChange={e => setConvForm(prev => ({ ...prev, metodo_pago: e.target.value }))} className={SOL_INP}>
                    <option value="">— Sin especificar —</option>
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="TARJETA">Tarjeta</option>
                    <option value="NEQUI">Nequi / Daviplata</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
    </>
  )
}
