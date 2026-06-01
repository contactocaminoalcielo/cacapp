import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/supabase'
import { petEmoji, today } from '@/lib/utils'
import {
  generarHTMLCremacionGrupal, generarHTMLCompostajeGrupal, generarHTMLIndividual,
  imprimirCertificado, registrarCertificado, marcarEnviadoWA, abrirWhatsApp,
  generarYSubirPDF
} from '@/lib/certificados'
import { enviarWhatsApp, obtenerLineasWA, LINEAS_WHATSAPP } from '@/lib/whatsapp'
import {
  FileText, RefreshCw, CheckCircle2, Printer,
  MessageCircle, ChevronDown, ChevronUp, Award,
  Flame, Leaf, Send, AlertTriangle
} from 'lucide-react'

function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

const TIPO_CFG = {
  CREMACION_GRUPAL:      { label: 'Cremación Grupal',      emoji: '🔥', color: '#B45309', bg: '#FEF3C7' },
  COMPOSTAJE_GRUPAL:     { label: 'Compostaje Grupal',     emoji: '🌿', color: '#065F46', bg: '#D1FAE5' },
  CREMACION_INDIVIDUAL:  { label: 'Cremación Individual',  emoji: '🔥', color: '#7C3AED', bg: '#EDE9FE' },
  COMPOSTAJE_INDIVIDUAL: { label: 'Compostaje Individual', emoji: '🌿', color: '#0369A1', bg: '#E0F2FE' },
}

