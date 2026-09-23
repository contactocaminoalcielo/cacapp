// Pestaña "Salidas" — el cierre físico del compostaje.
//
// Dos listas, que es como se trabaja en planta:
//   · POR SACAR — ya se cumplió su tiempo (ingreso + 2, 2.5 o 3 meses, según el
//     cubículo) y la mascota sigue adentro. Es la lista de trabajo del día.
//   · YA SALIERON — con su fecha de salida, corregible.
//
// La fecha de salida no es decorativa: de ella cuelgan los días hábiles de
// entrega de los recordatorios de los compostajes que la familia pidió recibir
// "todos al final" (migración 155). Por eso se puede corregir: si la mascota
// salió el viernes y se registró el lunes, el compromiso con la familia cambia.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { StatCard } from '@/components/ui/card'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import {
  cargarSalidasCompostaje, liberarCubiculo, actualizarFechaSalida, programarSalida,
  etiquetaCubiculo, zonaCfg, mensajeErrorCubiculo,
} from '@/lib/cubiculos'
import { generarPdfSalidas, textoSalidasWa } from '@/lib/salidasCompostajePdf'
import { petEmoji, parsearErrorDB, hoyLocalISO } from '@/lib/utils'
import {
  Leaf, LogOut, FileDown, MessageCircle, RefreshCw, CalendarClock, Pencil, AlertTriangle,
  CalendarPlus, Undo2,
} from 'lucide-react'

const fmt = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

// Por defecto la lista de "ya salieron" muestra los últimos 60 días: es el
// horizonte en que todavía se corrige algo. El rango se puede abrir a mano.
const desdePorDefecto = () => {
  const d = new Date(); d.setDate(d.getDate() - 60)
  return hoyLocalISO(d)
}

const diasDesde = fecha => {
  if (!fecha) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  return Math.round((hoy - new Date(fecha + 'T12:00:00')) / 86400000)
}

function Cubiculo({ item }) {
  if (item.cubiculos) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-[11px]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: zonaCfg(item.cubiculos.zona).color }} />
        {etiquetaCubiculo(item.cubiculos)}
      </span>
    )
  }
  return <span className="font-mono text-[11px] text-ink3">{item.cubiculo_codigo || '—'}</span>
}

function Mascota({ item }) {
  const m = item.servicios?.mascotas
  const c = m?.clientes
  return (
    <div className="flex items-center gap-2">
      <span>{petEmoji(m?.especies?.nombre)}</span>
      <div className="min-w-0">
        <div className="font-semibold text-ink truncate">{m?.nombre || '—'}</div>
        <div className="text-[10px] text-ink3 truncate">{[c?.nombre, c?.apellido].filter(Boolean).join(' ')}</div>
      </div>
    </div>
  )
}

// Cómo se le entregan los recordatorios a esta familia. Cambia el significado
// de la fecha de salida, así que se dice en la tabla y no en una nota al pie.
function ChipEntrega({ item }) {
  const anticipados = item.servicios?.recordatorios_anticipados
  if (anticipados === true) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ background: '#DCFCE7', color: '#15803D' }} title="La familia los pidió cuanto antes: su plazo cuenta desde las imágenes, no desde esta salida.">
        ⚡ Anticipados
      </span>
    )
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: '#FFFBEB', color: '#92400E' }}
      title={anticipados === false
        ? 'La familia prefiere recibirlos todos al final: el plazo arranca el día que la mascota sale del cubículo.'
        : 'La familia no respondió cuándo los quiere; se tratan como "al final": el plazo arranca con la salida.'}>
      ⏳ Al final
    </span>
  )
}

