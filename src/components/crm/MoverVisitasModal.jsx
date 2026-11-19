// Corregir la fecha de visitas ya registradas — una sola o varias a la vez.
// Nació porque las visitas de octubre quedaron todas el 3-nov (el formulario de
// «Registrar visita» fijaba la fecha de hoy) y había que repartirlas en sus días.
// No cambia el estado: una visita hecha sigue hecha (≠ «Mover», que reprograma).
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { crm, aInputFechaHora, desdeInputFechaHora } from '@/lib/crmApi'
import { hoyLocalISO } from '@/lib/utils'
import { Campo, ACENTO } from './ui'

// Lunes primero, que es como piensa la semana quien sale a visitar.
const DIAS_SEMANA = [
  { n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mié' }, { n: 4, l: 'Jue' },
  { n: 5, l: 'Vie' }, { n: 6, l: 'Sáb' }, { n: 0, l: 'Dom' },
]
const HORA_INICIO = 9 * 60      // primera visita del día: 9:00
const PASO_MIN = 90             // las siguientes, cada hora y media
const HORA_TOPE = 18 * 60

const p2 = n => String(n).padStart(2, '0')
const aMinutos = min => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`

/** Días entre dos fechas ISO (incluidas) que caen en los días de la semana elegidos. */
function diasHabiles(desde, hasta, semana) {
  if (!desde || !hasta || desde > hasta) return []
  const out = []
  const d = new Date(desde + 'T12:00:00')
  const fin = new Date(hasta + 'T12:00:00')
  while (d <= fin && out.length < 400) {
    if (semana.includes(d.getDay())) out.push(hoyLocalISO(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Mes anterior al de la fecha dada: el caso típico es "lo registré tarde, fue el mes pasado". */
function mesAnterior(isoDia) {
  const base = isoDia ? new Date(isoDia + 'T12:00:00') : new Date()
  const ini = new Date(base.getFullYear(), base.getMonth() - 1, 1)
  const fin = new Date(base.getFullYear(), base.getMonth(), 0)
  return { desde: hoyLocalISO(ini), hasta: hoyLocalISO(fin) }
}

function etiquetaDia(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function MoverVisitasModal({ abierto, onCerrar, visitas = [], diaOrigen = null, onGuardado }) {
  const varias = visitas.length > 1
  const [modo, setModo] = useState('repartir')    // 'repartir' | 'una'
  const [fechaHora, setFechaHora] = useState('')  // una sola visita
  const [dia, setDia] = useState('')              // varias → todas a un día
  const [rango, setRango] = useState({ desde: '', hasta: '' })
  const [semana, setSemana] = useState([1, 2, 3, 4, 5])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setError(null); setGuardando(false); setModo('repartir'); setSemana([1, 2, 3, 4, 5])
    setRango(mesAnterior(diaOrigen))
    setDia(mesAnterior(diaOrigen).hasta)
    setFechaHora(visitas[0] ? aInputFechaHora(visitas[0].programado_para) : '')
  }, [abierto, diaOrigen, visitas])

  const ordenadas = useMemo(() => [...visitas].sort((a, b) =>
    new Date(a.programado_para) - new Date(b.programado_para)), [visitas])

  const dias = useMemo(() => diasHabiles(rango.desde, rango.hasta, semana), [rango, semana])

  // Reparto parejo y en bloques: la visita i cae en el día ⌊i·M/N⌋, con horas escalonadas.
  const plan = useMemo(() => {
    if (!varias) return []
    if (modo === 'una') {
      if (!dia) return []
      return ordenadas.map(v => {
        const o = new Date(v.programado_para)
        return { v, dia, hora: `${p2(o.getHours())}:${p2(o.getMinutes())}` }
      })
    }
    if (!dias.length) return []
    const enDia = {}
    return ordenadas.map((v, i) => {
      const d = dias[Math.floor(i * dias.length / ordenadas.length)]
      const k = enDia[d] = (enDia[d] ?? -1) + 1
      return { v, dia: d, hora: aMinutos(Math.min(HORA_INICIO + k * PASO_MIN, HORA_TOPE)) }
    })
  }, [varias, modo, dia, dias, ordenadas])

  const porDia = useMemo(() => {
    const m = new Map()
    for (const x of plan) m.set(x.dia, [...(m.get(x.dia) || []), x])
    return [...m.entries()]
  }, [plan])

  function toggleDia(n) {
    setSemana(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n])
  }

  async function guardar() {
    setError(null)
    let cambios
    if (!varias) {
      if (!fechaHora) { setError('Elige la fecha'); return }
      cambios = [{ id: visitas[0].id, programado_para: desdeInputFechaHora(fechaHora) }]
    } else {
      if (!plan.length) { setError(modo === 'una' ? 'Elige el día' : 'No hay días en ese rango con los días de la semana elegidos'); return }
      cambios = plan.map(x => ({ id: x.v.id, programado_para: new Date(`${x.dia}T${x.hora}:00`).toISOString() }))
    }
    setGuardando(true)
    try {
      await crm.moverSeguimientos(cambios)
      onGuardado?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  const nombre = v => v.aliado_nombre || v.prospecto_nombre || '—'

  return (
    <Modal open={abierto} onClose={onCerrar} maxWidth="max-w-lg"
      title={varias ? `Cambiar la fecha de ${visitas.length} visitas` : 'Cambiar la fecha de la visita'}
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : varias ? `Mover ${visitas.length} visitas` : 'Guardar fecha'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">
        <p className="text-[12px] text-gray-500">
          Sirve para corregir cuándo se hizo (o se hará) la visita. No cambia su estado: las realizadas siguen realizadas.
        </p>

        {!varias ? (
          <>
            <div className="text-[13px] font-semibold text-gray-900">{visitas[0] && nombre(visitas[0])}</div>
            <Campo label="Fecha y hora">
              <Input type="datetime-local" value={fechaHora} onChange={e => setFechaHora(e.target.value)} />
            </Campo>
          </>
        ) : (
          <>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-[12.5px] font-semibold">
              {[['repartir', 'Repartir entre varios días'], ['una', 'Todas a un mismo día']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setModo(k)}
                  className={`flex-1 py-2 transition ${modo === k ? 'text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  style={modo === k ? { background: ACENTO } : undefined}>{l}</button>
              ))}
            </div>

            {modo === 'repartir' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Desde">
                    <Input type="date" value={rango.desde} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))} />
                  </Campo>
                  <Campo label="Hasta">
                    <Input type="date" value={rango.hasta} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))} />
                  </Campo>
                </div>
                <div>
                  <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Días en que se visita</span>
                  <div className="flex flex-wrap gap-1.5">
                    {DIAS_SEMANA.map(d => (
                      <button key={d.n} type="button" onClick={() => toggleDia(d.n)}
                        className={`h-8 px-3 rounded-full text-[12px] font-semibold border transition ${
                          semana.includes(d.n) ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 bg-white'}`}
                        style={semana.includes(d.n) ? { background: ACENTO } : undefined}>{d.l}</button>
                    ))}
                  </div>
                </div>
                <div className="text-[12px] text-gray-600">
                  {dias.length
                    ? <>{visitas.length} visitas en {dias.length} días · {Math.floor(visitas.length / dias.length) || 0}
                        {visitas.length % dias.length ? `–${Math.ceil(visitas.length / dias.length)}` : ''} por día.
                        Horas desde las 9:00, cada hora y media.</>
                    : <span className="text-orange-600">No hay días en ese rango.</span>}
                </div>
              </>
            ) : (
              <Campo label="Día" ayuda="Cada visita conserva su hora.">
                <Input type="date" value={dia} onChange={e => setDia(e.target.value)} />
              </Campo>
            )}

            {porDia.length > 0 && (
              <div className="rounded-xl border border-gray-100 max-h-64 overflow-y-auto divide-y divide-gray-50">
                {porDia.map(([d, xs]) => (
                  <div key={d} className="px-3 py-2">
                    <div className="text-[11.5px] font-bold text-gray-700 capitalize">{etiquetaDia(d)} · {xs.length}</div>
                    {xs.map(x => (
                      <div key={x.v.id} className="text-[11.5px] text-gray-500 truncate">{x.hora} · {nombre(x.v)}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
