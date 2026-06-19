// Pestaña "Candidatas Tenjo" — vista de solo lectura sobre v_candidatos_tenjo.
// Muestra qué mascotas individuales en custodia pueden programarse, con la
// evaluación del motor de reglas (clasificación, bloqueos, alertas, acción).
import { useState } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { petEmoji, parsearErrorDB } from '@/lib/utils'
import { evaluarCandidato, CLASIF_CFG, nombreDia, proximaJornada, agregarCandidataALote } from '@/lib/tenjo'
import { Search, X, Snowflake, Plus, Check, Truck } from 'lucide-react'
import SetupNotice from './SetupNotice'

function fmtFecha(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function ChipClasif({ clasificacion }) {
  const cfg = CLASIF_CFG[clasificacion] || {}
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.text }}>
      {cfg.label || clasificacion}
    </span>
  )
}

export default function CandidatasTab({ candidatas, config, canPlan, personalData, onChanged }) {
  const { alert: showAlert } = useConfirm()
  const [busqueda, setBusqueda] = useState('')
  const [savingId, setSavingId] = useState(null)

  async function agregarAlLote(c) {
    setSavingId(c.servicio_id)
    try {
      const { lote, agregada } = await agregarCandidataALote({
        candidata: c, config, personalId: personalData?.id,
      })
      onChanged?.()
      if (!agregada) {
        await showAlert(`${c.mascota} ya estaba en el lote ${lote.numero_lote}.`, { title: 'Sin cambios' })
      }
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo agregar al lote', variant: 'danger' })
    } finally {
      setSavingId(null)
    }
  }

  if (candidatas === null) return <SetupNotice />

  const evaluadas = (candidatas || []).map(c => ({ c, ev: evaluarCandidato(c, config) }))
  const filtradas = evaluadas.filter(({ c }) => {
    if (!busqueda.trim()) return true
    const q = busqueda.toLowerCase()
    return [c.mascota, c.cliente, c.plan, c.nevera_codigo].some(v => v?.toLowerCase().includes(q))
  })

  const conteo = k => evaluadas.filter(({ ev }) => ev.clasificacion === k).length
  const jornada = proximaJornada(config)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="En custodia (individuales)" value={evaluadas.length} valueColor="#3D5A27" />
        <StatCard label="Aptas" value={conteo('APTA')} valueColor="#1D8A55" />
        <StatCard label="Requieren validación" value={conteo('REQUIERE_VALIDACION')} valueColor="#D97706" />
        <StatCard label="Presencial por confirmar" value={conteo('PRESENCIAL_PENDIENTE')} valueColor="#7C3AED" />
        <StatCard label="Bloqueadas" value={conteo('BLOQUEADA')} valueColor="#C03030" />
      </div>

      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <Snowflake size={15} className="text-blue-500" />
          <div className="font-semibold text-[15px] text-ink flex-1">Candidatas Tenjo</div>
          {jornada && (
            <span className="text-[11px] text-ink3">
              Próxima jornada: <strong className="text-ink">{nombreDia(jornada)} {fmtFecha(jornada + 'T12:00:00')}</strong>
            </span>
          )}
          <div className="relative w-52">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-gray-200 text-[12px] outline-none focus:border-[#3D5A27]" />
            {busqueda && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setBusqueda('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {filtradas.length === 0 ? (
          <div className="py-10 text-center text-ink3 text-sm">
            {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay mascotas individuales en custodia'}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Cliente</Th>
                  <Th>Plan</Th>
                  <Th>Nevera</Th>
                  <Th>Ingreso</Th>
                  <Th>Días</Th>
                  <Th>Programación</Th>
                  <Th>Clasificación</Th>
                  <Th>Acción recomendada</Th>
                  {canPlan && <Th></Th>}
                </tr>
              </thead>
              <tbody>
                {filtradas.map(({ c, ev }) => {
                  const diasColor = c.dias_custodia >= (config.dias_custodia_critica ?? 8) ? '#C03030'
                    : c.dias_custodia >= (config.dias_custodia_alerta ?? 5) ? '#D97706' : '#374151'
                  const programacion = c.traslado_activo ? 'Traslado activo'
                    : c.item_activo_id ? 'En lote propuesto' : 'Sin programar'
                  return (
                    <Tr key={c.cuarto_frio_id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{petEmoji(c.especie)}</span>
                          <div>
                            <div className="font-semibold text-ink">{c.mascota}</div>
                            <div className="text-[10px] text-ink3">{c.peso_kg ? `${c.peso_kg} kg` : 'sin peso'}</div>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-ink2">
                        {c.cliente || '—'}
                        {!c.cliente_whatsapp && <div className="text-[10px] text-amber-600">sin WhatsApp</div>}
                      </Td>
                      <Td className="text-ink3">
                        {c.plan}
                        {(ev.reqConfirma || ev.reqEvidencia) && (
                          <div className="text-[10px] text-ink3">
                            {ev.reqConfirma && '👤 confirmación'} {ev.reqEvidencia && '📷 evidencia'}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono text-[11px]">{c.nevera_codigo || '—'}</span>
                        {c.nevera_destino === 'GRUPALES' && (
                          <div className="text-[10px] font-bold text-red-600">⚠ grupales</div>
                        )}
                      </Td>
                      <Td className="text-[11px] text-ink3">{fmtFecha(c.fecha_ingreso)}</Td>
                      <Td><span className="font-bold text-[13px]" style={{ color: diasColor }}>{c.dias_custodia}</span></Td>
                      <Td className="text-[11px] text-ink2">
                        {programacion}
                        {c.veces_reprogramada > 0 && (
                          <div className="text-[10px] text-amber-600">↻ {c.veces_reprogramada} reprog.</div>
                        )}
                      </Td>
                      <Td><ChipClasif clasificacion={ev.clasificacion} /></Td>
                      <Td className="text-[11px] text-ink2 max-w-[220px]">
                        {ev.accion}
                        {[...ev.bloqueos, ...ev.validaciones].slice(0, 2).map((b, i) => (
                          <div key={i} className="text-[10px] text-ink3 mt-0.5">• {b}</div>
                        ))}
                      </Td>
                      {canPlan && (
                        <Td>
                          {c.traslado_activo ? (
                            <span className="text-[10px] text-ink3 inline-flex items-center gap-1 whitespace-nowrap">
                              <Truck size={11} /> Traslado activo
                            </span>
                          ) : c.item_activo_id ? (
                            <span className="text-[10px] text-green-700 font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                              <Check size={11} /> En el lote
                            </span>
                          ) : (
                            <Button size="sm" variant="secondary"
                              disabled={savingId === c.servicio_id}
                              onClick={() => agregarAlLote(c)}>
                              <Plus size={12} /> Agregar al lote
                            </Button>
                          )}
                        </Td>
                      )}
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  )
}
