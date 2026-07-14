import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, fmtDateTime } from '@/lib/utils'
import {
  generarHTMLIndividual, imprimirCertificado, registrarCertificado,
  marcarEnviadoWA, generarYSubirPDF,
} from '@/lib/certificados'
import {
  obtenerReportes, generarReporte, enviarReporte, sincronizar, resumenIA,
  ESTADO_ITEM, ESTADO_REPORTE,
} from '@/lib/reportesGrupales'
import { enviarWhatsApp, obtenerLineasWA, LINEAS_WHATSAPP } from '@/lib/whatsapp'
import ControlGrupal from '@/components/ControlGrupal'
import LotesTab from '@/components/LotesTab'
import {
  FileText, RefreshCw, CheckCircle2, Printer, MessageCircle,
  ChevronDown, ChevronUp, Award, Flame, Send, AlertTriangle, Clock, XCircle, Sparkles,
} from 'lucide-react'

function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TIPO_CFG = {
  CREMACION_GRUPAL:      { label: 'Cremación Grupal',      emoji: '🔥', color: '#B45309', bg: '#FEF3C7' },
  COMPOSTAJE_GRUPAL:     { label: 'Compostaje Grupal',     emoji: '🌿', color: '#065F46', bg: '#D1FAE5' },
  CREMACION_INDIVIDUAL:  { label: 'Cremación Individual',  emoji: '🔥', color: '#7C3AED', bg: '#EDE9FE' },
  COMPOSTAJE_INDIVIDUAL: { label: 'Compostaje Individual', emoji: '🌿', color: '#0369A1', bg: '#E0F2FE' },
}

// Etiquetas legibles de las validaciones obligatorias
const VALID_LABEL = {
  servicio_valido: 'Servicio válido', nombre_mascota: 'Nombre mascota',
  nombre_propietario: 'Propietario', telefono: 'Teléfono', plan: 'Plan',
  tipo_proceso: 'Tipo de proceso', fecha_base: 'Fecha base', no_cancelado: 'No cancelado',
  corresponde_lote: 'Corresponde al lote',
}

function Pill({ cfg, children }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>
      {children || cfg.label}
    </span>
  )
}

// ─── Fila de destinatario (modelo formal) ────────────────────────────────────
function FilaItem({ item, onEnviar, onReenviar, saving, puedeEnviar }) {
  const cfg = ESTADO_ITEM[item.estado] || ESTADO_ITEM.PENDIENTE
  const fallos = Object.entries(item.validacion || {}).filter(([, ok]) => !ok).map(([k]) => VALID_LABEL[k] || k)
  const yaEnviado = ['ENVIADO', 'REENVIADO'].includes(item.estado)

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold text-gray-900">{item.mascota_nombre}</span>
          <span className="text-[11px] text-gray-500">{item.propietario_nombre}</span>
          <Pill cfg={cfg} />
          {item.fecha_vencimiento && !yaEnviado && (
            <span className="text-[10px] flex items-center gap-1 text-gray-400">
              <Clock size={9} /> vence {fmtFecha(item.fecha_vencimiento)}
            </span>
          )}
        </div>
        {item.estado === 'EXCLUIDO' && item.motivo_exclusion && (
          <p className="text-[10px] text-amber-700 mt-0.5">⚠ {item.motivo_exclusion}</p>
        )}
        {!item.datos_completos && item.estado !== 'EXCLUIDO' && fallos.length > 0 && (
          <p className="text-[10px] text-red-600 mt-0.5">Falta: {fallos.join(', ')}</p>
        )}
        {item.enviado_en && (
          <p className="text-[10px] text-green-600 mt-0.5">Enviado {fmtDateTime(item.enviado_en)}</p>
        )}
      </div>
      {item.estado === 'EXCLUIDO' ? (
        <span className="text-[10px] text-gray-300 px-2">No incluido</span>
      ) : yaEnviado ? (
        <Button size="sm" variant="secondary" disabled={saving || !puedeEnviar} onClick={() => onReenviar(item)}>
          <RefreshCw size={11} /> Reenviar
        </Button>
      ) : (
        <Button size="sm" disabled={saving || !puedeEnviar || !item.datos_completos}
          style={{ background: '#25D366', color: 'white' }} onClick={() => onEnviar(item)}>
          <MessageCircle size={11} /> Enviar
        </Button>
      )}
    </div>
  )
}

