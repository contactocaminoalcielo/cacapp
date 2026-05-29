import { useState, useEffect, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { addDiasHabiles, petEmoji, today } from '@/lib/utils'
import {
  PackageOpen, Send, FileText, RefreshCw, Plus,
  CheckCircle2, Clock, Archive, AlertTriangle, Printer,
  Flame, Leaf, Users, ChevronDown, ChevronUp, X
} from 'lucide-react'

// ─── Constantes ────────────────────────────────────────────────────────────────
const CAPACIDAD_MAX = 20          // Capacidad estimada total cuarto frío
const ALERTA_PCT   = 90           // % para mostrar alerta de lote

const TIPO_CFG = {
  CREMACION_GRUPAL:  { label: 'Cremación Grupal',  color: '#B45309', bg: '#FEF3C7', border: '#FCD34D', Icon: Flame,  emoji: '🔥' },
  COMPOSTAJE_GRUPAL: { label: 'Compostaje Grupal', color: '#065F46', bg: '#D1FAE5', border: '#6EE7B7', Icon: Leaf,   emoji: '🌿' },
}

const ESTADO_CFG = {
  ABIERTO:    { label: 'Abierto',    color: '#1D4ED8', bg: '#DBEAFE' },
  ENVIADO:    { label: 'Enviado',    color: '#B45309', bg: '#FEF3C7' },
  COMPLETADO: { label: 'Completado', color: '#065F46', bg: '#D1FAE5' },
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

function diasDesde(fecha) {
  if (!fecha) return 0
  const diff = Date.now() - new Date(fecha + 'T12:00:00').getTime()
  return Math.floor(diff / 86400000)
}

function generarNumeroLote(count) {
  const anio = new Date().getFullYear()
  return `L-${anio}-${String(count + 1).padStart(3, '0')}`
}

// ─── Gauge de capacidad ────────────────────────────────────────────────────────
function CapacidadGauge({ ocupados, grupalesPendientes }) {
  const pct    = Math.min(Math.round((ocupados / CAPACIDAD_MAX) * 100), 100)
  const alerta = pct >= ALERTA_PCT
  const color  = pct >= ALERTA_PCT ? '#DC2626' : pct >= 70 ? '#D97706' : '#3D5A27'

  return (
    <div className="rounded-2xl border p-4 bg-white shadow-sm" style={{ borderColor: alerta ? '#FCA5A5' : 'rgba(30,80,40,0.12)' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ocupación Cuarto Frío</p>
          <p className="text-[22px] font-bold mt-0.5" style={{ color }}>
            {ocupados} <span className="text-[13px] font-medium text-gray-400">/ {CAPACIDAD_MAX} mascotas</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-400">En espera de lote</p>
          <p className="text-[20px] font-bold text-gray-700">{grupalesPendientes}</p>
        </div>
      </div>
      {/* Barra */}
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400">0%</span>
        <span className="text-[11px] font-semibold" style={{ color }}>{pct}%</span>
        <span className="text-[10px] text-gray-400">100%</span>
      </div>
      {alerta && (
        <div className="mt-3 flex items-center gap-1.5 text-red-700 bg-red-50 rounded-lg px-3 py-2 text-[12px]">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span className="font-medium">Cuarto frío al {pct}% — recomendable cerrar el lote pronto</span>
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de servicio ───────────────────────────────────────────────────────
function SvcRow({ svc, accion, accionLabel, accionIcon: AIcon, accionVariant = 'secondary' }) {
  const dias = diasDesde(svc.fecha_ingreso)
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white hover:bg-gray-50 transition-colors"
      style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
      <div className="text-xl flex-shrink-0">{petEmoji(svc.especie)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 truncate">{svc.mascota}</p>
        <p className="text-[11px] text-gray-500 truncate">{svc.cliente}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] text-gray-400">{fmtFecha(svc.fecha_ingreso)}</p>
        <p className="text-[10px]" style={{ color: dias >= 7 ? '#DC2626' : '#6B7280' }}>
          {dias} {dias === 1 ? 'día' : 'días'} en sistema
        </p>
      </div>
      {accion && (
        <Button size="sm" variant={accionVariant} onClick={() => accion(svc)}>
          {AIcon && <AIcon size={12} />} {accionLabel}
        </Button>
      )}
    </div>
  )
}

// ─── Certificado (modal + print) ────────────────────────────────────────────────
function CertificadoModal({ servicio, lote, onClose }) {
  const esEco   = lote.tipo_proceso === 'COMPOSTAJE_GRUPAL'
  const tipoCert = esEco ? 'COMPOSTAJE GRUPAL' : 'CREMACIÓN GRUPAL'
  const certFecha = addDiasHabiles(servicio.fecha_ingreso, 3)
  const cliente   = servicio.cliente   || '-'
  const mascota   = servicio.mascota   || '-'
  const especie   = servicio.especie   || '-'

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
                 border-bottom: 2.5px solid #3D5A27; }
    .logo-name  { font-size: 22px; font-weight: bold; color: #3D5A27; letter-spacing: 1.5px; }
    .logo-sub   { font-size: 11px; color: #777; margin-top: 5px; letter-spacing: 0.5px; }
    .cert-title { font-size: 16px; font-weight: bold; text-align: center; letter-spacing: 3px;
                  color: #263218; text-transform: uppercase; margin: 24px 0; }
    .intro-text { font-size: 13px; line-height: 1.9; color: #333; margin-bottom: 20px; text-align: justify; }
    .pet-box    { background: #f5f8f2; border-left: 4px solid #3D5A27; padding: 14px 18px;
                  border-radius: 4px; margin: 18px 0; }
    .pet-box h3 { font-size: 11px; font-weight: bold; color: #3D5A27; letter-spacing: 1px;
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
    .nota-box   { background: #FFF8E7; border: 1px solid #FCD34D; border-radius: 4px;
                  padding: 10px 14px; margin: 18px 0; font-size: 11px; color: #92400E; }
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
    <strong>${tipoCert.toLowerCase()}</strong> por entidad autorizada en la ciudad de Bogotá, Colombia,
    en el marco del lote <strong>${lote.numero_lote}</strong>.
  </p>

  <div class="pet-box">
    <h3>Información de la Mascota</h3>
    <table class="pet-table">
      <tr><td>Nombre:</td><td><strong>${mascota}</strong></td></tr>
      <tr><td>Especie:</td><td>${especie}</td></tr>
      <tr><td>Propietario(s):</td><td>${cliente}</td></tr>
      <tr><td>Fecha de ingreso:</td><td>${fmtFecha(servicio.fecha_ingreso)}</td></tr>
      <tr><td>Número de lote:</td><td><strong>${lote.numero_lote}</strong></td></tr>
      <tr><td>Fecha del proceso:</td><td>${fmtFecha(lote.fecha_envio || today())}</td></tr>
      <tr><td>Fecha de certificado:</td><td>${fmtFecha(certFecha)}</td></tr>
    </table>
  </div>

  ${esEco ? `
  <p class="process-text">
    El proceso de <strong>compostaje ecológico grupal</strong> consiste en la disposición respetuosa
    del cuerpo de la mascota mediante técnicas de biotransformación que lo convierten en materia orgánica
    enriquecida, contribuyendo al medio ambiente de manera sostenible. Este proceso fue realizado por
    entidad técnicamente certificada y habilitada en el municipio de Bogotá, conforme a la normativa
    ambiental colombiana vigente.
  </p>
  <div class="nota-box">
    <strong>Nota importante:</strong> En el plan Eco-grupal, el material procesado no es devuelto al
    propietario. La mascota recibe una disposición ecológica digna y respetuosa.
  </div>
  ` : `
  <p class="process-text">
    El proceso de <strong>cremación grupal</strong> fue realizado de manera digna y respetuosa,
    bajo estrictos estándares de manejo y disposición de mascotas, por empresa autorizada
    en la ciudad de Bogotá. El proceso cumple con las disposiciones legales colombianas
    aplicables al manejo de animales de compañía fallecidos.
  </p>
  <div class="nota-box">
    <strong>Nota importante:</strong> En el plan de cremación grupal, las cenizas no son devueltas
    al propietario. Su mascota recibe un proceso digno y respetuoso.
  </div>
  `}

  <div class="sigs">
    <div class="sig-box">
      <div class="sig-line">Camino al Cielo</div>
      <div class="sig-sub">Dirección Operativa</div>
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
        {/* Preview compacta */}
        <div className="rounded-xl border p-5 bg-gray-50 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
          <div className="text-center pb-3 border-b" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
            <p className="font-bold text-[13px]" style={{ color: '#3D5A27' }}>🕊️ CAMINO AL CIELO</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Servicios Funerarios para Mascotas</p>
          </div>
          <p className="text-center font-bold uppercase tracking-widest text-[11px]" style={{ color: '#263218' }}>
            Certificado de {tipoCert}
          </p>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {[
              ['Mascota', mascota], ['Especie', especie],
              ['Propietario', cliente], ['Ingreso', fmtFecha(servicio.fecha_ingreso)],
              ['Lote', lote.numero_lote], ['Fecha proceso', fmtFecha(lote.fecha_envio || today())],
              ['Fecha certificado (3er día hábil)', fmtFecha(certFecha), true],
            ].map(([k, v, span]) => (
              <div key={k} className={span ? 'col-span-2' : ''}>
                <span className="text-gray-400">{k}: </span>
                <span className="font-medium text-gray-800">{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: '#FFF8E7', border: '1px solid #FCD34D', color: '#92400E' }}>
            {esEco
              ? 'Sin devolución de material procesado — proceso ecológico grupal'
              : 'Sin devolución de cenizas — cremación grupal'}
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

// ─── Lote card (historial) ─────────────────────────────────────────────────────
function LoteCard({ lote, servicios, onCert, onCompletar }) {
  const [open, setOpen]   = useState(false)
  const cfg   = TIPO_CFG[lote.tipo_proceso]  || TIPO_CFG.CREMACION_GRUPAL
  const eCfg  = ESTADO_CFG[lote.estado]      || {}

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
      <button
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          {cfg.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-900">{lote.numero_lote}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: eCfg.bg, color: eCfg.color }}>{eCfg.label}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {cfg.label} · {lote.cantidad_mascotas ?? servicios?.length ?? 0} mascotas
            {lote.fecha_envio && ` · Enviado ${fmtFecha(lote.fecha_envio)}`}
          </p>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" />
               : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-4 border-t space-y-2" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          {onCompletar && (
            <button
              onClick={e => { e.stopPropagation(); onCompletar() }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-[12px] transition-all hover:opacity-90 mb-1"
              style={{ background: '#D1FAE5', color: '#065F46', border: '1.5px solid #6EE7B7' }}>
              <CheckCircle2 size={14} /> Proceso completado — pasar a EN PRODUCCIÓN
            </button>
          )}
          {servicios?.length ? servicios.map(s => (
            <SvcRow
              key={s.servicio_id}
              svc={s}
              accion={() => onCert(s, lote)}
              accionLabel="Certificado"
              accionIcon={FileText}
            />
          )) : (
            <p className="text-[12px] text-gray-400 py-3 text-center">Sin servicios cargados</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────
export default function LotesGrupales() {
  const { personalData } = useAuth()
  const [tab, setTab]   = useState('pendientes')

  // Datos
  const [pendientes,  setPendientes]  = useState([])   // sin lote, en sistema
  const [loteActivo,  setLoteActivo]  = useState(null) // estado ABIERTO
  const [svcsActivo,  setSvcsActivo]  = useState([])   // servicios del lote activo
  const [historial,   setHistorial]   = useState([])   // lotes cerrados
  const [svcsHist,    setSvcsHist]    = useState({})   // { lote_id: [...] }
  const [capacidad,   setCapacidad]   = useState({ ocupados: 0 })
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)

  // UI state
  const [certModal,       setCertModal]       = useState(null)   // { servicio, lote }
  const [obsModal,        setObsModal]        = useState(false)  // obs al cerrar lote
  const [obsText,         setObsText]         = useState('')
  const [lotesPendCount,  setLotesPendCount]  = useState(0)      // para generar número

  const esCoord = ['COORDINADOR', 'ADMIN'].includes(personalData?.rol)

  // ── Carga de datos ──────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Capacidad cuarto frío
      const { count: ocupados } = await db
        .from('cuarto_frio')
        .select('id', { count: 'exact', head: true })
        .is('fecha_salida', null)
      setCapacidad({ ocupados: ocupados ?? 0 })

      // 2. Todos los servicios grupales via v_kanban (con lote_id de servicios)
      const { data: vk } = await db
        .from('v_kanban')
        .select('servicio_id,mascota,especie,cliente,cliente_wa,fecha_ingreso,estado,tipo_proceso,plan,codigo_plan')
        .in('tipo_proceso', ['CREMACION_GRUPAL', 'COMPOSTAJE_GRUPAL'])
        .not('estado', 'in', '(CANCELADO,ENTREGADO)')
        .order('fecha_ingreso', { ascending: true })

      // 3. lote_id de esos servicios
      const ids = (vk || []).map(s => s.servicio_id)
      let loteMap = {}
      if (ids.length) {
        const { data: svcs } = await db
          .from('servicios')
          .select('id, lote_id')
          .in('id', ids)
        ;(svcs || []).forEach(s => { loteMap[s.id] = s.lote_id })
      }

      const todos = (vk || []).map(s => ({ ...s, lote_id: loteMap[s.servicio_id] || null }))
      setPendientes(todos.filter(s => !s.lote_id))

      // 4. Lote activo (ABIERTO)
      const { data: la } = await db
        .from('lotes_grupales')
        .select('*')
        .eq('estado', 'ABIERTO')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      setLoteActivo(la || null)

      if (la) {
        const svcsA = todos.filter(s => s.lote_id === la.id)
        setSvcsActivo(svcsA)
        // Actualizar tab si hay activo
        setTab(t => t === 'pendientes' && svcsA.length ? 'activo' : t)
      } else {
        setSvcsActivo([])
      }

      // 5. Historial de lotes (no abierto)
      const { data: hist } = await db
        .from('lotes_grupales')
        .select('*')
        .not('estado', 'eq', 'ABIERTO')
        .order('created_at', { ascending: false })
        .limit(30)

      setHistorial(hist || [])

      // 6. Servicios de historial
      const histMap = {}
      if (hist?.length) {
        const histIds = hist.map(l => l.id)
        const svcsH = todos.filter(s => s.lote_id && histIds.includes(s.lote_id))
        svcsH.forEach(s => {
          if (!histMap[s.lote_id]) histMap[s.lote_id] = []
          histMap[s.lote_id].push(s)
        })
      }
      setSvcsHist(histMap)

      // 7. Count total lotes para numerar
      const { count: total } = await db
        .from('lotes_grupales')
        .select('id', { count: 'exact', head: true })
      setLotesPendCount(total ?? 0)

    } catch (e) {
      console.error('Error cargando lotes:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Agrupar pendientes por tipo ─────────────────────────────────────────────
  const pendCremacion  = pendientes.filter(s => s.tipo_proceso === 'CREMACION_GRUPAL')
  const pendCompostaje = pendientes.filter(s => s.tipo_proceso === 'COMPOSTAJE_GRUPAL')

  // ── Crear lote ──────────────────────────────────────────────────────────────
  async function crearLote(tipo_proceso) {
    if (!esCoord) return
    const grupoSvcs = pendientes.filter(s => s.tipo_proceso === tipo_proceso)
    if (!grupoSvcs.length) return
    setSaving(true)
    try {
      const numero_lote = generarNumeroLote(lotesPendCount)

      const { data: nuevoLote, error } = await db
        .from('lotes_grupales')
        .insert({
          numero_lote,
          tipo_proceso,
          fecha_proceso:       today(),
          estado:              'ABIERTO',
          cantidad_mascotas:   grupoSvcs.length,
          coordinador_id:      personalData?.id || null,
          entidad_externa:     'Entidad certificada Bogotá',
        })
        .select()
        .single()

      if (error) throw error

      // Asignar lote_id a los servicios pendientes de ese tipo
      const svcsIds = grupoSvcs.map(s => s.servicio_id)
      await db.from('servicios')
        .update({ lote_id: nuevoLote.id })
        .in('id', svcsIds)

      await cargar()
      setTab('activo')
    } catch (e) {
      console.error('Error creando lote:', e)
      alert('Error creando lote. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  // ── Cerrar / enviar lote ────────────────────────────────────────────────────
  async function cerrarLote() {
    if (!loteActivo || !esCoord) return
    setSaving(true)
    setObsModal(false)
    try {
      await db.from('lotes_grupales')
        .update({
          estado:      'ENVIADO',
          fecha_envio: today(),
          observaciones: obsText || null,
        })
        .eq('id', loteActivo.id)

      setObsText('')
      await cargar()
      setTab('historial')
    } catch (e) {
      console.error('Error cerrando lote:', e)
      alert('Error cerrando lote. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  // ── Completar lote: marca COMPLETADO y pasa servicios a EN_PRODUCCION ──────
  async function completarLote(loteId) {
    if (!confirm('¿Confirmar que el proceso fue completado y las cenizas están listas?\n\nTodos los servicios de este lote pasarán a EN PRODUCCIÓN.')) return
    try {
      const svcs = svcsHist[loteId] || []
      await db.from('lotes_grupales').update({ estado: 'COMPLETADO' }).eq('id', loteId)
      if (svcs.length > 0) {
        await db.from('servicios')
          .update({ estado: 'EN_PRODUCCION' })
          .in('id', svcs.map(s => s.servicio_id))
      }
      await cargar()
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'pendientes', label: 'En espera',   badge: pendientes.length },
    { id: 'activo',     label: 'Lote activo', badge: loteActivo ? svcsActivo.length : 0, dot: !!loteActivo },
    { id: 'historial',  label: 'Historial',   badge: historial.length },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">

        {/* Gauge capacidad */}
        <CapacidadGauge
          ocupados={capacidad.ocupados}
          grupalesPendientes={pendientes.length}
        />

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: tab === t.id ? 'white' : 'transparent',
                color:      tab === t.id ? '#111827' : '#6B7280',
                boxShadow:  tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {t.dot && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
              {t.label}
              {t.badge > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: tab === t.id ? '#3D5A27' : '#9CA3AF', color: 'white', minWidth: 18, textAlign: 'center' }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
          <button onClick={cargar} disabled={loading}
            className="ml-2 px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ── TAB: Pendientes ───────────────────────────────────────────────── */}
        {tab === 'pendientes' && (
          <div className="space-y-5">
            {loading && (
              <div className="text-center py-10 text-gray-400 text-[13px]">Cargando...</div>
            )}
            {!loading && pendientes.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                <CheckCircle2 size={32} className="mx-auto mb-3 text-green-500" />
                <p className="font-semibold text-gray-700">Sin servicios pendientes de lote</p>
                <p className="text-[12px] text-gray-400 mt-1">Todos los servicios grupales tienen lote asignado.</p>
              </div>
            )}

            {/* Cremación grupal */}
            {pendCremacion.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide"
                      style={{ color: TIPO_CFG.CREMACION_GRUPAL.color }}>
                      🔥 Cremación Grupal — {pendCremacion.length} mascotas
                    </span>
                  </div>
                  {esCoord && !loteActivo && (
                    <Button size="sm" onClick={() => crearLote('CREMACION_GRUPAL')} disabled={saving}>
                      <Plus size={12} /> Crear lote
                    </Button>
                  )}
                  {loteActivo && loteActivo.tipo_proceso === 'CREMACION_GRUPAL' && (
                    <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                      Lote activo abierto
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {pendCremacion.map(s => <SvcRow key={s.servicio_id} svc={s} />)}
                </div>
              </div>
            )}

            {/* Compostaje grupal */}
            {pendCompostaje.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide"
                    style={{ color: TIPO_CFG.COMPOSTAJE_GRUPAL.color }}>
                    🌿 Compostaje Grupal — {pendCompostaje.length} mascotas
                  </span>
                  {esCoord && !loteActivo && (
                    <Button size="sm" onClick={() => crearLote('COMPOSTAJE_GRUPAL')} disabled={saving}>
                      <Plus size={12} /> Crear lote
                    </Button>
                  )}
                  {loteActivo && loteActivo.tipo_proceso === 'COMPOSTAJE_GRUPAL' && (
                    <span className="text-[11px] text-green-700 bg-green-50 px-2 py-1 rounded-lg">
                      Lote activo abierto
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {pendCompostaje.map(s => <SvcRow key={s.servicio_id} svc={s} />)}
                </div>
              </div>
            )}

            {loteActivo && (
              <div className="rounded-xl p-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200">
                <strong>Hay un lote activo ({loteActivo.numero_lote}).</strong>{' '}
                Para crear uno nuevo de otro tipo, primero cierra el activo desde la pestaña "Lote activo".
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Lote activo ──────────────────────────────────────────────── */}
        {tab === 'activo' && (
          <div className="space-y-4">
            {!loteActivo ? (
              <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                <PackageOpen size={32} className="mx-auto mb-3 text-gray-300" />
                <p className="font-semibold text-gray-600">No hay lote activo</p>
                <p className="text-[12px] text-gray-400 mt-1">
                  Ve a <strong>"En espera"</strong> y crea un nuevo lote cuando el cuarto frío esté próximo a su capacidad.
                </p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => setTab('pendientes')}>
                  Ver pendientes
                </Button>
              </div>
            ) : (
              <>
                {/* Header del lote activo */}
                <div className="rounded-2xl border p-5 bg-white shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{TIPO_CFG[loteActivo.tipo_proceso]?.emoji}</span>
                        <h2 className="text-[16px] font-bold text-gray-900">{loteActivo.numero_lote}</h2>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: ESTADO_CFG.ABIERTO.bg, color: ESTADO_CFG.ABIERTO.color }}>
                          Abierto
                        </span>
                      </div>
                      <p className="text-[12px] text-gray-500">
                        {TIPO_CFG[loteActivo.tipo_proceso]?.label} · {svcsActivo.length} mascotas asignadas
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Creado {fmtFecha(loteActivo.fecha_proceso)} · {loteActivo.entidad_externa}
                      </p>
                    </div>
                    {esCoord && (
                      <Button
                        variant="gold"
                        onClick={() => setObsModal(true)}
                        disabled={saving}
                        className="flex-shrink-0"
                      >
                        <Send size={13} /> Cerrar y enviar
                      </Button>
                    )}
                  </div>
                </div>

                {/* Lista de mascotas en el lote */}
                <div className="space-y-2">
                  {svcsActivo.length === 0 ? (
                    <p className="text-[12px] text-gray-400 text-center py-4">Sin mascotas asignadas al lote.</p>
                  ) : (
                    svcsActivo.map(s => <SvcRow key={s.servicio_id} svc={s} />)
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: Historial ────────────────────────────────────────────────── */}
        {tab === 'historial' && (
          <div className="space-y-3">
            {loading && <div className="text-center py-8 text-gray-400 text-[13px]">Cargando...</div>}
            {!loading && historial.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                <Archive size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-[13px] text-gray-500">Sin lotes cerrados aún</p>
              </div>
            )}
            {historial.map(lote => (
              <LoteCard
                key={lote.id}
                lote={lote}
                servicios={svcsHist[lote.id] || []}
                onCert={(svc, lt) => setCertModal({ servicio: svc, lote: lt })}
                onCompletar={lote.estado === 'ENVIADO' && esCoord ? () => completarLote(lote.id) : null}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modal: observaciones al cerrar ─────────────────────────────────── */}
      {obsModal && (
        <Modal open onClose={() => setObsModal(false)} title="Cerrar lote y enviar a entidad">
          <div className="space-y-4">
            <div className="rounded-xl p-4 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              <p className="font-semibold mb-1">¿Confirmar cierre del lote <strong>{loteActivo?.numero_lote}</strong>?</p>
              <p>Se registrará la fecha de envío como <strong>hoy ({fmtFecha(today())})</strong>.</p>
              <p className="mt-1">Podrás generar los certificados desde la pestaña Historial.</p>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">Observaciones (opcional)</label>
              <Textarea
                value={obsText}
                onChange={e => setObsText(e.target.value)}
                placeholder="Ej: Recibido por Juan en la entidad, con guía N° 12345..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setObsModal(false)}>Cancelar</Button>
              <Button variant="gold" onClick={cerrarLote} disabled={saving}>
                <Send size={13} /> {saving ? 'Guardando...' : 'Confirmar envío'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: Certificado ─────────────────────────────────────────────── */}
      {certModal && (
        <CertificadoModal
          servicio={certModal.servicio}
          lote={certModal.lote}
          onClose={() => setCertModal(null)}
        />
      )}
    </div>
  )
}
