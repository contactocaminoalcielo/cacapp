import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { Truck, Clock, FileText, Camera, Pen } from 'lucide-react'

// ── Resumen de la entrega ─────────────────────────────────────────────────────
// Qué pasó con la entrega y a qué horas: se publicó, quién la tomó, a qué hora
// salió (`aceptada_en`, migración 084) y a qué hora entregó. Más la evidencia:
// foto, firma y el certificado ya firmado.
// Solo tiene sentido cuando la entrega arrancó — en PENDIENTE (el cascarón que
// crea el trigger al nacer el servicio) no hay nada que contar.
// Usado en el modal del Kanban; pensado para reusarse en la ficha del servicio.
export default function ResumenEntrega({ servicioId }) {
  const [ent, setEnt]     = useState(undefined)   // undefined = cargando · null = sin entrega
  const [gen, setGen]     = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    setEnt(undefined); setError('')
    db.from('entregas')
      .select('*, personal:mensajero_id ( nombre, apellido )')
      .eq('servicio_id', servicioId)
      .maybeSingle()
      .then(({ data }) => { if (activo) setEnt(data || null) })
    return () => { activo = false }
  }, [servicioId])

  if (ent === undefined || !ent || ent.estado === 'PENDIENTE') return null

  const quien = ent.personal ? `${ent.personal.nombre} ${ent.personal.apellido}`.trim() : null
  const hhmm  = (ts) => { try { return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) } catch (_) { return null } }
  const fecha = (d)  => { try { return new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) } catch (_) { return null } }

  // Cuánto tardó entre salir y entregar. Solo si tenemos las dos puntas: la hora
  // de entrega es time (hora local) y `aceptada_en` un instante, así que se
  // compara sobre la fecha en que se realizó.
  const duracion = (() => {
    if (!ent.aceptada_en || !ent.hora_realizada || !ent.fecha_realizada) return null
    const fin = new Date(`${ent.fecha_realizada}T${String(ent.hora_realizada).slice(0, 8)}`)
    const min = Math.round((fin - new Date(ent.aceptada_en)) / 60000)
    if (!Number.isFinite(min) || min < 0 || min > 24 * 60) return null
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
  })()

  const PASOS = [
    ent.publicada_en && { label: 'Publicada',        valor: hhmm(ent.publicada_en), color: '#3730A3' },
    ent.tomada_en    && { label: `La tomó ${quien || ''}`.trim(), valor: hhmm(ent.tomada_en), color: '#5B21B6' },
    ent.aceptada_en  && { label: 'Salió a entregar', valor: hhmm(ent.aceptada_en), color: '#1E40AF' },
    ent.fecha_realizada && {
      label: 'Entregada',
      valor: `${fecha(ent.fecha_realizada)}${ent.hora_realizada ? ` · ${String(ent.hora_realizada).slice(0, 5)}` : ''}`,
      color: '#065F46',
    },
  ].filter(Boolean)

  async function descargarCertificado() {
    setGen(true); setError('')
    try {
      const { generarCertificadoEntrega } = await import('@/lib/certificadoEntrega')
      const [{ data: svc }, { data: items }] = await Promise.all([
        db.from('servicios')
          .select('id, fecha_ingreso, valor_total, valor_pagado, planes:plan_id ( nombre ), ' +
                  'mascotas:mascota_id ( nombre, especies ( nombre ), clientes:cliente_id ( nombre, apellido ) )')
          .eq('id', servicioId).single(),
        db.from('servicio_recordatorios')
          .select('id, estado, origen, precio_cobrado, recordatorios ( nombre, categoria )')
          .eq('servicio_id', servicioId).neq('origen', 'REMOVIDO'),
      ])
      await generarCertificadoEntrega({
        svc, entrega: ent, items: items || [],
        mensajero: ent.personal || null,
        // Sin firma dibujada en el momento: la toma de `entrega.foto_firma_url`
      })
    } catch (e) {
      setError(e.message || 'No se pudo generar el certificado')
    } finally { setGen(false) }
  }

  const evidencias = [
    ent.foto_entrega_url && { url: ent.foto_entrega_url, label: 'Foto de la entrega', Icon: Camera },
    ent.foto_firma_url   && { url: ent.foto_firma_url,   label: 'Firma del cliente',  Icon: Pen },
  ].filter(Boolean)

  return (
    <div className="rounded-xl border p-3 space-y-2.5" style={{ borderColor: '#DDD6FE', background: '#FAF9FF' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#5B21B6' }}>
        <Truck size={11} /> Entrega
      </div>

      {/* Línea de tiempo */}
      <div className="space-y-1">
        {PASOS.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 text-gray-600">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="font-semibold text-gray-800">{p.valor || '—'}</span>
          </div>
        ))}
        {!PASOS.length && (
          <div className="text-[12px] text-gray-500">
            {ent.estado === 'DISPONIBLE' ? 'Publicada — esperando que alguien la tome.' : 'Sin movimientos registrados.'}
          </div>
        )}
      </div>

      {duracion && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 pt-0.5 border-t border-purple-100">
          <Clock size={11} /> Tardó {duracion} desde que salió
        </div>
      )}

      {/* Evidencia */}
      {evidencias.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {evidencias.map(ev => (
            <a key={ev.url} href={ev.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
              <ev.Icon size={11} /> {ev.label}
            </a>
          ))}
        </div>
      )}

      {ent.fecha_realizada && (
        <button onClick={descargarCertificado} disabled={gen}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-all hover:opacity-90 disabled:opacity-60"
          style={{ background: '#EDE9FE', color: '#5B21B6' }}>
          <FileText size={12} />
          {gen ? 'Generando…' : ent.foto_firma_url ? 'Certificado firmado (PDF)' : 'Certificado de entrega (PDF)'}
        </button>
      )}

      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  )
}