// ─── Fila de cliente (para envío individual dentro de un lote) ────────────────
function FilaCliente({ svc, onEnviarWA, saving }) {
  const yaEnviado = svc.cert?.enviado_whatsapp
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white hover:bg-gray-50 transition-colors"
      style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
      <span className="text-lg flex-shrink-0">{petEmoji(svc.especie)}</span>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-semibold text-gray-900">{svc.mascota}</span>
        <span className="text-[11px] text-gray-500 ml-2">{svc.cliente}</span>
        {svc.peso_kg && <span className="text-[10px] text-gray-400 ml-1">· {svc.peso_kg} kg</span>}
      </div>
      {svc.whatsapp ? (
        <button
          onClick={() => onEnviarWA(svc)}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
            yaEnviado
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20'
          }`}
        >
          <MessageCircle size={12} />
          {yaEnviado ? `Reenviado ${fmtFecha(svc.cert.fecha_envio_wa?.split('T')[0])}` : 'Enviar WA'}
        </button>
      ) : (
        <span className="text-[10px] text-gray-300 px-2">Sin WhatsApp</span>
      )}
    </div>
  )
}

// ─── Tarjeta de lote grupal ───────────────────────────────────────────────────
function TarjetaLote({ lote, servicios, onGenerarReporte, onEnviarWA, onEnviarTodos, saving }) {
  const [open, setOpen]       = useState(true)
  const cfg                   = TIPO_CFG[lote.tipo_proceso] || TIPO_CFG.CREMACION_GRUPAL
  const enviados              = servicios.filter(s => s.cert?.enviado_whatsapp).length
  const conWA                 = servicios.filter(s => s.whatsapp).length
  const todosEnviados         = conWA > 0 && enviados >= conWA
  const reporteGenerado       = servicios.some(s => s.cert)

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden"
      style={{ borderColor: todosEnviados ? 'rgba(22,163,74,0.3)' : 'rgba(30,80,40,0.12)' }}>

      {/* Cabecera */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ background: cfg.bg }}>
          {cfg.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-gray-900">{lote.numero_lote}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
            {todosEnviados && (
              <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 size={9} /> Todos enviados
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {servicios.length} mascota{servicios.length !== 1 ? 's' : ''}
            {' · '}Completado {fmtFecha(lote.fecha_completado)}
            {' · '}
            <span className={todosEnviados ? 'text-green-600 font-medium' : 'text-amber-600'}>
              {enviados}/{conWA} enviado{enviados !== 1 ? 's' : ''} por WA
            </span>
          </p>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" />
               : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-4" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>

          {/* Botones de acción del lote */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={() => onGenerarReporte(lote, servicios)}
              disabled={saving}
              variant={reporteGenerado ? 'secondary' : 'primary'}
            >
              <Printer size={13} />
              {reporteGenerado ? 'Reimprimir reporte' : 'Generar reporte del lote'}
            </Button>
            {conWA > 0 && enviados < conWA && (
              <Button
                onClick={() => onEnviarTodos(lote, servicios)}
                disabled={saving}
                style={{ background: '#25D366', color: 'white' }}
              >
                <Send size={13} />
                Enviar a todos ({conWA - enviados} pendientes)
              </Button>
            )}
            {!reporteGenerado && (
              <span className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                Genera el reporte primero antes de enviar
              </span>
            )}
          </div>

          {/* Lista de propietarios */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              Enviar reporte a cada propietario:
            </p>
            {servicios.map(s => (
              <FilaCliente
                key={s.servicio_id}
                svc={s}
                onEnviarWA={(svc) => onEnviarWA(lote, servicios, svc)}
                saving={saving || !reporteGenerado}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Certificados() {
  const { personalData }        = useAuth()
  const { alert: showAlert }    = useConfirm()

  const [tab, setTab]           = useState('pendientes')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [lineaOrigen, setLineaOrigen] = useState('')
  const [lineasWA,    setLineasWA]    = useState([])

  const [lotesGrupales, setLotesGrupales]   = useState([])
  const [svcsGrupales,  setSvcsGrupales]    = useState({})  // { lote_id: [svcs] }
  const [individuales,  setIndividuales]    = useState([])
  const [historial,     setHistorial]       = useState([])

  // ── Carga ─────────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Lotes completados (sin join a personal — falla en schema cache)
      const { data: lotesRaw } = await db
        .from('lotes_grupales')
        .select('id, numero_lote, tipo_proceso, fecha_completado, fecha_envio, estado, entidad_externa, duracion_proceso, coordinador_id')
        .eq('estado', 'COMPLETADO')
        .order('fecha_completado', { ascending: false })

      // 1b. Coordinadores en query separada
      const coordIds = [...new Set((lotesRaw || []).map(l => l.coordinador_id).filter(Boolean))]
      let coordMap = {}
      if (coordIds.length) {
        const { data: coords } = await db
          .from('personal')
          .select('id, nombre, apellido')
          .in('id', coordIds)
        ;(coords || []).forEach(p => { coordMap[p.id] = p })
      }
      const lotes = (lotesRaw || []).map(l => ({
        ...l,
        personal: coordMap[l.coordinador_id] || null,
      }))

      setLotesGrupales(lotes)
      const loteIds = lotes.map(l => l.id)

      // 2. Servicios con peso y datos completos
      let svcsMap = {}
      if (loteIds.length) {
        const { data: svcs } = await db
          .from('servicios')
          .select('id, lote_id, fecha_ingreso, mascotas(nombre, peso_kg, especie_id, especies(nombre), clientes(nombre, apellido, whatsapp))')
          .in('lote_id', loteIds)

        ;(svcs || []).forEach(s => {
          const m = s.mascotas
          const c = m?.clientes
          const lote = (lotes || []).find(l => l.id === s.lote_id)
          const item = {
            servicio_id:   s.id,
            lote_id:       s.lote_id,
            mascota:       m?.nombre || '-',
            especie:       m?.especies?.nombre || '-',
            peso_kg:       m?.peso_kg,
            cliente:       `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
            whatsapp:      c?.whatsapp || null,
            fecha_ingreso: s.fecha_ingreso,
            tipo:          lote?.tipo_proceso || 'CREMACION_GRUPAL',
            fecha_proceso: lote?.fecha_completado || lote?.fecha_envio,
            cert:          null,
          }
          if (!svcsMap[s.lote_id]) svcsMap[s.lote_id] = []
          svcsMap[s.lote_id].push(item)
        })
      }

      // 3. Individuales procesados
      const { data: traslados } = await db
        .from('traslados_tenjo')
        .select('id, fecha_completado, servicio_id, servicios!inner(id, estado, mascotas(nombre, peso_kg, especie_id, especies(nombre), clientes(nombre, apellido, whatsapp)), planes(nombre, tipo_proceso))')
        .eq('estado', 'COMPLETADO')
        .order('fecha_completado', { ascending: false })

      const indItems = (traslados || [])
        .filter(t => {
          const tipo = t.servicios?.planes?.tipo_proceso
          const est  = t.servicios?.estado
          return (tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL')
            && ['EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO'].includes(est)
        })
        .map(t => {
          const svc = t.servicios
          const m   = svc?.mascotas
          const c   = m?.clientes
          return {
            servicio_id:   svc?.id,
            traslado_id:   t.id,
            traslado:      t,
            tipo:          svc?.planes?.tipo_proceso,
            mascota:       m?.nombre || '-',
            especie:       m?.especies?.nombre || '-',
            peso_kg:       m?.peso_kg,
            cliente:       `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
            whatsapp:      c?.whatsapp || null,
            fecha_proceso: t.fecha_completado,
            cert:          null,
          }
        })

      // 4. Enriquecer con certificados emitidos
      const todosIds = [
        ...Object.values(svcsMap).flat().map(s => s.servicio_id),
        ...indItems.map(i => i.servicio_id),
      ].filter(Boolean)

      let certMap = {}
      if (todosIds.length) {
        const { data: certs } = await db
          .from('certificados_emitidos')
          .select('*')
          .in('servicio_id', todosIds)
          .order('created_at', { ascending: false })

        ;(certs || []).forEach(c => {
          if (!certMap[c.servicio_id]) certMap[c.servicio_id] = c
        })

        setHistorial((certs || []).map(c => ({
          ...c,
          _svc: Object.values(svcsMap).flat().find(s => s.servicio_id === c.servicio_id)
             || indItems.find(i => i.servicio_id === c.servicio_id),
          _lote: (lotes || []).find(l => l.id === c.lote_id),
        })))
      } else {
        setHistorial([])
      }

      Object.keys(svcsMap).forEach(lid => {
        svcsMap[lid] = svcsMap[lid].map(s => ({ ...s, cert: certMap[s.servicio_id] || null }))
      })
      setSvcsGrupales(svcsMap)
      setIndividuales(indItems.map(i => ({ ...i, cert: certMap[i.servicio_id] || null })))

    } catch (e) {
      console.error('Error cargando certificados:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Cargar líneas WhatsApp desde GHL ──────────────────────────────────────────
  useEffect(() => {
    obtenerLineasWA()
      .then(lines => {
        setLineasWA(lines)
        if (lines.length) setLineaOrigen(lines[0].numero)
      })
      .catch(() => {
        setLineasWA(LINEAS_WHATSAPP)
        setLineaOrigen(LINEAS_WHATSAPP[0].numero)
      })
  }, [])

  // ── Generar reporte grupal (un documento para todo el lote) ───────────────────
  async function handleGenerarReporte(lote, servicios) {
    setSaving(true)
    try {
      const coordinador = lote.personal || null
      let html

      if (lote.tipo_proceso === 'CREMACION_GRUPAL') {
        html = generarHTMLCremacionGrupal({ lote, servicios, coordinador })
      } else {
        html = generarHTMLCompostajeGrupal({ lote, servicios, coordinador })
      }

      imprimirCertificado(html)

      // Registrar en DB por cada servicio que no tenga cert aún
      const sinCert = servicios.filter(s => !s.cert)
      for (const svc of sinCert) {
        await registrarCertificado({
          servicioId:  svc.servicio_id,
          tipo:        lote.tipo_proceso,
          loteId:      lote.id,
          generadoPor: personalData?.id || null,
        })
      }
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al generar reporte' })
    } finally {
      setSaving(false)
    }
  }

  // ── Generar HTML del lote ─────────────────────────────────────────────────────
  function generarHTMLLote(lote, servicios) {
    const coordinador = lote.personal || null
    return lote.tipo_proceso === 'CREMACION_GRUPAL'
      ? generarHTMLCremacionGrupal({ lote, servicios, coordinador })
      : generarHTMLCompostajeGrupal({ lote, servicios, coordinador })
  }

  // ── Enviar WA a un propietario específico ────────────────────────────────────
  async function handleEnviarWA(lote, servicios, svc) {
    if (!svc.whatsapp) return
    setSaving(true)
    try {
      const html = generarHTMLLote(lote, servicios)
      const cfg  = TIPO_CFG[lote.tipo_proceso] || {}

      // Generar PDF y subir a Supabase Storage
      const pdfUrl = await generarYSubirPDF(html, `${lote.numero_lote}`)

      const mensaje = `Hola ${svc.cliente.split(' ')[0]}, le compartimos el ${cfg.label?.toLowerCase() || 'reporte'} de *${svc.mascota}*. Este documento certifica el proceso realizado con nuestros más altos estándares. — Camino al Cielo 🕊️`
      await enviarWhatsApp({ telefono: svc.whatsapp, nombre: svc.cliente, mensaje, pdfUrl, fromNumber: lineaOrigen })

      // Registrar en DB
      let certId = svc.cert?.id
      if (!certId) {
        certId = await registrarCertificado({
          servicioId:  svc.servicio_id,
          tipo:        lote.tipo_proceso,
          loteId:      lote.id,
          generadoPor: personalData?.id || null,
        })
      }
      if (certId) await marcarEnviadoWA(certId)
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al enviar WhatsApp' })
    } finally {
      setSaving(false)
    }
  }

  // ── Enviar a todos los pendientes de un lote ──────────────────────────────────
  async function handleEnviarTodos(lote, servicios) {
    const pendientes = servicios.filter(s => s.whatsapp && !s.cert?.enviado_whatsapp)
    if (!pendientes.length) return
    setSaving(true)

    const cfg = TIPO_CFG[lote.tipo_proceso] || {}
    let enviados = 0
    let errores  = []

    try {
      const html = generarHTMLLote(lote, servicios)

      // Generar el PDF UNA sola vez para todo el lote
      const pdfUrl = await generarYSubirPDF(html, lote.numero_lote)

      // Enviar a cada propietario
      for (const svc of pendientes) {
        try {
          const mensaje = `Hola ${svc.cliente.split(' ')[0]}, le compartimos el ${cfg.label?.toLowerCase() || 'reporte'} de *${svc.mascota}*. Este documento certifica el proceso realizado con nuestros más altos estándares. — Camino al Cielo 🕊️`
          await enviarWhatsApp({ telefono: svc.whatsapp, nombre: svc.cliente, mensaje, pdfUrl, fromNumber: lineaOrigen })

          let certId = svc.cert?.id
          if (!certId) {
            certId = await registrarCertificado({
              servicioId:  svc.servicio_id,
              tipo:        lote.tipo_proceso,
              loteId:      lote.id,
              generadoPor: personalData?.id || null,
            })
          }
          if (certId) await marcarEnviadoWA(certId)
          enviados++
        } catch (err) {
          errores.push(`${svc.mascota} (${svc.whatsapp}): ${err.message}`)
        }
      }

      await cargar()

      if (errores.length) {
        await showAlert(
          `${enviados} enviados correctamente.\n\nErrores:\n${errores.join('\n')}`,
          { title: `Envío parcial`, variant: 'warning' }
        )
      }
    } catch (e) {
      await showAlert(e.message, { title: 'Error al enviar' })
    } finally {
      setSaving(false)
    }
  }

  // ── Generar certificado individual ────────────────────────────────────────────
  async function handleGenerarIndividual(item) {
    setSaving(true)
    try {
      const html = generarHTMLIndividual({ traslado: item.traslado })
      imprimirCertificado(html)

      if (!item.cert) {
        await registrarCertificado({
          servicioId:  item.servicio_id,
          tipo:        item.tipo,
          generadoPor: personalData?.id || null,
        })
      }
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al generar' })
    } finally {
      setSaving(false)
    }
  }

  async function handleEnviarWAIndividual(item) {
    if (!item.whatsapp) return
    setSaving(true)
    try {
      const html   = generarHTMLIndividual({ traslado: item.traslado })
      const cfg    = TIPO_CFG[item.tipo] || {}
      const pdfUrl = await generarYSubirPDF(html, `cert_individual_${item.mascota}`)

      const mensaje = `Hola ${item.cliente.split(' ')[0]}, le compartimos el certificado de ${cfg.label?.toLowerCase() || 'proceso individual'} de *${item.mascota}*. — Camino al Cielo 🕊️`
      await enviarWhatsApp({ telefono: item.whatsapp, nombre: item.cliente, mensaje, pdfUrl, fromNumber: lineaOrigen })

      let certId = item.cert?.id
      if (!certId) {
        certId = await registrarCertificado({
          servicioId:  item.servicio_id,
          tipo:        item.tipo,
          generadoPor: personalData?.id || null,
        })
      }
      if (certId) await marcarEnviadoWA(certId)
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'Error al enviar' })
    } finally {
      setSaving(false)
    }
  }

  // ── Contadores ─────────────────────────────────────────────────────────────────
  const pendGrupales = Object.values(svcsGrupales).flat()
    .filter(s => s.whatsapp && !s.cert?.enviado_whatsapp).length
  const pendInd = individuales.filter(i => !i.cert?.enviado_whatsapp).length
  const totalPend = pendGrupales + pendInd

  const TABS = [
    { id: 'pendientes', label: 'Pendientes',  badge: totalPend, dot: totalPend > 0 },
    { id: 'historial',  label: 'Historial',   badge: historial.length },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">

        {/* Selector de línea WhatsApp */}
        <div className="rounded-xl p-4 border flex items-center gap-4 flex-wrap"
          style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <MessageCircle size={16} className="text-green-600" />
            <span className="text-[12px] font-semibold text-green-800">Línea de envío:</span>
          </div>
          {lineasWA.map(l => (
            <button
              key={l.numero}
              onClick={() => setLineaOrigen(l.numero)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border"
              style={{
                background:   lineaOrigen === l.numero ? '#16A34A' : 'white',
                color:        lineaOrigen === l.numero ? 'white'   : '#374151',
                borderColor:  lineaOrigen === l.numero ? '#16A34A' : '#D1D5DB',
              }}
            >
              {lineaOrigen === l.numero && <CheckCircle2 size={12} />}
              {l.label}
            </button>
          ))}
          <span className="text-[11px] text-green-700 ml-auto">
            Los mensajes saldrán desde la línea seleccionada según historial del cliente en Zolutium.
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: tab === t.id ? 'white' : 'transparent',
                color:      tab === t.id ? '#111827' : '#6B7280',
                boxShadow:  tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {t.dot && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
              {t.label}
              {t.badge > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: tab === t.id ? '#1A5CD8' : '#9CA3AF', color: 'white', minWidth: 18, textAlign: 'center' }}>
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

        {loading && <div className="text-center py-12 text-gray-400">Cargando...</div>}

        {/* ── TAB: PENDIENTES ─────────────────────────────────────────────────── */}
        {!loading && tab === 'pendientes' && (
          <div className="space-y-6">

            {/* Lotes grupales */}
            {lotesGrupales.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Flame size={12} /> Reportes grupales
                </h3>
                {lotesGrupales.map(lote => (
                  <TarjetaLote
                    key={lote.id}
                    lote={lote}
                    servicios={svcsGrupales[lote.id] || []}
                    onGenerarReporte={handleGenerarReporte}
                    onEnviarWA={handleEnviarWA}
                    onEnviarTodos={handleEnviarTodos}
                    saving={saving}
                  />
                ))}
              </div>
            )}

            {/* Individuales */}
            {individuales.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Award size={12} /> Certificados individuales
                </h3>
                <div className="space-y-2">
                  {individuales.map(item => {
                    const cfg = TIPO_CFG[item.tipo] || {}
                    const yaEnviado = item.cert?.enviado_whatsapp
                    return (
                      <div key={item.servicio_id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white hover:bg-gray-50 transition-colors"
                        style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <span className="text-xl">{petEmoji(item.especie)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-gray-900">{item.mascota}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                            {yaEnviado && (
                              <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 size={9} /> Enviado
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {item.cliente}
                            {item.whatsapp && <span className="text-gray-400"> · {item.whatsapp}</span>}
                          </p>
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

            {lotesGrupales.length === 0 && individuales.length === 0 && (
              <div className="rounded-2xl border border-dashed p-12 text-center"
                style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                <CheckCircle2 size={36} className="mx-auto mb-3 text-green-500" />
                <p className="font-semibold text-gray-700">Sin certificados pendientes</p>
                <p className="text-[12px] text-gray-400 mt-1">Los reportes aparecerán aquí cuando los lotes estén completados.</p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: HISTORIAL ──────────────────────────────────────────────────── */}
        {!loading && tab === 'historial' && (
          historial.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
              <FileText size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-[13px] text-gray-500">Aún no se han generado certificados.</p>
            </div>
          ) : (
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden"
              style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <table className="w-full text-[12px]">
                <thead className="bg-gray-50 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <tr>
                    {['Mascota','Cliente','Tipo','Emitido','WhatsApp'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historial.map((c, i) => {
                    const svc  = c._svc
                    const cfg  = TIPO_CFG[c.tipo] || {}
                    return (
                      <tr key={c.id} className="border-b hover:bg-gray-50 transition-colors"
                        style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{petEmoji(svc?.especie)}</span>
                            <span className="font-semibold text-gray-900">{svc?.mascota || '-'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{svc?.cliente || '-'}</td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: cfg.bg, color: cfg.color }}>
                            {cfg.emoji} {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{fmtFecha(c.fecha_emision)}</td>
                        <td className="px-4 py-3">
                          {c.enviado_whatsapp
                            ? <span className="flex items-center gap-1 text-green-700 font-medium text-[11px]">
                                <CheckCircle2 size={11} /> {fmtFecha(c.fecha_envio_wa?.split('T')[0])}
                              </span>
                            : <span className="text-gray-400 text-[11px]">Pendiente</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
