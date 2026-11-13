// Seguimiento de la ENCUESTA POST-ENTREGA (migr. 206) dentro de /nps.
//
// Pedido de David el 2026-11-13: la encuesta sale sola al día siguiente de la
// entrega, pero en /nps no se veía. Causa: al enviarla, la fila sigue en
// estado PENDIENTE (solo pasa a REALIZADO cuando la familia toca un botón), así
// que quedaba revuelta con las ~1.400 POST_ENTREGA viejas del NPS manual que
// nadie atendió, y ordenadas de la más vieja a la más nueva: las recientes al
// fondo de la lista.
//
// Aquí se mira SOLO lo que maneja la automatización (entregas desde
// `ENCUESTA_ENTREGA.arranque_desde`) como un embudo:
//   entregado → por enviar → enviada (¿le llegó?) → respondió → atendido.
// Cada fila dice en qué paso va y, si se quedó, por qué.
//
// El acuse de Meta (le llegó / leído / no llegó) sale del mismo listado que usa
// /automatizaciones; ese endpoint es solo de COORDINADOR/ADMIN, así que para
// otros roles la columna no aparece y todo lo demás funciona igual.
import { useState, useEffect, useMemo } from 'react'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db, dbTodo } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ESTADO_ENVIO } from '@/lib/whatsappInbox'
import { today, waLink, parseDate, fmtDateTime } from '@/lib/utils'
import { MessageCircle, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { esAliadoVip, VipStar } from '@/components/servicio/VipAliado'

export const SATISFACCION = {
  BUENA:   { label: '😊 Bueno',   cls: 'bg-green-light text-primary-dark border-green-mid' },
  REGULAR: { label: '😐 Regular', cls: 'bg-[#FFF3DC] text-[#9A5500] border-[#FFD980]' },
  MALA:    { label: '☹️ Malo',    cls: 'bg-[#FDECEC] text-[#C03030] border-[#F3B7B7]' },
}

const VENTANAS = [
  { dias: 7,  label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 0,  label: 'Todo' },
]

// El paso del embudo en que va cada fila. El orden de las pestañas es el orden
// en que coordinación las revisa: primero lo que pide acción.
const PESTANAS = [
  { key: 'POR_ATENDER',   label: 'Por atender' },
  { key: 'NO_LLEGO',      label: 'No le llegó' },
  { key: 'SIN_RESPUESTA', label: 'Sin respuesta' },
  { key: 'RESPONDIO',     label: 'Respondieron' },
  { key: 'POR_ENVIAR',    label: 'Por enviar' },
  { key: 'NO_SALIO',      label: 'No se envió' },
  { key: 'todas',         label: 'Todas' },
]

const ROLES_ACUSE = ['COORDINADOR', 'ADMIN']

const limpiar = v => String(v ?? '').trim().replace(/^"|"$/g, '')

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Suma n días a una fecha YYYY-MM-DD sin pasar por UTC. */
function sumarDias(iso, n) {
  const d = parseDate(iso)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * En qué paso va la encuesta de una fila, y la frase que lo explica.
 * Replica las reglas del job (orbit-backend/src/jobs/encuesta-entrega.js):
 * sale desde el día siguiente a la entrega, hasta `dias_max_atraso` días
 * después, máximo 3 intentos, y solo si el servicio sigue ENTREGADO.
 */
function etapaDe(n, acuse, { hoy, atraso, activo }) {
  if (n.satisfaccion) return { key: 'RESPONDIO' }
  if (n.envio_estado === 'ENVIADO') {
    if (acuse?.acuse === 'failed') {
      return { key: 'NO_LLEGO', motivo: acuse.acuse_error || 'Meta reportó que el mensaje no se entregó' }
    }
    return { key: 'SIN_RESPUESTA' }
  }
  if (n.envio_estado === 'ENVIANDO') return { key: 'POR_ENVIAR', motivo: 'Enviándose ahora' }
  if (n.servicios?.estado !== 'ENTREGADO') {
    return { key: 'NO_SALIO', motivo: `El servicio ya no está ENTREGADO (${n.servicios?.estado || '—'})` }
  }
  const vence = sumarDias(n.fecha_programada, atraso)
  if (n.envio_estado === 'ERROR') {
    const definitivo = (n.envio_intentos || 0) >= 3 || hoy > vence
    return {
      key: 'NO_LLEGO',
      motivo: `${n.envio_error || 'Falló el envío'}${definitivo ? '' : ' · se reintenta en la próxima corrida'}`,
    }
  }
  if (hoy > vence) return { key: 'NO_SALIO', motivo: `Pasaron más de ${atraso} días desde la entrega sin enviarla` }
  if (!activo) return { key: 'POR_ENVIAR', motivo: 'La automatización está APAGADA: no saldrá hasta encenderla' }
  return {
    key: 'POR_ENVIAR',
    motivo: n.fecha_programada >= hoy ? 'Sale el próximo día hábil a las 10:00' : 'Sale en la próxima corrida (10:00, lunes a viernes)',
  }
}

const ACUSE_LABEL = { read: 'Leído', delivered: 'Le llegó', sent: 'Enviado', failed: 'No llegó' }

function ChipAcuse({ acuse }) {
  if (!acuse?.acuse) return <span className="text-[10px] text-ink3">sin acuse de Meta</span>
  const t = ESTADO_ENVIO[acuse.acuse]
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ink2"
      title={acuse.acuse_en ? `Acuse: ${fmtDateTime(acuse.acuse_en)}` : undefined}>
      {t && <span className={t.clase}>{t.icono}</span>}{ACUSE_LABEL[acuse.acuse] || acuse.acuse}
    </span>
  )
}

export default function PanelEncuesta({ rol, onAtender, recargarToken }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [config, setConfig]   = useState(null)
  const [filas, setFilas]     = useState([])
  const [acuses, setAcuses]   = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [pestana, setPestana] = useState('POR_ATENDER')
  const [calif, setCalif]     = useState(null)        // sub-filtro de «Respondieron»
  const [dias, setDias]       = useState(30)
  const [q, setQ]             = useState('')
  const [ocupado, setOcupado] = useState('')

  const verAcuse = ROLES_ACUSE.includes(rol)

  useEffect(() => { cargar() }, [recargarToken])   // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    setLoading(true)
    try {
      const { data: cfgRows, error: e1 } = await db.from('config_operativa')
        .select('clave, valor').eq('modulo', 'ENCUESTA_ENTREGA')
      if (e1) throw e1
      const cfg = Object.fromEntries((cfgRows || []).map(r => [r.clave, r.valor]))
      const arranque = limpiar(cfg.arranque_desde)
      const p = typeof cfg.plantilla === 'string' ? (() => { try { return JSON.parse(cfg.plantilla) } catch { return null } })() : cfg.plantilla
      const c = {
        activo: cfg.activo === true || cfg.activo === 'true',
        arranque: /^\d{4}-\d{2}-\d{2}$/.test(arranque) ? arranque : null,
        atraso: Math.min(parseInt(cfg.dias_max_atraso) || 7, 30),
        plantilla: !!p?.nombre,
      }
      setConfig(c)
      if (!c.arranque) { setFilas([]); setAcuses({}); setError(null); return }

      // Solo POST_ENTREGA desde el arranque: son decenas por semana, pero se
      // usa dbTodo igual — el corte mudo de 1000 filas ya nos mordió en /nps.
      const data = await dbTodo(() => db.from('nps_seguimiento')
        .select('id, servicio_id, fecha_programada, estado, satisfaccion, respondido_en, envio_estado, envio_en, envio_intentos, envio_error, whatsapp_destino, comentario, comentario_en, seguimiento, seguimiento_nota, atendido_en, pqr_id, servicios!inner(estado, aliados:aliado_origen_id(vip), mascotas(nombre, clientes(nombre, apellido, whatsapp)), planes(nombre))')
        .eq('tipo', 'POST_ENTREGA')
        .gte('fecha_programada', c.arranque)
        .order('fecha_programada', { ascending: false })
        .order('id', { ascending: true }))
      setFilas(data || [])

      if (verAcuse) {
        // Best-effort: sin acuse la pantalla sigue sirviendo.
        try {
          const r = await orbitApi('/automatizaciones/encuesta_entrega/envios?estado=todos&dias=0')
          setAcuses(Object.fromEntries((r?.filas || []).map(f => [f.id, f])))
        } catch { setAcuses({}) }
      }
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function reintentar(n) {
    const m = n.servicios?.mascotas
    const ok = await confirm(
      `Se va a volver a enviar la encuesta a ${m?.clientes?.nombre || 'la familia'}${m?.nombre ? ` (${m.nombre})` : ''} al ${n.whatsapp_destino || m?.clientes?.whatsapp || 'número registrado'}.`,
      { title: '¿Reintentar la encuesta?', variant: 'default', confirmLabel: 'Reintentar' }
    )
    if (!ok) return
    setOcupado(n.id)
    try {
      await orbitApi(`/automatizaciones/encuesta_entrega/envios/${n.id}/relanzar`, { method: 'POST' })
      await cargar()
    } catch (e) {
      const hacer = e.detalle?.explicacion?.hacer
      await showAlert(`${e.message || 'No se pudo reenviar'}${hacer ? `\n\nQué hacer: ${hacer}` : ''}`,
        { title: 'No se reenvió', variant: 'danger' })
    } finally {
      setOcupado('')
    }
  }

  const hoy = today()
  const enriquecidas = useMemo(() => {
    if (!config) return []
    const desde = dias ? sumarDias(hoy, -dias) : null
    const texto = sinTildes(q.trim())
    return filas
      .filter(n => !desde || n.fecha_programada >= desde)
      .filter(n => {
        if (!texto) return true
        const m = n.servicios?.mascotas
        return sinTildes(`${m?.nombre} ${m?.clientes?.nombre} ${m?.clientes?.apellido} ${m?.clientes?.whatsapp}`).includes(texto)
      })
      .map(n => ({ ...n, _acuse: acuses[n.id], _etapa: etapaDe(n, acuses[n.id], { hoy, atraso: config.atraso, activo: config.activo }) }))
  }, [filas, acuses, config, dias, q, hoy])

  const cuenta = useMemo(() => {
    const c = { todas: enriquecidas.length, POR_ATENDER: 0, BUENA: 0, REGULAR: 0, MALA: 0, llego: 0, salieron: 0 }
    for (const n of enriquecidas) {
      c[n._etapa.key] = (c[n._etapa.key] || 0) + 1
      if (n.seguimiento === 'PENDIENTE') c.POR_ATENDER++
      if (n.satisfaccion) c[n.satisfaccion]++
      if (n.envio_en) c.salieron++
      if (['delivered', 'read'].includes(n._acuse?.acuse)) c.llego++
    }
    return c
  }, [enriquecidas])

  const visibles = useMemo(() => {
    let r = pestana === 'todas' ? enriquecidas
      : pestana === 'POR_ATENDER' ? enriquecidas.filter(n => n.seguimiento === 'PENDIENTE')
      : enriquecidas.filter(n => n._etapa.key === pestana)
    if (pestana === 'RESPONDIO' && calif) r = r.filter(n => n.satisfaccion === calif)
    // Lo respondido, por hora de respuesta; lo demás, por entrega (ya viene así).
    if (pestana === 'RESPONDIO' || pestana === 'POR_ATENDER') {
      r = [...r].sort((a, b) => String(b.respondido_en || '').localeCompare(String(a.respondido_en || '')))
    }
    return r
  }, [enriquecidas, pestana, calif])

  if (loading && !config) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div>

  const respondieron = cuenta.BUENA + cuenta.REGULAR + cuenta.MALA
  const pct = (a, b) => b > 0 ? `${Math.round(a * 100 / b)}%` : '-'

  return (
    <div>
      {/* Estado de la automatización: si está apagada o sin arranque, nada sale */}
      {config && (!config.activo || !config.arranque || !config.plantilla) && (
        <div className="mb-5 rounded-lg border border-[#FFD980] bg-[#FFF8E6] text-[#9A5500] p-3 text-[12px]">
          {!config.arranque
            ? 'La encuesta no tiene fecha de arranque (ENCUESTA_ENTREGA.arranque_desde): el job no envía nada.'
            : !config.plantilla
              ? 'La encuesta no tiene plantilla aprobada configurada: el job no envía nada.'
              : 'La automatización está APAGADA en /automatizaciones: las entregas se acumulan en «Por enviar» y no sale ninguna encuesta.'}
        </div>
      )}
      {config?.arranque && (
        <p className="text-[11px] text-ink3 mb-4">
          Entregas desde el {parseDate(config.arranque).toLocaleDateString('es-CO')} · sale el siguiente día hábil a las 10:00 (lunes a viernes) · plazo de {config.atraso} días
        </p>
      )}

      {/* Embudo */}
      <div className={`grid grid-cols-2 ${verAcuse ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4 mb-6`}>
        <StatCard label="Entregas" value={cuenta.todas} sub={dias ? `últimos ${dias} días` : 'desde el arranque'} />
        <StatCard label="Enviadas" value={cuenta.salieron} sub={`${pct(cuenta.salieron, cuenta.todas)} de las entregas`} />
        {verAcuse && <StatCard label="Le llegó" value={cuenta.llego} sub="acuse de Meta" valueColor="#1A5CD8" />}
        <StatCard label="Respondieron" value={respondieron}
          sub={`${pct(respondieron, cuenta.salieron)} de las enviadas`} valueColor="#1D8A55" />
        <StatCard label="Calificaron Bueno" value={pct(cuenta.BUENA, respondieron)}
          sub={`😊 ${cuenta.BUENA} · 😐 ${cuenta.REGULAR} · ☹️ ${cuenta.MALA}`} valueColor="#1D8A55" />
        <StatCard label="Por atender" value={cuenta.POR_ATENDER} sub="Regular o Malo sin cerrar" valueColor="#9A5500" />
      </div>

      {/* Ventana + búsqueda */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {VENTANAS.map(v => (
            <button key={v.dias}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${dias === v.dias ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
              onClick={() => setDias(v.dias)}>{v.label}</button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Mascota, familia o número" className="pl-8" />
        </div>
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar} title="Recargar">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Pasos del embudo */}
      <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border mb-3 w-fit max-w-full overflow-x-auto" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        {PESTANAS.map(p => (
          <button key={p.key}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${pestana === p.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
            onClick={() => { setPestana(p.key); setCalif(null) }}>
            {p.label} ({cuenta[p.key] || 0})
          </button>
        ))}
      </div>
      {pestana === 'RESPONDIO' && (
        <div className="flex gap-1.5 mb-4">
          {Object.entries(SATISFACCION).map(([k, s]) => (
            <button key={k} onClick={() => setCalif(calif === k ? null : k)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all ${s.cls} ${calif === k ? 'ring-2 ring-primary-dark/30' : calif ? 'opacity-50' : ''}`}>
              {s.label} ({cuenta[k]})
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink3 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
              <th className="px-3 py-2.5 font-bold">Mascota / Familia</th>
              <th className="px-3 py-2.5 font-bold">Entregado</th>
              <th className="px-3 py-2.5 font-bold">Encuesta</th>
              <th className="px-3 py-2.5 font-bold">Respuesta</th>
              <th className="px-3 py-2.5 font-bold">Seguimiento</th>
              <th className="px-3 py-2.5 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(n => {
              const m = n.servicios?.mascotas
              const c = m?.clientes
              const e = n._etapa
              const s = n.satisfaccion && SATISFACCION[n.satisfaccion]
              const puedeReintentar = verAcuse && e.key === 'NO_LLEGO'
              return (
                <tr key={n.id} className="border-b last:border-0 align-top" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-ink">{m?.nombre || '-'}</span>
                      {esAliadoVip(n.servicios) && <VipStar size={12} />}
                    </div>
                    <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                    <div className="text-[10px] text-ink3">{n.servicios?.planes?.nombre}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink3 whitespace-nowrap">
                    {n.fecha_programada ? parseDate(n.fecha_programada).toLocaleDateString('es-CO') : '-'}
                  </td>
                  <td className="px-3 py-2.5 max-w-[240px]">
                    {n.envio_en ? (
                      <>
                        <div className="text-ink2">Enviada {fmtDateTime(n.envio_en)}</div>
                        {verAcuse && <ChipAcuse acuse={n._acuse} />}
                      </>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${e.key === 'POR_ENVIAR' ? 'bg-[#FFF3DC] text-[#9A5500] border-[#FFD980]' : e.key === 'NO_LLEGO' ? 'bg-[#FDECEC] text-[#C03030] border-[#F3B7B7]' : 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]'}`}>
                        {e.key === 'POR_ENVIAR' ? 'Por enviar' : e.key === 'NO_LLEGO' ? 'Error' : 'No se envió'}
                      </span>
                    )}
                    {e.motivo && (
                      <p className={`text-[10px] mt-1 ${e.key === 'NO_LLEGO' ? 'text-[#C03030]' : 'text-ink3'}`}>{e.motivo}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 max-w-[280px]">
                    {s ? (
                      <>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                        {n.respondido_en && <span className="ml-1 text-[10px] text-ink3">{fmtDateTime(n.respondido_en)}</span>}
                        {n.pqr_id && <span className="ml-1 text-[10px] font-bold text-[#C03030]">· PQR</span>}
                        {n.comentario
                          ? <p className="text-[11px] text-ink2 mt-1 line-clamp-3" title={n.comentario}>«{n.comentario}»</p>
                          : n.satisfaccion !== 'BUENA' && <p className="text-[10px] text-ink3 mt-1">Aún no escribió qué pasó</p>}
                      </>
                    ) : n.envio_estado === 'ENVIADO' ? (
                      <span className="text-[10px] text-ink3">Sin respuesta</span>
                    ) : <span className="text-ink3">-</span>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    {n.seguimiento === 'PENDIENTE' && <span className="text-[10px] font-bold text-[#9A5500]">Por atender</span>}
                    {n.seguimiento === 'ATENDIDO' && (
                      <>
                        <span className="text-[10px] font-bold text-primary-dark">Atendido</span>
                        {n.atendido_en && <span className="ml-1 text-[10px] text-ink3">{fmtDateTime(n.atendido_en)}</span>}
                        {n.seguimiento_nota && <p className="text-[10px] text-ink2 mt-1 line-clamp-2" title={n.seguimiento_nota}>{n.seguimiento_nota}</p>}
                      </>
                    )}
                    {!n.seguimiento && <span className="text-ink3">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1.5 justify-end">
                      {n.seguimiento === 'PENDIENTE' && (
                        <Button size="sm" onClick={() => onAtender(n)}>Atender</Button>
                      )}
                      {puedeReintentar && (
                        <Button size="sm" variant="secondary" disabled={ocupado === n.id} onClick={() => reintentar(n)}>
                          <RotateCcw size={12} />{ocupado === n.id ? '...' : 'Reintentar'}
                        </Button>
                      )}
                      {c?.whatsapp && (
                        <a href={waLink(c.whatsapp, `Hola, queremos saber cómo estuvo el servicio de ${m?.nombre}`)}
                          target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                          style={{ background: '#25D366', color: 'white' }}>
                          <MessageCircle size={11} />WA
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {visibles.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-ink3 text-sm">
                {pestana === 'POR_ATENDER' ? 'Nada por atender 🙌' : 'Sin registros en esta ventana'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
