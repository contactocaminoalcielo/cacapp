import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { EstadoBadge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { registrarSalidaCuartoFrio } from '@/lib/cuartoFrio'
import { cargarConfigTenjo, sincronizarAlertasTenjo, CONFIG_DEFAULTS } from '@/lib/tenjo'
import PlanificacionTab from '@/pages/tenjo/PlanificacionTab'
import JornadaTab from '@/pages/tenjo/JornadaTab'
import CandidatasTab from '@/pages/tenjo/CandidatasTab'
import ControlTab from '@/pages/tenjo/ControlTab'
import CubiculosTab from '@/pages/tenjo/CubiculosTab'
import VisitasTab from '@/pages/tenjo/VisitasTab'
import { addDiasHabiles, parsearErrorDB, petEmoji, today } from '@/lib/utils'
import { Truck, RefreshCw, Plus, CheckCircle2, Flame, FileText, Printer, Clock, History } from 'lucide-react'

function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

// ─── Certificado individual (cremación o compostaje) ──────────────────────────
function CertificadoIndividualModal({ traslado, onClose }) {
  const svc      = traslado.servicios
  const m        = svc?.mascotas
  const c        = m?.clientes
  const plan     = svc?.planes
  const esEco    = plan?.tipo_proceso === 'COMPOSTAJE_INDIVIDUAL'
  const tipoCert = esEco ? 'COMPOSTAJE INDIVIDUAL' : 'CREMACIÓN INDIVIDUAL'
  const mascota  = m?.nombre    || '-'
  const especie  = m?.especies?.nombre || '-'
  const cliente  = `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-'
  const fechaProc = traslado.fecha_completado || today()
  const certFecha = addDiasHabiles(fechaProc, 3)

  function imprimir() {
    const w = window.open('', '_blank', 'width=820,height=700')
    w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Certificado ${tipoCert} — ${mascota}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a;
           max-width: 680px; margin: 48px auto; padding: 40px; background: #fff; }
    .logo-area { text-align: center; padding-bottom: 20px; margin-bottom: 28px;
                 border-bottom: 2.5px solid #1A5CD8; }
    .logo-name  { font-size: 22px; font-weight: bold; color: #1A5CD8; letter-spacing: 1.5px; }
    .logo-sub   { font-size: 11px; color: #777; margin-top: 5px; letter-spacing: 0.5px; }
    .cert-title { font-size: 16px; font-weight: bold; text-align: center; letter-spacing: 3px;
                  color: #0B1D4F; text-transform: uppercase; margin: 24px 0; }
    .intro-text { font-size: 13px; line-height: 1.9; color: #333; margin-bottom: 20px; text-align: justify; }
    .pet-box    { background: #f5f8f2; border-left: 4px solid #1A5CD8; padding: 14px 18px;
                  border-radius: 4px; margin: 18px 0; }
    .pet-box h3 { font-size: 11px; font-weight: bold; color: #1A5CD8; letter-spacing: 1px;
                  text-transform: uppercase; margin-bottom: 10px; }
    .pet-table  { width: 100%; border-collapse: collapse; }
    .pet-table td { font-size: 12px; padding: 3px 0; vertical-align: top; }
    .pet-table td:first-child { width: 40%; color: #555; font-weight: bold; padding-right: 8px; }
    .pet-table td:last-child  { color: #1a1a1a; }
    .process-text { font-size: 12.5px; line-height: 1.85; color: #444; margin: 20px 0; text-align: justify; }
    .sigs       { display: flex; justify-content: space-between; margin-top: 56px; }
    .sig-box    { width: 44%; text-align: center; }
    .sig-line   { border-top: 1px solid #888; padding-top: 8px; font-size: 11px; color: #555; }
    .sig-sub    { font-size: 10px; color: #999; margin-top: 3px; }
    .footer     { text-align: center; margin-top: 36px; padding-top: 14px; border-top: 1px solid #eee;
                  font-size: 10px; color: #aaa; }
    @media print { body { margin: 24px; } }
  </style>
</head>
<body>
  <div class="logo-area">
    <div class="logo-name">🕊️ CAMINO AL CIELO</div>
    <div class="logo-sub">Servicios Funerarios para Mascotas · Bogotá, Colombia</div>
    <div class="logo-sub" style="margin-top:3px">contacto@caminoalcielo.com.co</div>
  </div>

  <div class="cert-title">Certificado de ${tipoCert}</div>

  <p class="intro-text">
    La empresa <strong>Camino al Cielo — Servicios Funerarios para Mascotas</strong>
    certifica que la mascota de la familia <strong>${cliente}</strong>,
    cuyos datos se detallan a continuación, fue sometida al proceso de
    <strong>${tipoCert.toLowerCase()}</strong> en la planta de Tenjo, Cundinamarca,
    conforme al plan <strong>${plan?.nombre || '-'}</strong> contratado.
  </p>

  <div class="pet-box">
    <h3>Información de la Mascota</h3>
    <table class="pet-table">
      <tr><td>Nombre:</td><td><strong>${mascota}</strong></td></tr>
      <tr><td>Especie:</td><td>${especie}</td></tr>
      <tr><td>Propietario(s):</td><td>${cliente}</td></tr>
      <tr><td>Plan:</td><td>${plan?.nombre || '-'}</td></tr>
      <tr><td>Fecha de proceso:</td><td>${fmtFecha(fechaProc)}</td></tr>
      <tr><td>Fecha de certificado:</td><td>${fmtFecha(certFecha)}</td></tr>
    </table>
  </div>

  ${esEco ? `
  <p class="process-text">
    El proceso de <strong>compostaje individual</strong> fue realizado en condiciones controladas
    en la planta de Tenjo, Cundinamarca. El material procesado estará disponible para el propietario
    según las condiciones acordadas en el contrato de servicio.
  </p>
  ` : `
  <p class="process-text">
    El proceso de <strong>cremación individual</strong> garantiza que las cenizas obtenidas
    corresponden exclusivamente a la mascota indicada. Las cenizas serán entregadas al propietario
    en el paquete de recordatorios, según el plan contratado.
  </p>
  `}

  <div class="sigs">
    <div class="sig-box">
      <div class="sig-line">Camino al Cielo</div>
      <div class="sig-sub">Dirección Operativa · Planta Tenjo</div>
    </div>
    <div class="sig-box">
      <div class="sig-line">${fmtFecha(certFecha)}</div>
      <div class="sig-sub">Fecha de emisión del certificado</div>
    </div>
  </div>

  <div class="footer">
    Camino al Cielo · Bogotá, Colombia · contacto@caminoalcielo.com.co<br>
    Este certificado es válido sin firma manuscrita como constancia del servicio prestado.
  </div>
</body>
</html>`)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }

  return (
    <Modal open onClose={onClose} title={`Certificado — ${mascota}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-xl border p-5 bg-gray-50 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
          <div className="text-center pb-3 border-b" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
            <p className="font-bold text-[13px]" style={{ color: '#1A5CD8' }}>🕊️ CAMINO AL CIELO</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Servicios Funerarios para Mascotas · Planta Tenjo</p>
          </div>
          <p className="text-center font-bold uppercase tracking-widest text-[11px]" style={{ color: '#0B1D4F' }}>
            Certificado de {tipoCert}
          </p>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {[
              ['Mascota', mascota], ['Especie', especie],
              ['Propietario', cliente], ['Plan', plan?.nombre || '-'],
              ['Fecha de proceso', fmtFecha(fechaProc)],
              ['Fecha certificado (3er día hábil)', fmtFecha(certFecha), true],
            ].map(([k, v, span]) => (
              <div key={k} className={span ? 'col-span-2' : ''}>
                <span className="text-gray-400">{k}: </span>
                <span className="font-medium text-gray-800">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button onClick={imprimir} className="gap-1.5">
            <Printer size={13} /> Imprimir / Guardar PDF
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Tenjo() {
  const { confirm, alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  const [traslados,         setTraslados]         = useState([])
  const [aptosTraslado,     setAptosTraslado]     = useState([])
  const [cenizasEspera,     setCenizasEspera]     = useState([])   // < 5 días desde cremación
  const [cenizasListas,     setCenizasListas]     = useState([])   // ≥ 5 días, listas para traslado de regreso
  const [cenizasPendientes, setCenizasPendientes] = useState([])   // traslado de regreso llegó, confirmar
  const [procesados,        setProcesados]        = useState([])
  const [personal,          setPersonal]          = useState([])
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState(null)
  const [modalNuevo,        setModalNuevo]        = useState(false)
  const [mascotaParaTraslado, setMascotaParaTraslado] = useState(null)
  const [formTraslado,      setFormTraslado]      = useState({ fecha_programada: today(), tecnico_id: '', notas: '' })
  const [saving,            setSaving]            = useState(false)
  const [certIndModal,      setCertIndModal]      = useState(null)
  const [modalRetro,        setModalRetro]        = useState(null) // cuarto_frio row — registro retroactivo
  const [formRetro,         setFormRetro]         = useState({ fecha_proceso: today(), tecnico_id: '', notas: '', listo: true })
  const [modalRecibir,      setModalRecibir]      = useState(null) // traslado individual a recibir en planta
  const [formRecibir,       setFormRecibir]       = useState({ recibidoPor: '', novedad: '' })
  // El PRODUCTOR solo ejecuta en planta: ve únicamente Jornada y Operación.
  // El operario arranca en la Jornada (Planificación es de solo lectura para él).
  const esProductor = personalData?.rol === 'PRODUCTOR'
  const arrancaEnJornada = esProductor || personalData?.rol === 'OPERARIO'
  const [tab,               setTab]               = useState(arrancaEnJornada ? 'jornada' : 'planificacion')
  const [config,            setConfig]            = useState(CONFIG_DEFAULTS)
  const [candidatas,        setCandidatas]        = useState([]) // null = migración 003 sin aplicar

  const canPlan = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)
  // Pestañas que puede ver cada rol. El PRODUCTOR queda limitado a Jornada y Operación.
  const tabsVisibles = esProductor
    ? ['jornada', 'operacion']
    : ['planificacion', 'jornada', 'candidatas', 'control', 'cubiculos', 'visitas', 'operacion']

  useEffect(() => {
    cargar()
    const canal = db
      .channel('tenjo-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traslados_tenjo' }, () => { cargar() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servicios' }, () => { cargar() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cuarto_frio' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data: tras }, { data: cenizas }, { data: cuarto }, { data: per }, { data: procComp }] = await Promise.all([
        db.from('traslados_tenjo')
          .select('*, servicios!inner(mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo)), tecnico:tecnico_id(nombre,apellido)')
          .in('estado', ['PROGRAMADO','EN_CAMINO'])
          .gte('servicios.fecha_ingreso', FECHA_CORTE)
          .order('fecha_traslado', { ascending: true }),
        // Traslados completados donde servicio aún está EN_PROCESO → contar 5 días
        db.from('traslados_tenjo')
          .select('*, servicios!inner(id,estado,mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo,tipo_proceso)), tecnico:tecnico_id(nombre,apellido)')
          .eq('estado', 'COMPLETADO')
          .eq('servicios.estado', 'EN_PROCESO')
          .gte('servicios.fecha_ingreso', FECHA_CORTE)
          .order('fecha_completado', { ascending: true }),
        db.from('cuarto_frio')
          .select('*, servicios!inner(mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo,tipo_proceso))')
          .eq('estado', 'REFRIGERADO')
          .gte('servicios.fecha_ingreso', FECHA_CORTE),
        db.from('personal').select('*').eq('activo', true).order('nombre'),
        // Individuales procesados (cenizas ya confirmadas) — para emitir certificados
        db.from('traslados_tenjo')
          .select('*, servicios!inner(id,estado,mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo,tipo_proceso)), tecnico:tecnico_id(nombre,apellido)')
          .eq('estado', 'COMPLETADO')
          .gte('servicios.fecha_ingreso', FECHA_CORTE)
          .order('fecha_completado', { ascending: false })
          .limit(30),
      ])
      setTraslados(tras || [])

      // Separar cenizas según días transcurridos desde la cremación
      const hoy = new Date(); hoy.setHours(0,0,0,0)
      const cremaciones = (cenizas || []).filter(t => t.servicios?.estado === 'EN_PROCESO')
      const espera = [], listas = []
      cremaciones.forEach(t => {
        if (!t.fecha_completado) { espera.push({ ...t, diasDesde: null, diasRestantes: 5 }); return }
        const fc = new Date(t.fecha_completado + 'T12:00:00')
        const diasDesde   = Math.floor((hoy - fc) / 86400000)
        const diasRestantes = Math.max(0, 5 - diasDesde)
        if (diasDesde >= 5) listas.push({ ...t, diasDesde, diasRestantes: 0 })
        else                espera.push({ ...t, diasDesde, diasRestantes })
      })
      setCenizasEspera(espera)
      setCenizasListas(listas)
      setCenizasPendientes(cremaciones) // total para el stat

      // Individuales con cenizas confirmadas (servicio ya avanzó de EN_PROCESO)
      setProcesados((procComp || []).filter(t => {
        const estado = t.servicios?.estado
        const tipo   = t.servicios?.planes?.tipo_proceso
        return (tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL')
          && ['EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO'].includes(estado)
      }))
      // Mascotas en cuarto_frio aptas para traslado individual, excluyendo las que ya tienen traslado activo
      const serviciosConTraslado = new Set((tras || []).map(t => t.servicio_id))
      setAptosTraslado((cuarto || []).filter(r => {
        const tipo = r.servicios?.planes?.tipo_proceso
        return (tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL')
          && !serviciosConTraslado.has(r.servicio_id)
      }))

      // El seguimiento de compostajes ya no vive aquí: la asignación de cubículo
      // ocurre en Jornada (contra el catálogo `cubiculos`, migración 055), los
      // plazos se ven en Control y la ocupación en el mapa de Cubículos.
      // La tabla `seguimiento_compostaje` quedó sin uso (0/263 con planta_lista).
      setPersonal(per || [])

      // ── Planificación (Fase 1): config + candidatas desde v_candidatos_tenjo ──
      const cfg = await cargarConfigTenjo()
      setConfig(cfg)
      const { data: cand, error: errCand } = await db.from('v_candidatos_tenjo').select('*')
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('fecha_ingreso', { ascending: true })
      if (errCand) {
        setCandidatas(null) // migración 003 sin aplicar — las tabs nuevas muestran el aviso
      } else {
        setCandidatas(cand || [])
        // Alertas persistentes con dedupe (best-effort; el job del backend tomará el relevo)
        sincronizarAlertasTenjo(cand || [], cfg).catch(() => {})
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Actualiza el estado del item de lote vinculado (si la migración 003 ya corrió)
  async function actualizarItemLote(servicioId, estadoItem, extra = {}) {
    const { error } = await db.from('lotes_tenjo_items')
      .update({ estado: estadoItem, ...extra })
      .eq('servicio_id', servicioId)
      .in('estado', ['PROPUESTO', 'APROBADO', 'AUTORIZADA_SALIDA', 'EN_TRASLADO'])
    if (error && error.code !== '42P01') console.error('[tenjo items]', error.message)
  }

  async function actualizarTraslado(id, estado, servicioId, recepcion = null) {
    try {
      const { error } = await db.from('traslados_tenjo').update({
        estado,
        ...(estado === 'COMPLETADO' && {
          fecha_completado: today(),
          fecha_recepcion:  new Date().toISOString(),
          recibido_por:     recepcion?.recibidoPor || personalData?.id || null,
          ...(recepcion?.novedad?.trim() && { recepcion_novedad: recepcion.novedad.trim() }),
        }),
      }).eq('id', id)
      if (error) throw error
      if (estado === 'EN_CAMINO' && servicioId) {
        // Retiro físico del cuarto frío: el camión sale con la mascota.
        // TRASLADADO + fecha_salida + movimiento de auditoría.
        await registrarSalidaCuartoFrio(servicioId, {
          personalId: personalData?.id,
          tipo:       'SALIDA_TENJO',
          motivo:     'Salida física — traslado a Tenjo en camino',
        })
        await actualizarItemLote(servicioId, 'EN_TRASLADO')
      }
      if (estado === 'COMPLETADO' && servicioId) {
        const { error: errSvc } = await db.from('servicios').update({ estado: 'EN_PROCESO' }).eq('id', servicioId)
        if (errSvc) throw errSvc
        // Respaldo idempotente: si el paso EN_CAMINO se saltó, registrar la salida aquí
        await registrarSalidaCuartoFrio(servicioId, {
          personalId: personalData?.id,
          tipo:       'SALIDA_TENJO',
          motivo:     'Traslado a Tenjo completado',
        })
        // Sellar la recepción también en el item del lote (si la mascota venía en uno)
        const conNovedad = !!recepcion?.novedad?.trim()
        await actualizarItemLote(servicioId, 'RECIBIDA', {
          recepcion_estado:  conNovedad ? 'NOVEDAD' : 'RECIBIDA',
          fecha_recepcion:   new Date().toISOString(),
          recibido_por:      recepcion?.recibidoPor || personalData?.id || null,
          ...(conNovedad && { recepcion_novedad: recepcion.novedad.trim() }),
        })
      }
      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    }
  }

  async function confirmarCenizas(servicioId, traslado) {
    if (!await confirm('El servicio pasará a EN_PRODUCCION.', { title: '¿Confirmar que las cenizas están listas?', variant: 'warning', confirmLabel: 'Confirmar' })) return
    try {
      await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', servicioId)
      // Respaldo idempotente: cenizas listas ⇒ la mascota salió del cuarto frío
      // hace rato; cierra la custodia si el traslado no la registró.
      await registrarSalidaCuartoFrio(servicioId, {
        personalId: personalData?.id,
        tipo:       'SALIDA_TENJO',
        motivo:     'Cenizas confirmadas — salida no registrada en el traslado',
      })
      await cargar()
      // Ofrecer generar certificado inmediatamente después de confirmar
      if (traslado) setCertIndModal(traslado)
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    }
  }

  // Registro retroactivo: una mascota cuyo proceso YA se hizo pero no quedó
  // registrado. Mira el flujo legado (traslado COMPLETADO + salida del cuarto
  // frío + servicio avanzado), para que aparezca como procesada y certificable.
  async function registrarProcesoRetroactivo() {
    const r = modalRetro
    if (!r) return
    if (!formRetro.fecha_proceso) { await showAlert('Indica la fecha en que se realizó el proceso.', { title: 'Fecha requerida' }); return }
    if (!await confirm(
      `Se registrará el proceso de ${r.servicios?.mascotas?.nombre} como ya realizado el ${fmtFecha(formRetro.fecha_proceso)}, `
      + `saldrá del cuarto frío y el servicio pasará a ${formRetro.listo ? 'EN PRODUCCIÓN (listo para certificado)' : 'EN PROCESO'}.`,
      { title: '¿Registrar proceso ya realizado?', variant: 'warning', confirmLabel: 'Registrar' }
    )) return
    setSaving(true)
    try {
      // 1. Salida física del cuarto frío (idempotente)
      await registrarSalidaCuartoFrio(r.servicio_id, {
        personalId: personalData?.id,
        tipo:       'SALIDA_TENJO',
        motivo:     'Registro retroactivo — proceso ya realizado',
      })
      // 2. Traslado COMPLETADO con las fechas del proceso
      const { error: errT } = await db.from('traslados_tenjo').insert({
        servicio_id:      r.servicio_id,
        estado:           'COMPLETADO',
        fecha_traslado:   formRetro.fecha_proceso,
        fecha_completado: formRetro.fecha_proceso,
        tecnico_id:       formRetro.tecnico_id || null,
        notas:            `Registro retroactivo${formRetro.notas ? ' — ' + formRetro.notas : ''}`,
      })
      if (errT && errT.code !== '23505') throw errT
      // 3. Avanzar el servicio
      await db.from('servicios')
        .update({ estado: formRetro.listo ? 'EN_PRODUCCION' : 'EN_PROCESO' })
        .eq('id', r.servicio_id)
      setModalRetro(null)
      setFormRetro({ fecha_proceso: today(), tecnico_id: '', notas: '', listo: true })
      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error registrando proceso', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function crearTraslado() {
    if (!mascotaParaTraslado) return
    setSaving(true)
    try {
      const { error } = await db.from('traslados_tenjo').insert({
        servicio_id: mascotaParaTraslado.servicio_id,
        estado: 'PROGRAMADO',
        fecha_traslado: formTraslado.fecha_programada,
        tecnico_id: formTraslado.tecnico_id || null,
        notas: formTraslado.notas,
      })
      if (error) {
        // 23505 = índice único uq_traslados_tenjo_activo (traslado activo duplicado)
        if (error.code === '23505') {
          await showAlert('Esta mascota ya tiene un traslado activo a Tenjo. Revisa la lista de traslados.', { title: 'Traslado duplicado', variant: 'danger' })
          await cargar()
          return
        }
        throw error
      }
      setModalNuevo(false)
      setMascotaParaTraslado(null)
      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            {tabsVisibles.includes('planificacion') && <TabsTrigger value="planificacion">📋 Planificación</TabsTrigger>}
            {tabsVisibles.includes('jornada') && <TabsTrigger value="jornada">🔥 Jornada</TabsTrigger>}
            {tabsVisibles.includes('candidatas') && (
              <TabsTrigger value="candidatas">
                🐾 Candidatas{Array.isArray(candidatas) && candidatas.length > 0 ? ` (${candidatas.length})` : ''}
              </TabsTrigger>
            )}
            {tabsVisibles.includes('control') && <TabsTrigger value="control">📊 Control</TabsTrigger>}
            {tabsVisibles.includes('cubiculos') && <TabsTrigger value="cubiculos">🗺️ Cubículos</TabsTrigger>}
            {tabsVisibles.includes('visitas') && <TabsTrigger value="visitas">🚶 Visitas</TabsTrigger>}
            {tabsVisibles.includes('operacion') && <TabsTrigger value="operacion">🚚 Operación</TabsTrigger>}
          </TabsList>

          <TabsContent value="planificacion">
            <PlanificacionTab
              config={config}
              candidatas={candidatas}
              personalData={personalData}
              canPlan={canPlan}
              onChanged={cargar}
            />
          </TabsContent>

          <TabsContent value="jornada">
            <JornadaTab
              config={config}
              personalData={personalData}
              canPlan={canPlan}
              personal={personal}
              onChanged={cargar}
            />
          </TabsContent>

          <TabsContent value="candidatas">
            <CandidatasTab
              candidatas={candidatas}
              config={config}
              canPlan={canPlan}
              personalData={personalData}
              onChanged={cargar}
            />
          </TabsContent>

          <TabsContent value="control">
            <ControlTab canPlan={canPlan} personalData={personalData} />
          </TabsContent>

          <TabsContent value="cubiculos">
            <CubiculosTab canPlan={canPlan} personalData={personalData} onChanged={cargar} />
          </TabsContent>

          <TabsContent value="visitas">
            <VisitasTab canPlan={canPlan} personalData={personalData} onChanged={cargar} />
          </TabsContent>

          <TabsContent value="operacion">
          <div className="space-y-7">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Traslados programados" value={traslados.filter(t => t.estado === 'PROGRAMADO').length} valueColor="#3B6FBF" />
          <StatCard label="En camino" value={traslados.filter(t => t.estado === 'EN_CAMINO').length} valueColor="#9A5500" />
          <StatCard label="Cenizas listas para recoger" value={cenizasListas.length} valueColor={cenizasListas.length > 0 ? '#C03030' : '#9CA3AF'} />
          <StatCard label="Aptas para traslado" value={aptosTraslado.length} valueColor="#1D8A55" />
        </div>

        {/* Traslados activos */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <Truck size={16} className="text-ink3 mr-2" />
            <div className="font-semibold text-[15px] text-ink">Traslados activos</div>
          </div>
          {traslados.length === 0 ? (
            <div className="py-12 text-center text-ink3 text-sm">Sin traslados activos</div>
          ) : (
            <div className="p-5 space-y-3">
              {traslados.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                const tec = t.tecnico
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border hover:bg-surface2 transition-all"
                    style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">{m?.nombre}</div>
                      <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      <div className="text-[11px] text-ink2 mt-0.5">
                        {t.fecha_traslado && `Programado: ${new Date(t.fecha_traslado + 'T12:00:00').toLocaleDateString('es-CO')}`}
                        {tec && ` · ${tec.nombre} ${tec.apellido}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {t.estado === 'PROGRAMADO' && (
                        <Button size="sm" variant="secondary" onClick={() => actualizarTraslado(t.id, 'EN_CAMINO', t.servicio_id)}>
                          En camino
                        </Button>
                      )}
                      {['PROGRAMADO', 'EN_CAMINO'].includes(t.estado) && (
                        <Button size="sm" onClick={() => { setModalRecibir(t); setFormRecibir({ recibidoPor: personalData?.id || '', novedad: '' }) }}>
                          <CheckCircle2 size={13} /> Recibir en planta
                        </Button>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${t.estado === 'EN_CAMINO' ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#EEF3FB] text-[#3B6FBF]'}`}>
                      {t.estado.replace('_', ' ')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Cenizas: esperando 5 días */}
        {cenizasEspera.length > 0 && (
          <div className="bg-surface border-2 rounded-2xl shadow-sm" style={{ borderColor: '#93C5FD' }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(147,197,253,0.4)' }}>
              <Clock size={15} style={{ color: '#2563EB' }} />
              <div className="font-semibold text-[15px] text-ink flex-1">Cremación completada — esperando 5 días</div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>
                {cenizasEspera.length} en espera
              </span>
            </div>
            <div className="p-5 space-y-3">
              {cenizasEspera.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                const progreso = t.diasRestantes != null ? Math.round(((5 - t.diasRestantes) / 5) * 100) : 0
                return (
                  <div key={t.id} className="p-4 rounded-xl border" style={{ borderColor: 'rgba(147,197,253,0.3)', background: '#EFF6FF' }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
                      <div className="flex-1">
                        <div className="font-semibold text-ink">{m?.nombre}</div>
                        <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] font-bold" style={{ color: '#1D4ED8' }}>
                          {t.diasRestantes != null ? `${t.diasRestantes} día${t.diasRestantes !== 1 ? 's' : ''}` : '?'} restantes
                        </div>
                        <div className="text-[10px] text-ink3">
                          Cremado: {t.fecha_completado ? fmtFecha(t.fecha_completado) : '-'}
                        </div>
                      </div>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${progreso}%`, background: '#3B82F6' }} />
                    </div>
                    <div className="text-[10px] text-blue-400 mt-1">{progreso}% del período de espera completado</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Cenizas: listas para traslado de regreso */}
        {cenizasListas.length > 0 && (
          <div className="bg-surface border-2 rounded-2xl shadow-sm" style={{ borderColor: '#C03030' }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(192,48,48,0.2)' }}>
              <Flame size={16} className="text-danger" />
              <div className="font-semibold text-[15px] text-ink flex-1">Cenizas listas — solicitar traslado de regreso</div>
              <span className="text-[11px] font-bold text-danger bg-danger-light px-2 py-0.5 rounded-full">
                {cenizasListas.length} lista{cenizasListas.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="p-5 space-y-3">
              {cenizasListas.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border hover:bg-surface2 transition-all"
                    style={{ borderColor: 'rgba(192,48,48,0.15)', background: '#FFF8F8' }}>
                    <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">{m?.nombre}</div>
                      <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: '#C03030' }}>
                        Cremado el {fmtFecha(t.fecha_completado)} · {t.diasDesde} días transcurridos
                      </div>
                    </div>
                    <Button size="sm" variant="primary"
                      onClick={() => confirmarCenizas(t.servicios?.id, t)}>
                      <CheckCircle2 size={13} /> Confirmar cenizas recibidas
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Aptos para traslado */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="font-semibold text-[15px] text-ink flex-1">Mascotas listas para traslado individual</div>
          </div>
          {aptosTraslado.length === 0 ? (
            <div className="py-8 text-center text-ink3 text-sm">Sin mascotas listas para traslado</div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Mascota</Th>
                    <Th>Cliente</Th>
                    <Th>Plan</Th>
                    <Th>Nevera</Th>
                    <Th>Peso (kg)</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {aptosTraslado.map(r => {
                    const m = r.servicios?.mascotas
                    const c = m?.clientes
                    const p = r.servicios?.planes
                    return (
                      <Tr key={r.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span>{petEmoji(m?.especies?.nombre)}</span>
                            <span className="font-semibold text-ink">{m?.nombre}</span>
                          </div>
                        </Td>
                        <Td className="text-ink2">{c?.nombre} {c?.apellido}</Td>
                        <Td className="text-ink3">{p?.nombre}</Td>
                        <Td className="font-mono text-[11px]">{r.nevera_codigo || '-'}</Td>
                        <Td>{m?.peso_kg || '-'}</Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="secondary"
                              onClick={() => { setMascotaParaTraslado({ ...r, servicio_id: r.servicio_id }); setModalNuevo(true) }}>
                              <Plus size={12} /> Agregar traslado
                            </Button>
                            <Button size="sm" variant="secondary"
                              onClick={() => { setModalRetro(r); setFormRetro({ fecha_proceso: today(), tecnico_id: '', notas: '', listo: true }) }}>
                              <History size={12} /> Ya procesado
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>


        {/* Individuales procesados — certificados */}
        {procesados.length > 0 && (
          <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              <FileText size={15} className="text-ink3" />
              <div className="font-semibold text-[15px] text-ink flex-1">Individuales procesados — Certificados</div>
              <span className="text-[11px] text-ink3 bg-surface2 px-2 py-0.5 rounded-full">{procesados.length}</span>
            </div>
            <div className="p-5 space-y-3">
              {procesados.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                const esEco = p?.tipo_proceso === 'COMPOSTAJE_INDIVIDUAL'
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border hover:bg-surface2 transition-all"
                    style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <span className="text-2xl">{esEco ? '🌿' : '🔥'}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">{m?.nombre}</div>
                      <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      <div className="text-[11px] text-ink2 mt-0.5">
                        Procesado: {fmtFecha(t.fecha_completado)}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setCertIndModal(t)}>
                      <FileText size={12} /> Certificado
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
          </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal nuevo traslado */}
      {modalNuevo && (
        <Modal open={modalNuevo} onClose={() => { setModalNuevo(false); setMascotaParaTraslado(null) }}
          title="Programar traslado" maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalNuevo(false)}>Cancelar</Button>
              <Button onClick={crearTraslado} disabled={saving}>{saving ? 'Guardando...' : 'Programar'}</Button>
            </>
          }>
          <div className="space-y-3">
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Fecha programada</label>
              <Input type="date" value={formTraslado.fecha_programada} onChange={e => setFormTraslado(p => ({ ...p, fecha_programada: e.target.value }))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Técnico</label>
              <Select value={formTraslado.tecnico_id} onChange={e => setFormTraslado(p => ({ ...p, tecnico_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
              <Textarea value={formTraslado.notas} onChange={e => setFormTraslado(p => ({ ...p, notas: e.target.value }))} /></div>
          </div>
        </Modal>
      )}

      {/* Modal registro retroactivo de proceso ya realizado */}
      {modalRetro && (
        <Modal open onClose={() => setModalRetro(null)}
          title={`Registrar proceso ya realizado — ${modalRetro.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalRetro(null)}>Cancelar</Button>
              <Button onClick={registrarProcesoRetroactivo} disabled={saving}>{saving ? 'Guardando...' : 'Registrar proceso'}</Button>
            </>
          }>
          <div className="space-y-4">
            <div className="rounded-xl p-3 text-[12px]" style={{ background: '#FFFBEB', borderColor: '#FCD34D', border: '1px solid' }}>
              Para procesos que <strong>ya se realizaron</strong> pero no quedaron registrados. Se registrará la salida del cuarto frío, un traslado completado con la fecha indicada y se avanzará el servicio.
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Fecha en que se hizo el proceso *</label>
              <Input type="date" max={today()} value={formRetro.fecha_proceso}
                onChange={e => setFormRetro(p => ({ ...p, fecha_proceso: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Responsable del proceso</label>
              <Select value={formRetro.tecnico_id} onChange={e => setFormRetro(p => ({ ...p, tecnico_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[#3D5A27]"
                checked={formRetro.listo}
                onChange={e => setFormRetro(p => ({ ...p, listo: e.target.checked }))} />
              <span className="text-[12px] font-semibold text-ink2">El proceso está completo (cenizas/planta listas) → marcar EN PRODUCCIÓN</span>
            </label>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
              <Textarea value={formRetro.notas}
                onChange={e => setFormRetro(p => ({ ...p, notas: e.target.value }))}
                placeholder="Detalle del registro retroactivo…" />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal recibir traslado individual en planta */}
      {modalRecibir && (
        <Modal open onClose={() => setModalRecibir(null)}
          title={`Recibir en planta — ${modalRecibir.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalRecibir(null)}>Cancelar</Button>
              <Button disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await actualizarTraslado(modalRecibir.id, 'COMPLETADO', modalRecibir.servicio_id, formRecibir)
                    setModalRecibir(null)
                  } finally { setSaving(false) }
                }}>
                {saving ? 'Guardando…' : 'Confirmar recepción'}
              </Button>
            </>
          }>
          <div className="space-y-4">
            <div className="rounded-xl p-3 text-[12px]" style={{ background: '#ECFEFF', borderColor: '#A5F3FC', border: '1px solid' }}>
              Se sella la hora de llegada a la planta, la mascota sale del cuarto frío y el servicio pasa a <strong>EN PROCESO</strong>.
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Quién recibe</label>
              <Select value={formRecibir.recibidoPor} onChange={e => setFormRecibir(p => ({ ...p, recibidoPor: e.target.value }))}>
                <option value="">Yo ({personalData?.nombre || 'operario'})</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Novedad de recepción (opcional)</label>
              <Textarea value={formRecibir.novedad}
                onChange={e => setFormRecibir(p => ({ ...p, novedad: e.target.value }))}
                placeholder="Ej: llegó con la caja húmeda…" />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal certificado individual */}
      {certIndModal && (
        <CertificadoIndividualModal
          traslado={certIndModal}
          onClose={() => setCertIndModal(null)}
        />
      )}
    </div>
  )
}