// Bajar el PDF y compartir el listado. wa.me NO adjunta archivos: por el enlace
// viaja el texto (`textoSalidasWa`) y el PDF se adjunta a mano si hace falta.
// Mismo patrón que el mensaje al grupo de Jornada y Visitas.
function Acciones({ tipo, items }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="secondary" disabled={!items.length}
        onClick={() => generarPdfSalidas(tipo, items)}>
        <FileDown size={12} className="mr-1" /> PDF
      </Button>
      <a href={`https://wa.me/?text=${encodeURIComponent(textoSalidasWa(tipo, items))}`}
        target="_blank" rel="noreferrer"
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-colors ${
          items.length ? '' : 'pointer-events-none opacity-40'}`}
        style={{ background: '#25D366' }}>
        <MessageCircle size={12} /> WhatsApp
      </a>
    </div>
  )
}

export default function SalidasTab({ canPlan = false, personalData = null, onChanged }) {
  const { alert: showAlert } = useConfirm()
  const [datos,   setDatos]   = useState(null)   // null = cargando
  const [error,   setError]   = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [desde,   setDesde]   = useState(desdePorDefecto)
  const [sel,     setSel]     = useState(() => new Set())
  const [modalSacar,  setModalSacar]  = useState(null)  // { items: [] }
  const [modalFecha,  setModalFecha]  = useState(null)  // item a corregir
  const [fechaForm,   setFechaForm]   = useState('')
  const [modalAplazar, setModalAplazar] = useState(null) // { items: [] }
  const [motivoForm,   setMotivoForm]   = useState('')

  const cargar = useCallback(async () => {
    try {
      const d = await cargarSalidasCompostaje({ desde })
      setDatos(d); setError(null); setSel(new Set())
    } catch (e) {
      const falta = /cubiculo_salida|salida_programada|capacidad|schema cache|does not exist/i.test(e?.message || '')
      setError(falta
        ? 'Falta aplicar una migración (155 o 172, en migrations/) en esta base de datos.'
        : parsearErrorDB(e))
      setDatos({ porSacar: [], aplazadas: [], enCurso: [], sinFecha: [], salieron: [] })
    }
  }, [desde])

  useEffect(() => { cargar() }, [cargar])

  const porSacar  = datos?.porSacar  || []
  const salieron  = datos?.salieron  || []
  const enCurso   = datos?.enCurso   || []
  const aplazadas = datos?.aplazadas || []
  // Dentro del cubículo pero sin fecha de ingreso: no cumplen "ya les tocó"
  // NUNCA, así que si no se muestran aquí no aparecen en ningún sitio.
  const sinFecha = datos?.sinFecha || []

  const seleccionados = useMemo(() => porSacar.filter(it => sel.has(it.id)), [porSacar, sel])

  function alternar(id) {
    setSel(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function abrirSacar(items) {
    if (!items.length) return
    setFechaForm(hoyLocalISO())
    setModalSacar({ items })
  }

  async function confirmarSacar() {
    const items = modalSacar?.items || []
    if (!items.length || !fechaForm) return
    setSaving(true)
    const fallidas = []
    try {
      for (const it of items) {
        try { await liberarCubiculo(it.id, personalData?.id, fechaForm) }
        catch (e) { fallidas.push(`${it.servicios?.mascotas?.nombre || 'Una mascota'}: ${mensajeErrorCubiculo(e)}`) }
      }
      setModalSacar(null)
      await cargar(); onChanged?.()
      if (fallidas.length) {
        await showAlert(fallidas.join('\n'), { title: 'Algunas no se pudieron sacar', variant: 'danger' })
      }
    } finally { setSaving(false) }
  }

  function abrirAplazar(items) {
    if (!items.length) return
    // Mañana por defecto: aplazar "para hoy" no la saca de la lista y confunde.
    const d = new Date(); d.setDate(d.getDate() + 1)
    setFechaForm(items.length === 1 && items[0].salida_programada
      ? items[0].salida_programada : hoyLocalISO(d))
    setMotivoForm(items.length === 1 ? (items[0].salida_programada_motivo || '') : '')
    setModalAplazar({ items })
  }

  async function confirmarAplazar() {
    const items = modalAplazar?.items || []
    if (!items.length || !fechaForm) return
    setSaving(true)
    try {
      for (const it of items) {
        await programarSalida(it.id, fechaForm, motivoForm, personalData?.id)
      }
      setModalAplazar(null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo aplazar', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function quitarAplazamiento(it) {
    setSaving(true)
    try {
      await programarSalida(it.id, null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo quitar', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function guardarFecha() {
    if (!modalFecha || !fechaForm) return
    setSaving(true)
    try {
      await actualizarFechaSalida(modalFecha.id, fechaForm)
      setModalFecha(null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo cambiar la fecha', variant: 'danger' })
    } finally { setSaving(false) }
  }

  if (datos === null) {
    return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando salidas…</span></div>
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Por sacar hoy" value={porSacar.length} valueColor={porSacar.length > 0 ? '#C03030' : '#9CA3AF'} />
        <StatCard label="Aplazadas" value={aplazadas.length} valueColor={aplazadas.length > 0 ? '#9A5500' : '#9CA3AF'} />
        <StatCard label="Aún en compostaje" value={enCurso.length} valueColor="#1D8A55" />
        <StatCard label="Salieron en el rango" value={salieron.length} valueColor="#3B6FBF" />
        <StatCard label="Seleccionadas" value={seleccionados.length} valueColor={seleccionados.length > 0 ? '#9A5500' : '#9CA3AF'} />
      </div>

      {/* ── SIN FECHA DE INGRESO ──
          Estas no cumplen "ya les tocó" jamás: se quedarían en el cubículo sin
          salir nunca en la hoja de trabajo. Se muestran para que se corrijan. */}
      {sinFecha.length > 0 && (
        <div className="rounded-2xl border-2 p-4" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: '#92400E' }} />
            <div className="min-w-0">
              <div className="font-semibold text-[13px]" style={{ color: '#92400E' }}>
                {sinFecha.length} {sinFecha.length === 1 ? 'mascota está' : 'mascotas están'} en cubículo sin fecha de ingreso
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: '#78350F' }}>
                Sin esa fecha no se puede calcular cuándo cumplen, así que nunca aparecerán
                en «Por sacar». Corrígela en Tenjo → Jornada para que entren en la cola.
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {sinFecha.map(it => (
                  <span key={it.id} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: '#FEF3C7', color: '#92400E' }}>
                    {it.servicios?.mascotas?.nombre || 'Sin nombre'}
                    {it.cubiculos?.codigo ? ` · ${it.cubiculos.codigo}` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── POR SACAR ── */}
      <div className="bg-surface border-2 rounded-2xl shadow-sm"
        style={{ borderColor: porSacar.length > 0 ? '#86EFAC' : 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
          <Leaf size={15} style={{ color: '#15803D' }} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] text-ink">Por sacar del cubículo</div>
            <div className="text-[11px] text-ink3 mt-0.5">
              Ya cumplieron su tiempo de compostaje y siguen adentro.
            </div>
          </div>
          <Acciones tipo="POR_SACAR" items={porSacar} />
          <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar} title="Actualizar">
            <RefreshCw size={15} />
          </button>
        </div>

        {porSacar.length === 0 ? (
          <div className="py-10 text-center text-ink3 text-sm">
            Ninguna mascota cumplida esperando salir. {enCurso.length > 0 && `Hay ${enCurso.length} todavía en proceso.`}
          </div>
        ) : (
          <>
            <div className="px-5 py-2.5 flex items-center gap-2 flex-wrap border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
              <button className="text-[11px] font-semibold text-ink3 hover:text-primary-dark"
                onClick={() => setSel(sel.size === porSacar.length ? new Set() : new Set(porSacar.map(i => i.id)))}>
                {sel.size === porSacar.length ? 'Quitar selección' : 'Seleccionar todas'}
              </button>
              <div className="flex-1" />
              <Button size="sm" variant="secondary" disabled={!seleccionados.length || saving}
                onClick={() => abrirAplazar(seleccionados)}>
                <CalendarPlus size={12} className="mr-1" />
                Aplazar {seleccionados.length || ''}
              </Button>
              <Button size="sm" disabled={!seleccionados.length || saving}
                onClick={() => abrirSacar(seleccionados)}>
                <LogOut size={12} className="mr-1" />
                Sacar {seleccionados.length || ''} del cubículo
              </Button>
            </div>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8"></Th>
                    <Th>Mascota</Th>
                    <Th>Cubículo</Th>
                    <Th>Ingresó</Th>
                    <Th>Se cumplió</Th>
                    <Th>Recordatorios</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {porSacar.map(it => {
                    const atraso = diasDesde(it.fechaCumple)
                    return (
                      <Tr key={it.id}>
                        <Td>
                          <input type="checkbox" className="accent-emerald-600"
                            checked={sel.has(it.id)} onChange={() => alternar(it.id)} />
                        </Td>
                        <Td><Mascota item={it} /></Td>
                        <Td><Cubiculo item={it} /></Td>
                        <Td className="text-ink3 text-[11px]">{fmt(it.fecha_compostaje_inicio)}</Td>
                        <Td className="text-[11px]">
                          <span className="font-medium text-ink2">{fmt(it.fechaCumple)}</span>
                          {atraso > 0 && (
                            <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: atraso > 7 ? '#FEE2E2' : '#FEF3C7', color: atraso > 7 ? '#B91C1C' : '#92400E' }}>
                              hace {atraso} d
                            </span>
                          )}
                        </Td>
                        <Td><ChipEntrega item={it} /></Td>
                        <Td>
                          <div className="flex items-center gap-1.5 justify-end">
                            <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2"
                              disabled={saving} title="Aplazar la salida a otra fecha"
                              onClick={() => abrirAplazar([it])}>
                              <CalendarPlus size={14} />
                            </button>
                            <Button size="sm" variant="secondary" disabled={saving}
                              onClick={() => abrirSacar([it])}>
                              <LogOut size={12} className="mr-1" /> Sacar
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </>
        )}
      </div>

      {/* ── APLAZADAS ──
          El operario les puso una fecha futura: no salen en «Por sacar» ni en
          su PDF hasta que llegue. El motivo va en la tabla, no en un tooltip:
          el siguiente turno tiene que saber por qué Dallas sigue adentro. */}
      {aplazadas.length > 0 && (
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: '#FDE68A' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: '#FDE68A' }}>
            <CalendarPlus size={15} style={{ color: '#9A5500' }} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px] text-ink">Salida aplazada</div>
              <div className="text-[11px] text-ink3 mt-0.5">
                Saldrán en la fecha que decidió el operario. Ese día pasan solas a «Por sacar».
              </div>
            </div>
            <Acciones tipo="APLAZADAS" items={aplazadas} />
          </div>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Cubículo</Th>
                  <Th>Ingresó</Th>
                  <Th>Se cumple</Th>
                  <Th>Saldrá</Th>
                  <Th>Motivo</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {aplazadas.map(it => (
                  <Tr key={it.id}>
                    <Td><Mascota item={it} /></Td>
                    <Td><Cubiculo item={it} /></Td>
                    <Td className="text-ink3 text-[11px]">{fmt(it.fecha_compostaje_inicio)}</Td>
                    <Td className="text-ink3 text-[11px]">{fmt(it.fechaCumple)}</Td>
                    <Td className="text-[11px]">
                      <span className="font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: '#FEF3C7', color: '#92400E' }}>
                        {fmt(it.salida_programada)}
                      </span>
                    </Td>
                    <Td className="text-[11px] text-ink2 max-w-[220px]">
                      <span className="line-clamp-2">{it.salida_programada_motivo || '—'}</span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button size="sm" variant="secondary" disabled={saving}
                          onClick={() => abrirAplazar([it])}>
                          <Pencil size={12} className="mr-1" /> Fecha
                        </Button>
                        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2"
                          disabled={saving} title="Quitar el aplazamiento: vuelve a la regla general"
                          onClick={() => quitarAplazamiento(it)}>
                          <Undo2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      )}

      {/* ── YA SALIERON ── */}
      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <CalendarClock size={15} className="text-ink3" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] text-ink">Ya salieron del cubículo</div>
            <div className="text-[11px] text-ink3 mt-0.5">
              La fecha de salida abre los días hábiles de entrega de los recordatorios de las que esperan al final.
            </div>
          </div>
          <label className="text-[11px] text-ink3 font-semibold">Desde</label>
          <Input type="date" className="w-36" value={desde} max={hoyLocalISO()}
            onChange={e => setDesde(e.target.value)} />
          <Acciones tipo="SALIERON" items={salieron} />
        </div>

        {salieron.length === 0 ? (
          <div className="py-10 text-center text-ink3 text-sm">Ninguna salida registrada desde {fmt(desde)}.</div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Cubículo</Th>
                  <Th>Salió</Th>
                  <Th>Recordatorios</Th>
                  <Th>Entrega máxima</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {salieron.map(it => (
                  <Tr key={it.id}>
                    <Td><Mascota item={it} /></Td>
                    <Td><Cubiculo item={it} /></Td>
                    <Td className="text-[11px] font-medium text-ink2">{fmt(it.cubiculo_salida)}</Td>
                    <Td><ChipEntrega item={it} /></Td>
                    <Td className="text-[11px] font-medium text-ink2">
                      {fmt(it.servicios?.fecha_limite_entrega)}
                    </Td>
                    <Td>
                      {canPlan && (
                        <Button size="sm" variant="secondary" disabled={saving}
                          onClick={() => { setModalFecha(it); setFechaForm(it.cubiculo_salida || hoyLocalISO()) }}>
                          <Pencil size={12} className="mr-1" /> Fecha
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>

      {/* ── Modal: sacar del cubículo ── */}
      {modalSacar && (
        <Modal open onClose={() => setModalSacar(null)} maxWidth="max-w-md"
          title={modalSacar.items.length === 1
            ? `Sacar ${modalSacar.items[0].servicios?.mascotas?.nombre || 'del cubículo'}`
            : `Sacar ${modalSacar.items.length} mascotas del cubículo`}
          footer={<>
            <Button variant="secondary" onClick={() => setModalSacar(null)}>Cancelar</Button>
            <Button onClick={confirmarSacar} disabled={saving || !fechaForm}>
              {saving ? 'Registrando…' : 'Registrar salida'}
            </Button>
          </>}>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Fecha real de salida</label>
              <Input type="date" max={hoyLocalISO()} value={fechaForm}
                onChange={e => setFechaForm(e.target.value)} />
              <p className="text-[11px] text-ink3 mt-1.5">
                Pon el día en que la mascota salió de verdad, no el día en que lo registras. De esa fecha
                arrancan los días hábiles de entrega de los recordatorios de quien los espera al final.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 max-h-48 overflow-y-auto space-y-1.5">
              {modalSacar.items.map(it => (
                <div key={it.id} className="flex items-center gap-2 text-[12px]">
                  <span>{petEmoji(it.servicios?.mascotas?.especies?.nombre)}</span>
                  <span className="font-semibold text-ink flex-1 truncate">{it.servicios?.mascotas?.nombre || '—'}</span>
                  <Cubiculo item={it} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink3">
              El cubículo queda libre para otra mascota.
            </p>
          </div>
        </Modal>
      )}

      {/* ── Modal: aplazar / programar la salida ── */}
      {modalAplazar && (
        <Modal open onClose={() => setModalAplazar(null)} maxWidth="max-w-md"
          title={modalAplazar.items.length === 1
            ? `Aplazar la salida de ${modalAplazar.items[0].servicios?.mascotas?.nombre || 'la mascota'}`
            : `Aplazar la salida de ${modalAplazar.items.length} mascotas`}
          footer={<>
            <Button variant="secondary" onClick={() => setModalAplazar(null)}>Cancelar</Button>
            <Button onClick={confirmarAplazar} disabled={saving || !fechaForm}>
              {saving ? 'Guardando…' : 'Aplazar salida'}
            </Button>
          </>}>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Saldrá el</label>
              <Input type="date" min={hoyLocalISO()} value={fechaForm}
                onChange={e => setFechaForm(e.target.value)} />
              <p className="text-[11px] text-ink3 mt-1.5">
                Hasta ese día no aparece en «Por sacar» ni en el PDF del recorte. Ese día
                vuelve sola a la lista. Esto no registra la salida: al sacarla se pone la
                fecha real, como siempre.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Motivo</label>
              <Input value={motivoForm} maxLength={300}
                placeholder="Ej: le falta tiempo · la familia pide una última visita"
                onChange={e => setMotivoForm(e.target.value)} />
              <p className="text-[11px] text-ink3 mt-1.5">
                Queda en la lista de aplazadas para que el siguiente turno sepa por qué.
              </p>
            </div>
            {modalAplazar.items.length > 1 && (
              <div className="rounded-xl border border-gray-200 p-3 max-h-40 overflow-y-auto space-y-1.5">
                {modalAplazar.items.map(it => (
                  <div key={it.id} className="flex items-center gap-2 text-[12px]">
                    <span>{petEmoji(it.servicios?.mascotas?.especies?.nombre)}</span>
                    <span className="font-semibold text-ink flex-1 truncate">{it.servicios?.mascotas?.nombre || '—'}</span>
                    <Cubiculo item={it} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Modal: corregir la fecha de salida ── */}
      {modalFecha && (
        <Modal open onClose={() => setModalFecha(null)} maxWidth="max-w-sm"
          title={`Fecha de salida — ${modalFecha.servicios?.mascotas?.nombre || ''}`}
          footer={<>
            <Button variant="secondary" onClick={() => setModalFecha(null)}>Cancelar</Button>
            <Button onClick={guardarFecha} disabled={saving || !fechaForm}>
              {saving ? 'Guardando…' : 'Guardar fecha'}
            </Button>
          </>}>
          <div className="space-y-3">
            <Input type="date" max={hoyLocalISO()} value={fechaForm}
              onChange={e => setFechaForm(e.target.value)} />
            {modalFecha.servicios?.recordatorios_anticipados !== true ? (
              <p className="text-[11px] text-ink3">
                Al guardar se recalcula la fecha máxima de entrega de los recordatorios
                ({modalFecha.servicios?.planes?.dias_entrega_prometidos ?? 8} días hábiles desde esta fecha,
                sin contar fines de semana ni festivos).
              </p>
            ) : (
              <p className="text-[11px] text-ink3">
                Esta familia pidió los recordatorios anticipados, así que su fecha de entrega no depende
                de esta salida: cuenta desde que llegaron las imágenes.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
