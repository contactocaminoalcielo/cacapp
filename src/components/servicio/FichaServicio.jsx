import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/dialog'
import { db } from '@/lib/supabase'
import { fmt, parseDate, parsearErrorDB, petEmoji, fmtDateTime } from '@/lib/utils'
import { ESTADO_COLOR, ESTADO_LABEL } from '@/lib/constants'
import { etapaContacto } from '@/lib/imagenes'
import RecibosServicio from '@/components/servicio/RecibosServicio'
import LineaTiempoServicio from '@/components/servicio/LineaTiempoServicio'
import HistorialValor from '@/components/servicio/HistorialValor'
import { esAliadoVip, VipBadge } from '@/components/servicio/VipAliado'
import {
  User, MapPin, CreditCard, Clock, Camera, Truck, Package, Snowflake, PawPrint,
} from 'lucide-react'

// ── Ficha completa del servicio / mascota ─────────────────────────────────────
// Tarjeta de solo-lectura con TODO lo del servicio: cliente, mascota, plan,
// recogida (con hora confirmada del técnico), cuarto frío (nevera), ítems de
// producción, entrega, financiero con desglose, recibos (cuál afecta Finanzas
// + comprobantes), evidencias y la trazabilidad completa de novedades.
// Se abre desde Gestión › Historial al hacer clic en la fila.

const PAGO_STYLE = {
  COMPLETO:  { bg: '#DCFCE7', color: '#166534' },
  PARCIAL:   { bg: '#FEF3C7', color: '#92400E' },
  PENDIENTE: { bg: '#FEE2E2', color: '#991B1B' },
}

const fmtD  = f => f ? parseDate(f)?.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTS = ts => ts ? new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function Dato({ label, children }) {
  if (children == null || children === '' || children === '—') return null
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 last:border-0">
      <span className="text-[11px] text-gray-400 shrink-0">{label}</span>
      <span className="text-[11px] font-semibold text-gray-800 text-right break-words min-w-0">{children}</span>
    </div>
  )
}

function Box({ icon: Icon, titulo, children }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
        <Icon size={10} /> {titulo}
      </div>
      {children}
    </div>
  )
}