// ─── Tarjeta de reporte grupal ───────────────────────────────────────────────
function TarjetaReporte({ reporte, onGenerar, onEnviarTodos, onEnviarUno, onReenviar, saving }) {
  const [open, setOpen] = useState(true)
  const cfg   = TIPO_CFG[reporte.tipo_proceso] || TIPO_CFG.CREMACION_GRUPAL
  const eCfg  = ESTADO_REPORTE[reporte.estado] || ESTADO_REPORTE.PENDIENTE
  const items = (reporte.reportes_grupales_items || []).filter(i => i.estado !== 'EXCLUIDO')
  const excluidos = (reporte.reportes_grupales_items || []).filter(i => i.estado === 'EXCLUIDO')
  const enviables = items.filter(i => i.datos_completos && !['ENVIADO', 'REENVIADO'].includes(i.estado))
  const incompletos = items.filter(i => !i.datos_completos).length
  const vencidos = items.filter(i => i.estado === 'VENCIDO').length
  const conErrores = items.filter(i => i.estado === 'ERROR').length
  const generado = reporte.estado !== 'PENDIENTE'
  const numero = reporte.lotes_grupales?.numero_lote || '—'

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden"
      style={{ borderColor: vencidos ? 'rgba(185,28,28,0.35)' : 'rgba(30,80,40,0.12)' }}>
      <button className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 text-left" onClick={() => setOpen(o => !o)}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: cfg.bg }}>{cfg.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-gray-900">{numero}</span>
            <Pill cfg={cfg} />
            <Pill cfg={eCfg} />
            {vencidos > 0 && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={9} /> {vencidos} vencido{vencidos !== 1 ? 's' : ''}</span>}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {items.length} destinatario{items.length !== 1 ? 's' : ''}
            {' · '}<span className="text-green-600 font-medium">{reporte.enviados}/{items.length} enviados</span>
            {incompletos > 0 && <span className="text-red-600"> · {incompletos} con datos incompletos</span>}
            {conErrores > 0 && <span className="text-red-600"> · {conErrores} con error</span>}
            {reporte.fecha_vencimiento && reporte.estado !== 'ENVIADO' && <span> · vence {fmtFecha(reporte.fecha_vencimiento)}</span>}
          </p>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-4" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={() => onGenerar(reporte)} disabled={saving} variant={generado ? 'secondary' : 'primary'}>
              <Printer size={13} /> {generado ? 'Reimprimir / regenerar' : 'Generar reporte'}
            </Button>
            {enviables.length > 0 && (
              <Button onClick={() => onEnviarTodos(reporte)} disabled={saving} style={{ background: '#25D366', color: 'white' }}>
                <Send size={13} /> Enviar a todos ({enviables.length})
              </Button>
            )}
            {incompletos > 0 && (
              <span className="text-[11px] text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 flex items-center gap-1">
                <XCircle size={12} /> {incompletos} sin datos completos — no se pueden enviar
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Revisar y enviar a cada propietario:</p>
            {items.map(it => (
              <FilaItem key={it.id} item={it} saving={saving} puedeEnviar={generado}
                onEnviar={(item) => onEnviarUno(reporte, item)}
                onReenviar={(item) => onReenviar(reporte, item)} />
            ))}
            {!generado && <p className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">Genera el reporte antes de enviar.</p>}
            {excluidos.length > 0 && (
              <details className="mt-2">
                <summary className="text-[11px] text-gray-400 cursor-pointer">{excluidos.length} excluido(s) del reporte</summary>
                {excluidos.map(it => (
                  <p key={it.id} className="text-[11px] text-gray-500 px-4 py-1">• {it.mascota_nombre} — {it.motivo_exclusion || 'excluido'}</p>
                ))}
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Certificados() {
  const { personalData } = useAuth()
  const { alert: showAlert } = useConfirm()

  const [tab, setTab]           = useState('pendientes')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [lineaOrigen, setLineaOrigen] = useState('')
  const [lineasWA, setLineasWA] = useState([])

  const [reportes, setReportes]       = useState([])
  const [coordMap, setCoordMap]       = useState({})
  const [individuales, setIndividuales] = useState([])
  const [historial, setHistorial]     = useState([])
  const [reenvio, setReenvio]         = useState(null)  // { reporte, item }
  const [motivoReenvio, setMotivoReenvio] = useState('')
  const [iaResumen, setIaResumen]     = useState('')
  const [iaLoading, setIaLoading]     = useState(false)

  // ── Carga ─────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Reportes grupales (modelo formal)
      const reps = await obtenerReportes().catch(e => { console.error(e); return [] })
      setReportes(reps)

      // Coordinadores para el PDF
      const coordIds = [...new Set(reps.map(r => r.lotes_grupales?.coordinador_id).filter(Boolean))]
      let cMap = {}
      if (coordIds.length) {
        const { data: coords } = await db.from('personal').select('id, nombre, apellido').in('id', coordIds)
        ;(coords || []).forEach(p => { cMap[p.id] = p })
      }
      setCoordMap(cMap)

      // 2. Certificados individuales (flujo previo, sin cambios)
      const { data: traslados } = await db
        .from('traslados_tenjo')
        .select('id, fecha_completado, servicio_id, servicios!inner(id, estado, mascotas(nombre, peso_kg, especie_id, especies(nombre), clientes(nombre, apellido, whatsapp)), planes(nombre, tipo_proceso))')
        .eq('estado', 'COMPLETADO')
        .gte('servicios.fecha_ingreso', FECHA_CORTE)
        .order('fecha_completado', { ascending: false })

      const indItems = (traslados || [])
        .filter(t => {
          const tipo = t.servicios?.planes?.tipo_proceso
          const est  = t.servicios?.estado
          return (tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL')
            && ['EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO'].includes(est)
        })
        .map(t => {
          const svc = t.servicios, m = svc?.mascotas, c = m?.clientes
          return {
            servicio_id: svc?.id, traslado: t, tipo: svc?.planes?.tipo_proceso,
            mascota: m?.nombre || '-', especie: m?.especies?.nombre || '-', peso_kg: m?.peso_kg,
            cliente: `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
            whatsapp: c?.whatsapp || null, cert: null,
          }
        })

      // Enriquecer individuales con certificados_emitidos
      const indIds = indItems.map(i => i.servicio_id).filter(Boolean)
      let certMap = {}
      if (indIds.length) {
        const { data: certs } = await db.from('certificados_emitidos').select('*').in('servicio_id', indIds).order('created_at', { ascending: false })
        ;(certs || []).forEach(c => { if (!certMap[c.servicio_id]) certMap[c.servicio_id] = c })
      }
      setIndividuales(indItems.map(i => ({ ...i, cert: certMap[i.servicio_id] || null })))

      // 3. Historial: evidencia de envíos grupales
      const { data: envios } = await db
        .from('reportes_grupales_envios')
        .select('*, reportes_grupales(tipo_proceso, lotes_grupales(numero_lote)), reportes_grupales_items(mascota_nombre, propietario_nombre)')
        .order('created_at', { ascending: false })
        .limit(100)
      setHistorial(envios || [])
    } catch (e) {
      console.error('Error cargando certificados:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    obtenerLineasWA()
      .then(lines => { setLineasWA(lines); if (lines.length) setLineaOrigen(lines[0].numero) })
      .catch(() => { setLineasWA(LINEAS_WHATSAPP); setLineaOrigen(LINEAS_WHATSAPP[0].numero) })
  }, [])

  const coordDe = (reporte) => coordMap[reporte.lotes_grupales?.coordinador_id] || null

  // ── Acciones grupales (escrituras críticas vía backend) ──────────────────────
  async function handleSincronizar() {
    setSaving(true)
    try { await sincronizar(); await cargar() }
    catch (e) { await showAlert(e.message, { title: 'Error al sincronizar' }) }
    finally { setSaving(false) }
  }

  async function handleResumenIA() {
    setIaLoading(true)
    try { const r = await resumenIA(); setIaResumen(r.resumen || '') }
    catch (e) { await showAlert(e.message, { title: 'Error del asistente IA' }) }
    finally { setIaLoading(false) }
  }

  async function handleGenerar(reporte) {
    setSaving(true)
    try {
      const { html } = await generarReporte(reporte, coordDe(reporte))
      imprimirCertificado(html)
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al generar reporte' })
    } finally { setSaving(false) }
  }

  async function handleEnviarTodos(reporte) {
    setSaving(true)
    try {
      const { pdfUrl } = await generarReporte(reporte, coordDe(reporte))
      const r = await enviarReporte(reporte.id, { pdfUrl, fromNumber: lineaOrigen })
      await cargar()
      if (r.errores?.length) {
        await showAlert(`${r.enviados} enviados.\n\nErrores:\n${r.errores.map(e => `${e.mascota}: ${e.error}`).join('\n')}`, { title: 'Envío parcial', variant: 'warning' })
      }
    } catch (e) {
      await showAlert(e.message, { title: 'Error al enviar' })
    } finally { setSaving(false) }
  }

  async function handleEnviarUno(reporte, item) {
    setSaving(true)
    try {
      const { pdfUrl } = await generarReporte(reporte, coordDe(reporte))
      const r = await enviarReporte(reporte.id, { pdfUrl, items: [item.id], fromNumber: lineaOrigen })
      await cargar()
      if (r.errores?.length) await showAlert(r.errores.map(e => `${e.mascota}: ${e.error}`).join('\n'), { title: 'Error al enviar' })
    } catch (e) {
      await showAlert(e.message, { title: 'Error al enviar' })
    } finally { setSaving(false) }
  }

  async function confirmarReenvio() {
    if (!reenvio || !motivoReenvio.trim()) return
    const { reporte, item } = reenvio
    setSaving(true); setReenvio(null)
    try {
      const { pdfUrl } = await generarReporte(reporte, coordDe(reporte))
      await enviarReporte(reporte.id, { pdfUrl, items: [item.id], reenvio: true, motivo: motivoReenvio.trim(), fromNumber: lineaOrigen })
      setMotivoReenvio('')
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al reenviar' })
    } finally { setSaving(false) }
  }

  // ── Acciones individuales (flujo previo) ─────────────────────────────────────
  async function handleGenerarIndividual(item) {
    setSaving(true)
    try {
      const html = generarHTMLIndividual({ traslado: item.traslado })
      imprimirCertificado(html)
      if (!item.cert) await registrarCertificado({ servicioId: item.servicio_id, tipo: item.tipo, generadoPor: personalData?.id || null })
      await cargar()
    } catch (e) { await showAlert(e.message, { title: 'Error al generar' }) }
    finally { setSaving(false) }
  }

  async function handleEnviarWAIndividual(item) {
    if (!item.whatsapp) return
    setSaving(true)
    try {
      const html = generarHTMLIndividual({ traslado: item.traslado })
      const cfg = TIPO_CFG[item.tipo] || {}
      const pdfUrl = await generarYSubirPDF(html, `cert_individual_${item.mascota}`)
      const mensaje = `Hola ${item.cliente.split(' ')[0]}, le compartimos el certificado de ${cfg.label?.toLowerCase() || 'proceso individual'} de *${item.mascota}*. — Camino al Cielo 🕊️`
      await enviarWhatsApp({ telefono: item.whatsapp, nombre: item.cliente, mensaje, pdfUrl, fromNumber: lineaOrigen })
      let certId = item.cert?.id
      if (!certId) certId = await registrarCertificado({ servicioId: item.servicio_id, tipo: item.tipo, generadoPor: personalData?.id || null })
      if (certId) await marcarEnviadoWA(certId)
      await cargar()
    } catch (e) { await showAlert(e.message, { title: 'Error al enviar' }) }
    finally { setSaving(false) }
  }

  // ── Contadores ───────────────────────────────────────────────────────────────
  const pendGrupales = reportes.reduce((acc, r) =>
    acc + (r.reportes_grupales_items || []).filter(i => i.estado !== 'EXCLUIDO' && !['ENVIADO', 'REENVIADO'].includes(i.estado)).length, 0)
  const pendInd = individuales.filter(i => !i.cert?.enviado_whatsapp).length
  const totalPend = pendGrupales + pendInd

  const TABS = [
    { id: 'pendientes', label: 'Pendientes', badge: totalPend, dot: totalPend > 0 },
    { id: 'lotes', label: 'Lotes' },
    { id: 'control', label: 'Control' },
    { id: 'historial', label: 'Historial', badge: historial.length },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">

        {/* Selector de línea WhatsApp */}
        <div className="rounded-xl p-4 border flex items-center gap-4 flex-wrap" style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <MessageCircle size={16} className="text-green-600" />
            <span className="text-[12px] font-semibold text-green-800">Línea de envío:</span>
          </div>
          {lineasWA.map(l => (
            <button key={l.numero} onClick={() => setLineaOrigen(l.numero)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border"
              style={{
                background: lineaOrigen === l.numero ? '#16A34A' : 'white',
                color: lineaOrigen === l.numero ? 'white' : '#374151',
                borderColor: lineaOrigen === l.numero ? '#16A34A' : '#D1D5DB',
              }}>
              {lineaOrigen === l.numero && <CheckCircle2 size={12} />}{l.label}
            </button>
          ))}
          <span className="text-[11px] text-green-700 ml-auto">Los mensajes salen por Zolutium desde la línea seleccionada.</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: tab === t.id ? 'white' : 'transparent',
                color: tab === t.id ? '#111827' : '#6B7280',
                boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {t.dot && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
              {t.label}
              {t.badge > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: tab === t.id ? '#1A5CD8' : '#9CA3AF', color: 'white', minWidth: 18, textAlign: 'center' }}>{t.badge}</span>}
            </button>
          ))}
          <button onClick={handleSincronizar} disabled={saving || loading}
            className="ml-2 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 hover:text-gray-700 hover:bg-white transition-colors flex items-center gap-1">
            <RefreshCw size={12} className={saving ? 'animate-spin' : ''} /> Sincronizar
          </button>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Cargando...</div>}

        {/* ── PENDIENTES ──────────────────────────────────────────────────────── */}
        {!loading && tab === 'pendientes' && (
          <div className="space-y-6">
            {/* Asistente IA: resumen + priorización (solo sugiere) */}
            {reportes.length > 0 && (
              <div className="rounded-xl border p-4" style={{ background: '#F5F3FF', borderColor: '#C4B5FD' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-violet-600" />
                    <span className="text-[12px] font-semibold text-violet-800">Asistente ORBIT — resumen de pendientes</span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={handleResumenIA} disabled={iaLoading}>
                    <Sparkles size={12} className={iaLoading ? 'animate-pulse' : ''} /> {iaLoading ? 'Analizando…' : 'Generar resumen'}
                  </Button>
                </div>
                {iaResumen && (
                  <p className="text-[12px] text-gray-700 mt-3 whitespace-pre-wrap leading-relaxed">{iaResumen}</p>
                )}
                <p className="text-[10px] text-violet-500 mt-2">La IA solo sugiere y prioriza; tú revisas y confirmas cada envío.</p>
              </div>
            )}

            {reportes.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5"><Flame size={12} /> Reportes grupales</h3>
                {reportes.map(r => (
                  <TarjetaReporte key={r.id} reporte={r} saving={saving}
                    onGenerar={handleGenerar} onEnviarTodos={handleEnviarTodos}
                    onEnviarUno={handleEnviarUno} onReenviar={(reporte, item) => setReenvio({ reporte, item })} />
                ))}
              </div>
            )}

            {individuales.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5"><Award size={12} /> Certificados individuales</h3>
                <div className="space-y-2">
                  {individuales.map(item => {
                    const cfg = TIPO_CFG[item.tipo] || {}
                    const yaEnviado = item.cert?.enviado_whatsapp
                    return (
                      <div key={item.servicio_id} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <span className="text-xl">{petEmoji(item.especie)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-gray-900">{item.mascota}</span>
                            <Pill cfg={cfg} />
                            {yaEnviado && <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle2 size={9} /> Enviado</span>}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">{item.cliente}{item.whatsapp && <span className="text-gray-400"> · {item.whatsapp}</span>}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => handleGenerarIndividual(item)} disabled={saving}>
                            <Printer size={12} /> {item.cert ? 'Reimprimir' : 'Generar'}
                          </Button>
                          {item.whatsapp && (
                            <Button size="sm" onClick={() => handleEnviarWAIndividual(item)} disabled={saving}
                              style={yaEnviado ? { background: '#16A34A', color: 'white' } : { background: '#25D366', color: 'white' }}>
                              <MessageCircle size={12} /> {yaEnviado ? 'Reenviar' : 'WA'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {reportes.length === 0 && individuales.length === 0 && (
              <div className="rounded-2xl border border-dashed p-12 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                <CheckCircle2 size={36} className="mx-auto mb-3 text-green-500" />
                <p className="font-semibold text-gray-700">Sin reportes pendientes</p>
                <p className="text-[12px] text-gray-400 mt-1">Los reportes aparecen aquí cuando los lotes están completados. Usa "Sincronizar" si falta alguno.</p>
              </div>
            )}
          </div>
        )}

        {/* ── CONTROL (tabla de servicios elegibles) ──────────────────────────── */}
        {tab === 'lotes' && <LotesTab onChanged={cargar} onGoPendientes={() => setTab('pendientes')} />}
        {tab === 'control' && <ControlGrupal onChanged={cargar} onGoPendientes={() => setTab('pendientes')} />}

        {/* ── HISTORIAL (evidencia de envíos) ─────────────────────────────────── */}
        {!loading && tab === 'historial' && (
          historial.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
              <FileText size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-[13px] text-gray-500">Aún no hay envíos registrados.</p>
            </div>
          ) : (
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <table className="w-full text-[12px]">
                <thead className="bg-gray-50 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <tr>{['Mascota', 'Propietario', 'Lote', 'Estado', 'Evidencia', 'Fecha'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {historial.map(e => (
                    <tr key={e.id} className="border-b hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                      <td className="px-4 py-3 font-semibold text-gray-900">{e.reportes_grupales_items?.mascota_nombre || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{e.reportes_grupales_items?.propietario_nombre || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{e.reportes_grupales?.lotes_grupales?.numero_lote || '-'}</td>
                      <td className="px-4 py-3">
                        {e.estado === 'ENVIADO'
                          ? <span className="flex items-center gap-1 text-green-700 font-medium text-[11px]"><CheckCircle2 size={11} /> {e.es_reenvio ? 'Reenviado' : 'Enviado'}</span>
                          : <span className="flex items-center gap-1 text-red-600 font-medium text-[11px]"><XCircle size={11} /> Error</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-[10px]">{e.message_id ? `msg ${e.message_id.slice(0, 8)}…` : (e.error || '-')}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Modal reenvío (exige motivo — criterio #7) */}
      {reenvio && (
        <Modal open onClose={() => setReenvio(null)} title={`Reenviar a ${reenvio.item.propietario_nombre}`}>
          <div className="space-y-4">
            <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              El reenvío queda auditado. Indica el motivo (obligatorio).
            </div>
            <Textarea value={motivoReenvio} onChange={e => setMotivoReenvio(e.target.value)} rows={2}
              placeholder="Ej: el cliente no recibió el primer mensaje / número corregido…" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReenvio(null)}>Cancelar</Button>
              <Button disabled={!motivoReenvio.trim() || saving} onClick={confirmarReenvio}>
                <RefreshCw size={13} /> Reenviar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
