// Pestaña "Visitas" — agenda de visitas de clientes a la planta de Tenjo.
// El coordinador agenda (mascota + fecha + hora + novedades) y arma el mensaje
// para el grupo operativo (se puede enviar junto al de procesos de la jornada);
// el operario ve la agenda con el cubículo actual de cada mascota y marca la
// visita como realizada. El cubículo se deriva de la ocupación activa en
// lotes_tenjo_items — nunca se guarda en la visita.
import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, parsearErrorDB, today } from '@/lib/utils'
import { etiquetaCubiculo } from '@/lib/cubiculos'
import {
  cargarVisitasTenjo, crearVisitaTenjo, marcarVisitaTenjo, mensajeGrupoVisitas,
  fmtHoraVisita, VISITA_ESTADO_CFG, TIPO_PROCESO_LABEL,
} from '@/lib/tenjo'
import {
  CalendarPlus, Users, Copy, Check, CheckCircle2, Ban, Search,
  Send, AlertTriangle, Clock,
} from 'lucide-react'

const fmtFechaLarga = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  : '—'

function Chip({ cfg, fallback }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg?.bg || '#F3F4F6', color: cfg?.text || '#374151' }}>
      {cfg?.label || fallback}
    </span>
  )
}

export default function VisitasTab({ canPlan, personalData, onChanged }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [visitas,   setVisitas]   = useState(undefined)
  const [sinTabla,  setSinTabla]  = useState(false)
  const [saving,    setSaving]    = useState(false)

  const [modalNueva, setModalNueva] = useState(false)
  const [candidatos, setCandidatos] = useState(null) // mascotas en planta (null = cargando)
  const [busca,      setBusca]      = useState('')
  const [form,       setForm]       = useState({ servicio_id: '', fecha: '', hora: '', novedades: '' })

  const [modalCerrar, setModalCerrar] = useState(null) // visita a marcar realizada
  const [novCierre,   setNovCierre]   = useState('')
  const [modalGrupo,  setModalGrupo]  = useState(null) // { fecha, texto }
  const [copiado,     setCopiado]     = useState(false)

  const cargar = useCallback(async () => {
    try {
      setVisitas(await cargarVisitasTenjo())
      setSinTabla(false)
    } catch (e) {
      if (/does not exist|schema cache/i.test(e?.message || '')) { setSinTabla(true); setVisitas([]) }
      else { setVisitas([]); console.error('[visitas tenjo]', e?.message) }
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Mascotas que están (o estuvieron) en la planta: items de lote recibidos,
  // en proceso o procesados. Se deduplica por servicio prefiriendo el item con
  // cubículo activo (es el que dice dónde está físicamente la mascota).
  async function cargarCandidatos() {
    setCandidatos(null)
    const { data, error } = await db.from('lotes_tenjo_items')
      .select('id, servicio_id, estado, created_at, cubiculo_liberado_en, cubiculos(zona, talla, numero), '
        + 'servicios!inner(estado, fecha_ingreso, mascotas(nombre, peso_kg, especies(nombre), clientes(nombre, apellido, whatsapp)), planes(nombre, tipo_proceso))')
      .in('estado', ['RECIBIDA', 'EN_PROCESO', 'PROCESADO'])
      .gte('servicios.fecha_ingreso', FECHA_CORTE)
      .not('servicios.estado', 'in', '(ENTREGADO,CANCELADO)')
      .order('created_at', { ascending: false })
    if (error) { setCandidatos([]); console.error('[candidatos visita]', error.message); return }
    const porServicio = new Map()
    for (const it of (data || [])) {
      const enCubiculo = !!it.cubiculos && !it.cubiculo_liberado_en
      const previo = porServicio.get(it.servicio_id)
      if (!previo || (enCubiculo && !previo._enCubiculo)) {
        porServicio.set(it.servicio_id, { ...it, _enCubiculo: enCubiculo })
      }
    }
    setCandidatos([...porServicio.values()])
  }

  async function agendar() {
    if (!form.servicio_id) { await showAlert('Selecciona la mascota que van a visitar.', { title: 'Mascota requerida' }); return }
    if (!form.fecha) { await showAlert('Indica la fecha de la visita.', { title: 'Fecha requerida' }); return }
    setSaving(true)
    try {
      await crearVisitaTenjo({
        servicioId: form.servicio_id,
        fecha:      form.fecha,
        hora:       form.hora,
        novedades:  form.novedades,
        personalId: personalData?.id,
      })
      setModalNueva(false)
      setForm({ servicio_id: '', fecha: '', hora: '', novedades: '' })
      setBusca('')
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error agendando visita', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function marcarRealizada() {
    const v = modalCerrar
    if (!v) return
    setSaving(true)
    try {
      await marcarVisitaTenjo(v.id, { estado: 'REALIZADA', novedad: novCierre, personalId: personalData?.id })
      setModalCerrar(null); setNovCierre('')
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function cancelarVisita(v) {
    const m = v.servicios?.mascotas
    if (!await confirm(`Se cancelará la visita de ${m?.nombre || 'la mascota'} del ${fmtFechaLarga(v.fecha_visita)}.`,
      { title: '¿Cancelar visita?', variant: 'danger', confirmLabel: 'Cancelar visita' })) return
    setSaving(true)
    try {
      await marcarVisitaTenjo(v.id, { estado: 'CANCELADA', personalId: personalData?.id })
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  function abrirGrupo(fecha, lista) {
    setModalGrupo({ fecha, texto: mensajeGrupoVisitas({ fechaLarga: fmtFechaLarga(fecha), visitas: lista }) })
  }

  async function copiarGrupo() {
    try {
      await navigator.clipboard.writeText(modalGrupo?.texto || '')
      setCopiado(true); setTimeout(() => setCopiado(false), 2000)
    } catch {
      await showAlert('No se pudo copiar automáticamente. Selecciona y copia el texto manualmente.', { title: 'Copiar mensaje' })
    }
  }

  if (sinTabla) return (
    <div className="rounded-2xl border-2 p-5 flex items-start gap-3" style={{ borderColor: '#FCD34D', background: '#FFFBEB' }}>
      <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-[14px] font-semibold text-amber-900">Falta aplicar la migración 059 (visitas a la planta)</p>
        <p className="text-[12px] text-amber-800 mt-1">Aplica <code>migrations/059_tenjo_visitas.sql</code> en la base de datos para habilitar la agenda de visitas.</p>
      </div>
    </div>
  )
  if (visitas === undefined) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando visitas…</span></div>

  const hoy         = today()
  const programadas = visitas.filter(v => v.estado === 'PROGRAMADA')
  const proximas    = programadas.filter(v => v.fecha_visita >= hoy)
  const vencidas    = programadas.filter(v => v.fecha_visita < hoy)
  const historial   = visitas.filter(v => v.estado !== 'PROGRAMADA').slice(-15).reverse()

  // Agrupar las próximas por fecha (cada día tiene su propio mensaje al grupo)
  const porFecha = []
  for (const v of proximas) {
    const g = porFecha.find(x => x.fecha === v.fecha_visita)
    if (g) g.lista.push(v)
    else porFecha.push({ fecha: v.fecha_visita, lista: [v] })
  }

  // ── Render de una visita ──
  function VisitaRow({ v, mostrarFecha = false }) {
    const m  = v.servicios?.mascotas
    const cl = m?.clientes
    const rec = Array.isArray(v.servicios?.recogidas) ? v.servicios.recogidas[0] : v.servicios?.recogidas
    const contacto = cl?.whatsapp || rec?.contacto_telefono || null
    const proceso  = TIPO_PROCESO_LABEL[v.servicios?.planes?.tipo_proceso] || v.servicios?.planes?.nombre
    const cerrada  = v.estado !== 'PROGRAMADA'
    return (
      <div className="flex items-start gap-3 p-3.5 rounded-xl border hover:bg-surface2 transition-all"
        style={{ borderColor: 'rgba(30,80,40,0.1)', opacity: cerrada ? 0.75 : 1 }}>
        <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink">{m?.nombre || '—'}</span>
            <Chip cfg={VISITA_ESTADO_CFG[v.estado]} fallback={v.estado} />
            <span className="text-[11px] font-bold inline-flex items-center gap-1" style={{ color: '#5B21B6' }}>
              <Clock size={11} /> {fmtHoraVisita(v.hora_visita) || 'hora por confirmar'}
            </span>
            {mostrarFecha && <span className="text-[11px] text-ink3">{fmtFechaLarga(v.fecha_visita)}</span>}
          </div>
          <div className="text-[11px] text-ink3 mt-0.5">
            {cl?.nombre} {cl?.apellido}{proceso ? ` · ${proceso}` : ''}
            {contacto && ` · 📞 ${contacto}`}
          </div>
          {v.cubiculo ? (
            <div className="text-[11px] mt-0.5 font-medium" style={{ color: '#065F46' }}>
              🌿 Está en el cubículo <strong>{etiquetaCubiculo(v.cubiculo)}</strong>
            </div>
          ) : (
            <div className="text-[10px] text-ink3 mt-0.5">Sin cubículo activo (cremación o aún sin asignar)</div>
          )}
          {v.novedades && (
            <div className="text-[11px] text-ink2 mt-0.5 italic">📝 {v.novedades}</div>
          )}
          {v.novedad_cierre && (
            <div className="text-[11px] mt-0.5" style={{ color: '#92400E' }}>⚠ Cierre: {v.novedad_cierre}</div>
          )}
          {v.estado === 'REALIZADA' && v.realizador && (
            <div className="text-[10px] text-ink3 mt-0.5">
              ✓ Atendida por {v.realizador.nombre} {v.realizador.apellido}
              {v.realizada_en && ` · ${new Date(v.realizada_en).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            </div>
          )}
        </div>
        {!cerrada && (
          <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
            <Button size="sm" disabled={saving}
              onClick={() => { setModalCerrar(v); setNovCierre('') }}>
              <CheckCircle2 size={12} /> Realizada
            </Button>
            {canPlan && (
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => cancelarVisita(v)}>
                <Ban size={12} />
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  const nom = busca.trim().toLowerCase()
  const candidatosVisibles = (candidatos || []).filter(c => {
    if (!nom) return true
    const m = c.servicios?.mascotas
    return (m?.nombre || '').toLowerCase().includes(nom)
      || `${m?.clientes?.nombre || ''} ${m?.clientes?.apellido || ''}`.toLowerCase().includes(nom)
  }).slice(0, 30)

  return (
    <div className="space-y-5">
      {/* ── Encabezado ── */}
      <div className="rounded-2xl border-2 p-5 flex items-start gap-3" style={{ borderColor: '#C4B5FD', background: '#FBFAFF' }}>
        <span className="text-2xl">🚶</span>
        <div className="flex-1">
          <div className="font-semibold text-[15px] text-ink">
            Visitas a la planta
            {proximas.length > 0 && <span className="text-[12px] font-normal text-ink3 ml-2">{proximas.length} programada{proximas.length !== 1 ? 's' : ''}</span>}
          </div>
          <p className="text-[12px] text-ink2 mt-1">
            Agenda de clientes que vienen a visitar a su mascotica. El día de la visita el operario
            la ve aquí y en la Jornada, con el cubículo donde está la mascota.
          </p>
        </div>
        {canPlan && (
          <Button variant="gold" disabled={saving}
            onClick={() => { setModalNueva(true); setBusca(''); setForm({ servicio_id: '', fecha: '', hora: '', novedades: '' }); cargarCandidatos() }}>
            <CalendarPlus size={13} /> Agendar visita
          </Button>
        )}
      </div>

      {/* ── Programadas de fechas pasadas sin cerrar ── */}
      {vencidas.length > 0 && (
        <div className="bg-surface border-2 rounded-2xl shadow-sm" style={{ borderColor: '#FCD34D' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(252,211,77,0.4)' }}>
            <AlertTriangle size={15} className="text-amber-600" />
            <div className="font-semibold text-[15px] text-ink flex-1">Visitas pasadas sin cerrar</div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>{vencidas.length}</span>
          </div>
          <div className="p-4 space-y-2.5">
            {vencidas.map(v => <VisitaRow key={v.id} v={v} mostrarFecha />)}
          </div>
        </div>
      )}

      {/* ── Próximas, agrupadas por día ── */}
      {porFecha.length === 0 && vencidas.length === 0 ? (
        <div className="bg-surface border rounded-2xl py-12 text-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="text-3xl mb-2">🚶</div>
          <p className="text-[14px] font-semibold text-ink2">No hay visitas programadas</p>
          {canPlan && <p className="text-[12px] text-ink3 mt-1">Usa "Agendar visita" para programar la primera.</p>}
        </div>
      ) : porFecha.map(g => (
        <div key={g.fecha} className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="font-semibold text-[15px] text-ink flex-1">
              {g.fecha === hoy ? '📍 Hoy — ' : ''}{fmtFechaLarga(g.fecha)}
              <span className="text-[11px] font-normal text-ink3 ml-2">{g.lista.length} visita{g.lista.length !== 1 ? 's' : ''}</span>
            </div>
            <Button size="sm" variant="gold" onClick={() => abrirGrupo(g.fecha, g.lista)}>
              <Users size={12} /> Mensaje al grupo
            </Button>
          </div>
          <div className="p-4 space-y-2.5">
            {g.lista.map(v => <VisitaRow key={v.id} v={v} />)}
          </div>
        </div>
      ))}

      {/* ── Historial ── */}
      {historial.length > 0 && (
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="font-semibold text-[15px] text-ink">Historial reciente</div>
          </div>
          <div className="p-4 space-y-2.5">
            {historial.map(v => <VisitaRow key={v.id} v={v} mostrarFecha />)}
          </div>
        </div>
      )}

      {/* ── Modal agendar visita ── */}
      {modalNueva && (
        <Modal open onClose={() => setModalNueva(false)}
          title="Agendar visita a la planta" maxWidth="max-w-lg"
          footer={<>
            <Button variant="secondary" onClick={() => setModalNueva(false)}>Cancelar</Button>
            <Button onClick={agendar} disabled={saving || !form.servicio_id || !form.fecha}>
              {saving ? 'Guardando…' : 'Agendar visita'}
            </Button>
          </>}>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Mascota a visitar *</label>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar mascota o cliente…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-[13px] outline-none focus:border-[#3D5A27]" />
              </div>
              {candidatos === null ? (
                <div className="py-6 text-center text-[12px] text-ink3">Cargando mascotas en planta…</div>
              ) : candidatosVisibles.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-ink3">
                  {nom ? 'Ninguna mascota coincide con la búsqueda.' : 'No hay mascotas en planta (recibidas, en proceso o procesadas).'}
                </div>
              ) : (
                <div className="max-h-[38vh] overflow-y-auto space-y-1.5 pr-1">
                  {candidatosVisibles.map(c => {
                    const m = c.servicios?.mascotas
                    const sel = form.servicio_id === c.servicio_id
                    return (
                      <button key={c.servicio_id} type="button"
                        onClick={() => setForm(p => ({ ...p, servicio_id: c.servicio_id }))}
                        className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${sel ? 'border-[#3D5A27] bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <span className="text-xl">{petEmoji(m?.especies?.nombre)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-ink text-[13px]">{m?.nombre || '—'}</div>
                          <div className="text-[10px] text-ink3 truncate">
                            {m?.clientes?.nombre} {m?.clientes?.apellido} · {c.servicios?.planes?.nombre}
                          </div>
                          {c._enCubiculo && c.cubiculos && (
                            <div className="text-[10px] font-medium" style={{ color: '#065F46' }}>
                              🌿 Cubículo {etiquetaCubiculo(c.cubiculos)}
                            </div>
                          )}
                        </div>
                        {sel && <Check size={16} className="text-green-700 flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Fecha de la visita *</label>
                <Input type="date" min={today()} value={form.fecha}
                  onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Hora</label>
                <Input type="time" value={form.hora}
                  onChange={e => setForm(p => ({ ...p, hora: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Novedades / indicaciones</label>
              <Textarea value={form.novedades}
                onChange={e => setForm(p => ({ ...p, novedades: e.target.value }))}
                placeholder="Ej: vienen 3 personas, quieren llevar flores, avisar al llegar…" />
              <p className="text-[10px] text-ink3 mt-1">El operario las ve en la agenda y salen en el mensaje del grupo.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal marcar realizada ── */}
      {modalCerrar && (
        <Modal open onClose={() => setModalCerrar(null)}
          title={`Visita realizada — ${modalCerrar.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setModalCerrar(null)}>Cancelar</Button>
            <Button onClick={marcarRealizada} disabled={saving}>{saving ? 'Guardando…' : 'Marcar realizada'}</Button>
          </>}>
          <div className="space-y-4">
            <p className="text-[12px] text-ink2">Se sella la hora y quién atendió la visita.</p>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Novedad de la visita (opcional)</label>
              <Textarea value={novCierre} onChange={e => setNovCierre(e.target.value)}
                placeholder="Ej: la familia pidió fotos del cubículo…" />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal mensaje al grupo ── */}
      {modalGrupo && (
        <Modal open onClose={() => setModalGrupo(null)}
          title={`Mensaje al grupo — visitas del ${fmtFechaLarga(modalGrupo.fecha)}`}
          maxWidth="max-w-lg"
          footer={<Button variant="secondary" onClick={() => setModalGrupo(null)}>Cerrar</Button>}>
          <div className="space-y-4">
            <p className="text-[12px] text-ink2">
              Usa <strong>Reenviar</strong> para abrir WhatsApp y elegir el grupo, o <strong>Copiar</strong> para
              pegarlo junto al mensaje de procesos de la jornada.
            </p>
            <Textarea rows={12} value={modalGrupo.texto} readOnly className="font-mono text-[12px]" />
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(modalGrupo.texto)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white"
                style={{ background: '#25D366' }}>
                <Send size={13} /> Reenviar a un grupo
              </a>
              <Button size="sm" variant="secondary" onClick={copiarGrupo}>
                {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar mensaje</>}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
