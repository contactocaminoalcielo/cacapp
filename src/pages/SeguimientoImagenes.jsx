import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { petEmoji, today } from '@/lib/utils'
import { enviarWhatsApp, LINEAS_WHATSAPP } from '@/lib/whatsapp'
import { MessageCircle, RefreshCw, CheckCircle2, Send } from 'lucide-react'

const FILTROS = [
  { key: 'todos',         label: 'Todos' },
  { key: 'PENDIENTE',     label: 'Pendientes' },
  { key: 'ENVIADA',       label: 'Enviadas' },
  { key: 'RECIBIDA',      label: 'Recibidas' },
  { key: 'SIN_RESPUESTA', label: 'Sin respuesta' },
]

const ESTADO_COLORS = {
  PENDIENTE:     { bg: '#FFF3DC', text: '#9A5500',  border: '#FFD980' },
  ENVIADA:       { bg: '#EEF3FB', text: '#3B6FBF',  border: '#C5D8F5' },
  RECIBIDA:      { bg: '#E8F3EB', text: '#1D8A55',  border: '#A0D4B0' },
  SIN_RESPUESTA: { bg: '#FEE8E8', text: '#C03030',  border: '#FCA5A5' },
}

const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin

function buildMensaje(nombreCliente, nombreMascota, codigoFotos) {
  const link = codigoFotos ? `${APP_URL}/#/fotos/${codigoFotos}` : null
  return [
    `Hola ${nombreCliente}, le escribe el equipo de *Camino al Cielo* 🐾`,
    ``,
    `Estamos preparando con amor el servicio de *${nombreMascota}*. Para continuar, necesitamos que nos comparta algunas fotos de ${nombreMascota} que más atesore.`,
    ``,
    link
      ? `Puede hacerlo fácilmente desde este enlace:\n${link}`
      : `Puede enviárnoslas aquí mismo por WhatsApp.`,
    ``,
    `¡Gracias por confiar en nosotros! 💚`,
  ].join('\n')
}