export default function FichaServicio({ servicioId, onClose }) {
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [svc, setSvc]           = useState(null)
  const [recogida, setRecogida] = useState(null)
  const [cf, setCf]             = useState(null)
  const [entrega, setEntrega]   = useState(null)
  const [items, setItems]       = useState([])
  const [novedades, setNovedades] = useState([])
  const [contactos, setContactos] = useState([])
  // Se incrementa cuando algo de dentro cambia el servicio (corregir un cobro):
  // la ficha se recarga sola en vez de quedarse mostrando el valor viejo.
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    if (!servicioId) return
    let activo = true
    setLoading(true); setError('')
    ;(async () => {
      try {
        // La consulta del servicio es la única obligatoria; las demás son
        // best-effort (si una falla, la ficha se muestra sin esa sección)
        const [svcRes, rgRes, cfRes, enRes, itRes, nvRes, ctRes] = await Promise.all([
          db.from('servicios')
            .select(`*,
              mascotas:mascota_id(*, especies(nombre), clientes:cliente_id(*)),
              planes:plan_id(nombre, codigo, tipo_proceso),
              aliados:aliado_origen_id(nombre, modalidad_comision, telefono, whatsapp, vip),
              tecnico:tecnico_id(nombre, apellido),
              registrador:registrado_por(nombre, apellido)`)
            .eq('id', servicioId).single(),
          db.from('recogidas')
            .select('tipo_lugar, ciudad, direccion_recogida, barrio, contacto_nombre, contacto_telefono, estado, fecha_programada, hora_programada, fecha_llegada, hora_llegada, fecha_realizada, hora_realizada, notas, foto_recogida_url')
            .eq('servicio_id', servicioId),
          db.from('cuarto_frio')
            .select('nevera_codigo, posicion, estado, peso_kg, foto_ingreso_url, foto_pesaje_url, fecha_salida, created_at, fecha_ingreso_real, registrador:registrado_por(nombre, apellido)')
            .eq('servicio_id', servicioId),
          db.from('entregas').select('*').eq('servicio_id', servicioId),
          db.from('servicio_recordatorios')
            .select('id, origen, estado, cantidad, precio_cobrado, recordatorios(nombre, precio_base, categoria)')
            .eq('servicio_id', servicioId).neq('origen', 'REMOVIDO'),
          db.from('novedades_servicio')
            .select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
            .eq('servicio_id', servicioId).order('created_at', { ascending: true }),
          // Contactos de WhatsApp pidiendo las fotos (1 manual + 2 automáticos)
          db.from('solicitud_imagenes_contactos')
            .select('numero, estado')
            .eq('servicio_id', servicioId),
        ])
        if (svcRes.error) throw svcRes.error
        if (!activo) return
        setSvc(svcRes.data)
        setRecogida((rgRes.data || [])[0] || null)
        setCf((cfRes.data || [])[0] || null)
        setItems(itRes.data || [])
        setNovedades(nvRes.data || [])
        setContactos(ctRes.data || [])
        // Nombre del mensajero en query aparte (evita depender del hint de FK)
        const ent = (enRes.data || [])[0] || null
        if (ent?.mensajero_id) {
          const { data: men } = await db.from('personal')
            .select('nombre, apellido').eq('id', ent.mensajero_id).maybeSingle()
          if (men) ent.mensajero_nombre = `${men.nombre || ''} ${men.apellido || ''}`.trim()
        }
        if (activo) setEntrega(ent)
      } catch (e) {
        if (activo) setError(parsearErrorDB(e))
      } finally {
        if (activo) setLoading(false)
      }
    })()
    return () => { activo = false }
  }, [servicioId, recarga])

  const m   = svc?.mascotas || {}
  const cli = m.clientes || {}
  const ec  = ESTADO_COLOR[svc?.estado] || {}
  const pg  = PAGO_STYLE[svc?.estado_pago] || { bg: '#F3F4F6', color: '#6B7280' }
  const saldo = Math.max(0, (svc?.valor_total || 0) - (svc?.valor_pagado || 0))

  const evidencias = [
    recogida?.foto_recogida_url && { url: recogida.foto_recogida_url, label: 'Identidad mascota (recogida)' },
    cf?.foto_ingreso_url        && { url: cf.foto_ingreso_url,        label: 'Ingreso cuarto frío' },
    cf?.foto_pesaje_url         && { url: cf.foto_pesaje_url,         label: 'Pesaje' },
    entrega?.foto_entrega_url   && { url: entrega.foto_entrega_url,   label: 'Entrega' },
    entrega?.foto_firma_url     && { url: entrega.foto_firma_url,     label: 'Firma de entrega' },
  ].filter(Boolean)

  const datosEntregaCliente = svc?.datos_entrega_cliente && typeof svc.datos_entrega_cliente === 'object'
    ? Object.entries(svc.datos_entrega_cliente).filter(([, v]) => v != null && String(v).trim() !== '')
    : []

  const ITEM_ESTADO = {
    PENDIENTE:  { bg: '#FEF3C7', color: '#92400E' },
    EN_PROCESO: { bg: '#DBEAFE', color: '#1E40AF' },
    LISTO:      { bg: '#DCFCE7', color: '#166534' },
    ENTREGADO:  { bg: '#F3F4F6', color: '#6B7280' },
    NA:         { bg: '#F3F4F6', color: '#9CA3AF' },
  }

  return (
    <Modal open onClose={onClose}
      title={`${petEmoji(m.especies?.nombre)} ${m.nombre || 'Mascota'} — ficha completa`}
      maxWidth="max-w-3xl">
      {loading ? (
        <div className="py-14 text-center text-gray-400 text-[13px]">Cargando ficha…</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">{error}</div>
      ) : (
        <div className="space-y-4">

          {/* Chips de estado */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Va PRIMERO, antes del estado: es quién es la mascota, no en qué
                punto del proceso está — y esta ficha se usa desde varios módulos. */}
            {esAliadoVip(svc) && <VipBadge />}
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: ec.bg || '#F3F4F6', color: ec.text || '#374151', border: `1px solid ${ec.border || ec.bg || '#E5E7EB'}` }}>
              {ESTADO_LABEL[svc?.estado] || svc?.estado || '—'}
            </span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: pg.bg, color: pg.color }}>
              Pago {String(svc?.estado_pago || '—').toLowerCase()}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500">📅 Ingreso {fmtD(svc?.fecha_ingreso)}</span>
            {svc?.fecha_listo && <span className="text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500">✅ Listo {fmtTS(svc.fecha_listo)}</span>}
            {recogida?.hora_programada && (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-cyan-50 text-cyan-700"
                title="Hora de llegada confirmada por el técnico al iniciar la ruta">
                🕐 Recogida {String(recogida.hora_programada).slice(0, 5)}
              </span>
            )}
            {cf?.nevera_codigo && !cf?.fecha_salida && (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: '#CFFAFE', color: '#0E7490' }}>
                🧊 Nevera {cf.nevera_codigo}
              </span>
            )}
          </div>

          {/* Cancelación */}
          {svc?.estado === 'CANCELADO' && (
            <div className="rounded-xl px-4 py-3 space-y-1" style={{ background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
              <p className="text-[13px] font-bold" style={{ color: '#991B1B' }}>🚫 Servicio cancelado</p>
              <div className="text-[12px] space-y-0.5" style={{ color: '#B91C1C' }}>
                {svc.motivo_cancelacion && <p><strong>Motivo:</strong> {svc.motivo_cancelacion}</p>}
                {svc.observacion_cancelacion && <p><strong>Observación:</strong> {svc.observacion_cancelacion}</p>}
                {svc.etapa_cancelacion && <p><strong>Etapa al cancelar:</strong> {ESTADO_LABEL[svc.etapa_cancelacion] || svc.etapa_cancelacion}</p>}
                {svc.cancelado_en && <p><strong>Fecha:</strong> {fmtTS(svc.cancelado_en)}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Cliente */}
            <Box icon={User} titulo="Cliente">
              <Dato label="Nombre">{`${cli.nombre || ''} ${cli.apellido || ''}`.trim() || '—'}</Dato>
              <Dato label="Cédula / NIT">{cli.cedula_nit}</Dato>
              <Dato label="WhatsApp">{cli.whatsapp}</Dato>
              <Dato label="Teléfono">{cli.telefono}</Dato>
              <Dato label="Teléfono 2">{cli.telefono2}</Dato>
              <Dato label="Email">{cli.email}</Dato>
              <Dato label="Ciudad">{cli.ciudad}</Dato>
              <Dato label="Dirección">{cli.direccion}</Dato>
              <Dato label="Tipo">{cli.tipo_cliente}</Dato>
            </Box>

            {/* Mascota */}
            <Box icon={PawPrint} titulo="Mascota">
              <Dato label="Nombre">{m.nombre}</Dato>
              <Dato label="Especie">{m.especies?.nombre}</Dato>
              <Dato label="Raza">{m.raza}</Dato>
              <Dato label="Sexo">{m.sexo}</Dato>
              <Dato label="Tamaño">{m.tamano}</Dato>
              <Dato label="Peso registrado">{m.peso_kg ? `${m.peso_kg} kg` : null}</Dato>
              <Dato label="Peso en báscula">{cf?.peso_kg ? `${cf.peso_kg} kg` : null}</Dato>
              <Dato label="Fallecimiento">{m.fecha_fallecimiento ? fmtD(m.fecha_fallecimiento) : null}</Dato>
            </Box>

            {/* Servicio */}
            <Box icon={Package} titulo="Servicio">
              <Dato label="Plan">{svc?.planes?.nombre}</Dato>
              <Dato label="Proceso">{svc?.planes?.tipo_proceso ? svc.planes.tipo_proceso.replace(/_/g, ' ').toLowerCase() : null}</Dato>
              <Dato label="Acompañamiento">{svc?.tipo_acompanamiento ? svc.tipo_acompanamiento.toLowerCase() : null}</Dato>
              <Dato label="Canal de entrada">{svc?.canal_entrada ? svc.canal_entrada.replace(/_/g, ' ').toLowerCase() : null}</Dato>
              <Dato label="Aliado / Vet">{svc?.aliados?.nombre}</Dato>
              <Dato label="Modalidad comisión">{svc?.aliados?.modalidad_comision ? svc.aliados.modalidad_comision.replace(/_/g, ' ').toLowerCase() : null}</Dato>
              <Dato label="Técnico">{svc?.tecnico ? `${svc.tecnico.nombre} ${svc.tecnico.apellido || ''}`.trim() : null}</Dato>
              <Dato label="Registrado por">{svc?.registrador ? `${svc.registrador.nombre} ${svc.registrador.apellido || ''}`.trim() : null}</Dato>
              <Dato label="Registrado el">{svc?.created_at ? fmtDateTime(svc.created_at) : null}</Dato>
              <Dato label="Límite entrega">{svc?.fecha_limite_entrega ? fmtD(svc.fecha_limite_entrega) : null}</Dato>
              <Dato label="Código fotos">{svc?.codigo_fotos}</Dato>
              {/* Si ya cargó, la etapa de contacto sobra: no hay nada que perseguir. */}
              <Dato label="Fotos del cliente">
                {svc?.fecha_imagenes_recibidas
                  ? `recibidas ${fmtD(svc.fecha_imagenes_recibidas)}`
                  : `sin recibir · ${etapaContacto(contactos).texto}`}
              </Dato>
              {svc?.notas && <div className="text-[11px] text-gray-500 italic mt-1.5">"{svc.notas}"</div>}
            </Box>

            {/* Recogida */}
            <Box icon={MapPin} titulo="Recogida">
              <Dato label="Tipo de lugar">{(recogida?.tipo_lugar || svc?.punto_recogida || '').replace(/_/g, ' ').toLowerCase() || null}</Dato>
              <Dato label="Ciudad">{recogida?.ciudad || svc?.ciudad_recogida}</Dato>
              <Dato label="Dirección">{recogida?.direccion_recogida || svc?.direccion_recogida}</Dato>
              <Dato label="Barrio">{recogida?.barrio || svc?.barrio_recogida}</Dato>
              <Dato label="Contacto">{recogida?.contacto_nombre}</Dato>
              <Dato label="Tel. contacto">{recogida?.contacto_telefono}</Dato>
              <Dato label="Fecha programada">{recogida?.fecha_programada ? fmtD(recogida.fecha_programada) : null}</Dato>
              {/* Las horas viven en la Línea de tiempo (abajo), no repetidas aquí */}
              {(recogida?.notas || svc?.indicaciones_recogida) && (
                <div className="text-[11px] text-gray-500 italic mt-1.5">"{recogida?.notas || svc.indicaciones_recogida}"</div>
              )}
            </Box>

            {/* Todas las horas de la recogida, en orden */}
            <LineaTiempoServicio servicioId={servicioId} />

            {/* Cuarto frío */}
            {cf && (
              <Box icon={Snowflake} titulo="Cuarto frío">
                <Dato label="Nevera">{cf.nevera_codigo}</Dato>
                <Dato label="Posición">{cf.posicion}</Dato>
                <Dato label="Estado">{cf.estado ? cf.estado.replace(/_/g, ' ').toLowerCase() : null}</Dato>
                <Dato label="Peso báscula">{cf.peso_kg ? `${cf.peso_kg} kg` : null}</Dato>
                <Dato label="Registrado">{cf.created_at ? fmtTS(cf.created_at) : null}</Dato>
                <Dato label="Ingreso a la nevera">{cf.fecha_ingreso_real ? `${fmtTS(cf.fecha_ingreso_real)}${cf.registrador ? ` · ${cf.registrador.nombre}` : ''}` : null}</Dato>
                <Dato label="Salida">{cf.fecha_salida ? fmtD(cf.fecha_salida) : 'Aún en custodia'}</Dato>
              </Box>
            )}

            {/* Entrega */}
            {(entrega || datosEntregaCliente.length > 0) && (
              <Box icon={Truck} titulo="Entrega">
                <Dato label="Estado">{entrega?.estado ? entrega.estado.replace(/_/g, ' ').toLowerCase() : null}</Dato>
                <Dato label="Tipo">{entrega?.tipo_entrega ? entrega.tipo_entrega.replace(/_/g, ' ').toLowerCase() : null}</Dato>
                <Dato label="Mensajero">{entrega?.mensajero_nombre}</Dato>
                <Dato label="Programada">{entrega?.fecha_programada ? `${fmtD(entrega.fecha_programada)}${entrega.hora_programada ? ` · ${String(entrega.hora_programada).slice(0, 5)}` : ''}` : null}</Dato>
                <Dato label="La tomó">{entrega?.tomada_en ? new Date(entrega.tomada_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null}</Dato>
                <Dato label="Salió a entregar">{entrega?.aceptada_en ? new Date(entrega.aceptada_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null}</Dato>
                <Dato label="Realizada">{entrega?.fecha_realizada ? `${fmtD(entrega.fecha_realizada)}${entrega.hora_realizada ? ` · ${String(entrega.hora_realizada).slice(0, 5)}` : ''}` : null}</Dato>
                <Dato label="Dirección">{entrega?.direccion_entrega}</Dato>
                <Dato label="Ciudad">{entrega?.ciudad}</Dato>
                <Dato label="Barrio">{entrega?.barrio}</Dato>
                <Dato label="Localidad">{entrega?.localidad}</Dato>
                <Dato label="Contacto">{entrega?.contacto_nombre}</Dato>
                <Dato label="Tel. contacto">{entrega?.contacto_telefono}</Dato>
                <Dato label="Tel. adicional">{entrega?.telefono_adicional}</Dato>
                <Dato label="Horarios">{entrega?.horarios_atencion}</Dato>
                {(entrega?.valor_domicilio || 0) > 0 && <Dato label="Valor domicilio">{fmt(entrega.valor_domicilio)}</Dato>}
                <Dato label="Indicaciones">{entrega?.indicaciones}</Dato>
                <Dato label="Notas">{entrega?.notas}</Dato>
                {datosEntregaCliente.length > 0 && (
                  <div className="mt-1.5 rounded-lg bg-white border border-gray-200 px-2.5 py-1.5">
                    <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Datos que dejó el cliente en el portal</div>
                    {datosEntregaCliente.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2 text-[11px]">
                        <span className="text-gray-400">{k.replace(/_/g, ' ')}</span>
                        <span className="font-semibold text-gray-700 text-right">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Box>
            )}

            {/* Financiero */}
            <Box icon={CreditCard} titulo="Financiero">
              <Dato label="Valor total">{fmt(svc?.valor_total || 0)}</Dato>
              <Dato label="Pagado">{fmt(svc?.valor_pagado || 0)}</Dato>
              {saldo > 0 && <Dato label="Saldo pendiente"><span className="text-red-600">{fmt(saldo)}</span></Dato>}
              <Dato label="Método declarado">{svc?.metodo_pago}</Dato>
              {svc?.valor_plan != null && <Dato label="· Valor plan">{fmt(svc.valor_plan)}</Dato>}
              {(svc?.valor_adicionales || 0) > 0 && <Dato label="· Adicionales">{fmt(svc.valor_adicionales)}</Dato>}
              {(svc?.valor_transporte || 0) > 0 && <Dato label="· Transporte">{fmt(svc.valor_transporte)}</Dato>}
              {(svc?.recargo_nocturno || 0) > 0 && <Dato label="· Recargo nocturno/dominical">{fmt(svc.recargo_nocturno)}</Dato>}
              {(svc?.descuento_adicional || 0) > 0 && <Dato label="· Descuento">- {fmt(svc.descuento_adicional)}</Dato>}
              {(svc?.comision_aliado || 0) > 0 && (
                <Dato label="Comisión aliado">
                  {fmt(svc.comision_aliado)} {svc.comision_descontada ? '(descontada del recibo)' : '(se cuadra aparte)'}
                </Dato>
              )}
              <HistorialValor servicioId={svc?.id} valorTotal={svc?.valor_total} className="mt-2" />
            </Box>
          </div>

          {/* Ítems de producción */}
          {items.length > 0 && (
            <Box icon={Package} titulo={`Ítems del servicio (${items.length})`}>
              <div className="space-y-1">
                {items.map(it => {
                  const st = ITEM_ESTADO[it.estado] || ITEM_ESTADO.NA
                  return (
                    <div key={it.id} className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-0">
                      <span className="text-[11px] font-semibold text-gray-800 truncate">
                        {it.recordatorios?.nombre || 'Ítem'}{(it.cantidad || 1) > 1 ? ` × ${it.cantidad}` : ''}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {it.origen === 'ADICIONAL' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
                            Adicional{it.precio_cobrado ? ` · ${fmt(it.precio_cobrado)}` : ''}
                          </span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
                          {it.estado === 'NA' ? 'N/A' : (it.estado || '').replace(/_/g, ' ')}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </Box>
          )}

          {/* Recibos + comprobantes (cuál afecta Finanzas) */}
          <RecibosServicio servicioId={servicioId} onCambio={() => setRecarga(n => n + 1)} />

          {/* Evidencias */}
          {evidencias.length > 0 && (
            <Box icon={Camera} titulo="Evidencias del servicio">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {evidencias.map((ev, i) => (
                  <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
                    className="group relative rounded-lg overflow-hidden border block bg-white"
                    style={{ aspectRatio: '1/1', borderColor: '#E5E7EB' }} title={ev.label}>
                    <img src={ev.url} alt={ev.label} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <span className="absolute bottom-0 inset-x-0 text-[8px] font-semibold text-white bg-black/55 px-1 py-0.5 truncate">{ev.label}</span>
                  </a>
                ))}
              </div>
            </Box>
          )}

          {/* Trazabilidad completa */}
          <Box icon={Clock} titulo={`Trazabilidad (${novedades.length})`}>
            {novedades.length === 0 ? (
              <p className="text-[11px] text-gray-400">Sin novedades registradas.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {novedades.map(n => (
                  <div key={n.id} className="flex gap-2.5 text-[12px]">
                    <div className="flex flex-col items-center pt-1">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${n.tipo_novedad === 'PAGO_RECIBIDO' ? 'bg-green-500' : 'bg-[#1A5CD8]'}`} />
                      <div className="flex-1 w-px bg-gray-200 mt-1" />
                    </div>
                    <div className="flex-1 pb-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${n.tipo_novedad === 'PAGO_RECIBIDO' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700'}`}>{n.tipo_novedad}</span>
                        <span className="text-[10px] text-gray-400">{fmtTS(n.created_at)}</span>
                        {n.personal && <span className="text-[10px] text-gray-400">· {n.personal.nombre} {n.personal.apellido || ''}</span>}
                      </div>
                      <p className="text-gray-700 mt-0.5 text-[11px] leading-snug">{n.descripcion}{Number(n.valor_ajuste) ? ` (${fmt(n.valor_ajuste)})` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Box>
        </div>
      )}
    </Modal>
  )
}