export default function SeguimientoImagenes() {
  const [solicitudes,  setSolicitudes]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [filtro,       setFiltro]       = useState('PENDIENTE')
  const [lineaOrigen,  setLineaOrigen]  = useState(LINEAS_WHATSAPP[0].numero)
  const [enviando,     setEnviando]     = useState(null)  // id de solicitud en curso

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const { data, error: err } = await db
        .from('solicitudes_imagenes')
        .select('*, servicios(codigo_fotos, mascotas(nombre,especies(nombre),clientes(nombre,apellido,whatsapp)),planes(nombre,codigo)), recordatorios(nombre)')
        .order('fecha_solicitud', { ascending: false })
      if (err) throw err
      setSolicitudes(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function actualizarEstado(id, nuevoEstado) {
    const update = { estado: nuevoEstado }
    if (nuevoEstado === 'RECIBIDA') {
      update.fecha_recepcion = today()
      const sol = solicitudes.find(s => s.id === id)
      if (sol?.servicio_id) {
        await db.from('servicios')
          .update({ fecha_imagenes_recibidas: today() })
          .eq('id', sol.servicio_id)
          .is('fecha_imagenes_recibidas', null)
      }
    }
    await db.from('solicitudes_imagenes').update(update).eq('id', id)
    setSolicitudes(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
  }

  async function handleEnviarWA(sol) {
    const m     = sol.servicios?.mascotas
    const c     = m?.clientes
    const codigo = sol.servicios?.codigo_fotos

    if (!c?.whatsapp) return
    setEnviando(sol.id)
    try {
      const mensaje = buildMensaje(c.nombre, m?.nombre || 'su mascota', codigo)
      await enviarWhatsApp({
        telefono:   c.whatsapp,
        nombre:     `${c.nombre} ${c.apellido || ''}`.trim(),
        mensaje,
        fromNumber: lineaOrigen,
      })
      await actualizarEstado(sol.id, 'ENVIADA')
    } catch (e) {
      alert(`Error al enviar: ${e.message}`)
    } finally {
      setEnviando(null)
    }
  }

  const filtradas = filtro === 'todos'
    ? solicitudes
    : solicitudes.filter(s => s.estado === filtro)

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="spinner" /><span className="text-sm text-ink3">Cargando...</span>
    </div>
  )
  if (error) return (
    <div className="p-7">
      <div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div>
    </div>
  )

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7 space-y-6">

        {/* Selector de línea WhatsApp */}
        <div className="rounded-xl p-4 border flex items-center gap-4 flex-wrap"
          style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <MessageCircle size={15} className="text-green-600" />
            <span className="text-[12px] font-semibold text-green-800">Línea de envío Zolutium:</span>
          </div>
          {LINEAS_WHATSAPP.map(l => (
            <button
              key={l.numero}
              onClick={() => setLineaOrigen(l.numero)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border"
              style={{
                background:  lineaOrigen === l.numero ? '#16A34A' : 'white',
                color:       lineaOrigen === l.numero ? 'white'   : '#374151',
                borderColor: lineaOrigen === l.numero ? '#16A34A' : '#D1D5DB',
              }}
            >
              {lineaOrigen === l.numero && <CheckCircle2 size={12} />}
              {l.label}
            </button>
          ))}
          <span className="text-[11px] text-green-700 ml-auto hidden md:block">
            El mensaje incluye el enlace del portal de fotos del cliente.
          </span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Pendientes"    value={solicitudes.filter(s => s.estado === 'PENDIENTE').length}     valueColor="#9A5500" />
          <StatCard label="Enviadas"      value={solicitudes.filter(s => s.estado === 'ENVIADA').length}       valueColor="#3B6FBF" />
          <StatCard label="Recibidas"     value={solicitudes.filter(s => s.estado === 'RECIBIDA').length}      valueColor="#1D8A55" />
          <StatCard label="Sin respuesta" value={solicitudes.filter(s => s.estado === 'SIN_RESPUESTA').length} valueColor="#C03030" />
        </div>

        {/* Filtros */}
        <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {FILTROS.map(f => (
            <button key={f.key}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
              onClick={() => setFiltro(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Mascota / Cliente</Th>
                <Th>Plan</Th>
                <Th>Ítem</Th>
                <Th>Solicitud #</Th>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(s => {
                const m   = s.servicios?.mascotas
                const c   = m?.clientes
                const e   = ESTADO_COLORS[s.estado] || {}
                const esc = enviando === s.id
                return (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{petEmoji(m?.especies?.nombre)}</span>
                        <div>
                          <div className="font-semibold text-ink">{m?.nombre || '-'}</div>
                          <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink3">{s.servicios?.planes?.nombre}</Td>
                    <Td className="text-ink2">{s.recordatorios?.nombre || '-'}</Td>
                    <Td className="font-mono text-[11px]">#{s.numero_solicitud || s.id}</Td>
                    <Td className="text-ink3">
                      {s.fecha_solicitud ? new Date(s.fecha_solicitud).toLocaleDateString('es-CO') : '-'}
                    </Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                        {s.estado}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex gap-1.5 flex-wrap">
                        {s.estado === 'PENDIENTE' && (
                          <Button size="sm" variant="secondary"
                            onClick={() => actualizarEstado(s.id, 'ENVIADA')}>
                            Marcar enviada
                          </Button>
                        )}
                        {s.estado === 'ENVIADA' && (
                          <Button size="sm" onClick={() => actualizarEstado(s.id, 'RECIBIDA')}>
                            ✓ Recibida
                          </Button>
                        )}

                        {/* Botón enviar por Zolutium */}
                        {c?.whatsapp && s.estado !== 'RECIBIDA' && (
                          <button
                            onClick={() => handleEnviarWA(s)}
                            disabled={esc}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-opacity disabled:opacity-50"
                            style={{ background: '#25D366', color: 'white' }}
                            title={`Enviar enlace de fotos por WhatsApp desde ${lineaOrigen}`}
                          >
                            {esc
                              ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : <Send size={11} />
                            }
                            {s.estado === 'ENVIADA' ? 'Reenviar' : 'Enviar WA'}
                          </button>
                        )}

                        {s.estado === 'ENVIADA' && (
                          <button onClick={() => actualizarEstado(s.id, 'SIN_RESPUESTA')}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                            style={{ color: '#C03030' }}>
                            Sin resp.
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-ink3 text-sm">Sin solicitudes</td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </div>
  )
}
