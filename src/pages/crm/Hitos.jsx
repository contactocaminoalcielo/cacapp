// Hitos: Orbit detecta cuándo una veterinaria cumple algo que vale la pena
// agradecer (primer servicio, 10 servicios, 8 en el mes, volvió tras 60 días)
// y PROPONE el mensaje. Nada sale solo salvo que la regla se pase a automática.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Send, Ban, RefreshCw } from 'lucide-react'
import { crm, TIPOS_HITO, fechaHora } from '@/lib/crmApi'
import { listarPlantillas, variablesDePlantilla, huecosDePlantilla } from '@/lib/plantillasWa'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Cabecera, Cargando, ErrorCaja, Pestanas, Vacio, Chip, Campo, Seccion, ACENTO } from '@/components/crm/ui'
import { useCrm } from '@/components/crm/CrmContext'

export default function Hitos() {
  const { confirm, alert: avisar } = useConfirm()
  const { refrescarAlertas } = useCrm()
  const [pestana, setPestana] = useState('PROPUESTO')
  const [envios, setEnvios] = useState(null)
  const [reglas, setReglas] = useState(null)
  const [error, setError] = useState(null)
  const [editando, setEditando] = useState(null)
  const [trabajando, setTrabajando] = useState(null)

  const cargar = useCallback(() => {
    setError(null)
    crm.reglasHitos().then(r => setReglas(r.reglas || [])).catch(e => setError(e.message))
    crm.enviosHitos(pestana === 'TODOS' ? null : pestana).then(r => setEnvios(r.envios || [])).catch(e => setError(e.message))
  }, [pestana])
  useEffect(cargar, [cargar])

  async function enviar(e) {
    setTrabajando(e.id)
    try { await crm.enviarHito(e.id) } catch (err) { await avisar(err.message, { title: 'No se pudo enviar' }) }
    setTrabajando(null); cargar(); refrescarAlertas()
  }
  async function descartar(e) {
    await crm.descartarHito(e.id).catch(() => {})
    cargar(); refrescarAlertas()
  }
  async function enviarTodos() {
    const props = (envios || []).filter(e => e.estado === 'PROPUESTO')
    if (!(await confirm(`Se enviarán ${props.length} mensajes por la línea de veterinarias.`, { title: 'Enviar todos', confirmText: 'Enviar' }))) return
    for (const e of props) { setTrabajando(e.id); await crm.enviarHito(e.id).catch(() => {}) }
    setTrabajando(null); cargar(); refrescarAlertas()
  }
  async function evaluar() {
    setTrabajando('evaluar')
    try {
      const r = await crm.evaluarHitos()
      await avisar(`${r.reglas} regla(s) encendida(s) revisadas · ${r.propuestos} hito(s) nuevo(s) propuesto(s).`, { title: 'Revisión hecha' })
    } catch (err) { setError(err.message) }
    setTrabajando(null); cargar(); refrescarAlertas()
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <Cabecera titulo="Hitos y agradecimientos" sub="Cuando una veterinaria cumple un hito, Orbit te propone el mensaje. Tú decides si sale. Se revisa solo todos los días a las 8:10 a. m.">
        <Button variant="secondary" onClick={evaluar} disabled={trabajando === 'evaluar'}><RefreshCw size={14} /> Revisar ahora</Button>
        <Button onClick={() => setEditando({})} style={{ background: ACENTO }}><Plus size={14} /> Nueva regla</Button>
      </Cabecera>
      <ErrorCaja error={error} onReintentar={cargar} />

      <Seccion titulo="Reglas">
        {!reglas ? <Cargando /> : !reglas.length ? <Vacio>Sin reglas.</Vacio> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {reglas.map(r => (
              <div key={r.id} className={`rounded-xl border p-3 ${r.activo ? 'border-teal-200 bg-teal-50/30' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-bold text-gray-800">{r.nombre}</div>
                    <div className="text-[11.5px] text-gray-500">{TIPOS_HITO[r.tipo]?.label}{TIPOS_HITO[r.tipo]?.umbral ? ` · ${r.umbral}` : ''}{r.repetir ? ` (cada ${r.umbral})` : ''}</div>
                    <div className="text-[11.5px] text-gray-500">Plantilla: {r.plantilla ? <b>{r.plantilla}</b> : <span className="text-amber-600">sin elegir</span>}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Chip color={r.activo ? '#059669' : '#94A3B8'}>{r.activo ? 'Encendida' : 'Apagada'}</Chip>
                    {r.activo && <Chip color={r.modo === 'AUTOMATICO' ? '#DC2626' : '#2563EB'}>{r.modo === 'AUTOMATICO' ? 'Sale sola' : 'Te la propone'}</Chip>}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 text-[11.5px]">
                  <span className="text-gray-400">{r.enviados} enviados · {r.propuestos} por enviar</span>
                  <span className="flex gap-2">
                    <button onClick={() => setEditando(r)} className="inline-flex items-center gap-1 font-semibold" style={{ color: ACENTO }}><Pencil size={12} /> Editar</button>
                    <button onClick={async () => { if (await confirm(`¿Borrar la regla "${r.nombre}" y su historial?`, { title: 'Borrar regla', danger: true, confirmText: 'Borrar' })) { await crm.borrarRegla(r.id); cargar() } }}
                      className="inline-flex items-center gap-1 text-gray-400"><Trash2 size={12} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <Pestanas valor={pestana} onCambio={setPestana} opciones={[
            { valor: 'PROPUESTO', label: 'Por enviar' }, { valor: 'ENVIADO', label: 'Enviados' },
            { valor: 'ERROR', label: 'Con error' }, { valor: 'DESCARTADO', label: 'Descartados' },
          ]} />
          {pestana === 'PROPUESTO' && envios?.length > 1 && <Button size="sm" onClick={enviarTodos} style={{ background: ACENTO }}><Send size={13} /> Enviar todos</Button>}
        </div>
        {!envios ? <Cargando /> : !envios.length ? <Vacio>{pestana === 'PROPUESTO' ? 'No hay hitos esperando. Enciende una regla con su plantilla para empezar.' : 'Nada aquí.'}</Vacio> : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {envios.map(e => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="text-[22px]">🏆</div>
                <div className="flex-1 min-w-[200px]">
                  <Link to={`/crm/veterinarias/${e.aliado_id}`} className="text-[13px] font-bold text-gray-900 no-underline">{e.aliado_nombre}</Link>
                  <div className="text-[12px] text-gray-600">{e.regla} · {e.tipo === 'REACTIVACION' ? `volvió tras ${e.valor} días` : e.tipo === 'PRIMER_SERVICIO' ? 'primer servicio' : `${e.valor} servicios`}</div>
                  <div className="text-[11px] text-gray-400">Plantilla {e.plantilla} · {fechaHora(e.propuesto_en)}{e.resuelto_por_nombre ? ` · ${e.resuelto_por_nombre}` : ''}{!e.whatsapp ? ' · ⚠️ sin WhatsApp en la ficha' : ''}</div>
                  {e.error && <div className="text-[11.5px] text-red-600">{e.error}</div>}
                </div>
                {['PROPUESTO', 'ERROR'].includes(e.estado) && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => enviar(e)} disabled={!!trabajando || !e.whatsapp} style={{ background: ACENTO }}>
                      <Send size={12} /> {trabajando === e.id ? 'Enviando…' : e.estado === 'ERROR' ? 'Reintentar' : 'Enviar'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => descartar(e)}><Ban size={12} /> Descartar</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <EditarRegla regla={editando} onCerrar={() => setEditando(null)} onGuardado={cargar} />
    </div>
  )
}

function EditarRegla({ regla, onCerrar, onGuardado }) {
  const { lineaVets } = useCrm()
  const [f, setF] = useState({})
  const [plantillas, setPlantillas] = useState([])
  const [mapeados, setMapeados] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!regla) return
    setError(null)
    setF({ nombre: '', tipo: 'SERVICIOS_TOTAL', umbral: 10, repetir: false, plantilla: '', idioma: 'es_MX', valores: {}, modo: 'PROPONER', activo: false, ...regla })
    listarPlantillas(null, lineaVets).then(r => setPlantillas((r.plantillas || []).filter(p => p.status === 'APPROVED'))).catch(() => {})
  }, [regla, lineaVets])

  // Los huecos de la plantilla: los mapeados en Plantillas → Datos salen solos;
  // aquí se rellenan los demás, con comodines.
  useEffect(() => {
    setMapeados({})
    if (!f.plantilla) return
    const p = plantillas.find(x => x.name === f.plantilla)
    variablesDePlantilla(f.plantilla, p?.language || f.idioma)
      .then(r => setMapeados(Object.fromEntries((r.variables || []).map(v => [`${v.destino}:${v.param ?? v.posicion}`, v.campo]))))
      .catch(() => {})
  }, [f.plantilla, plantillas]) // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    setError(null)
    try { await crm.guardarRegla(regla.id || null, f); onGuardado?.(); onCerrar() } catch (e) { setError(e.message) }
  }

  const tipo = TIPOS_HITO[f.tipo] || {}
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const elegida = plantillas.find(p => p.name === f.plantilla)
  const cuerpo = elegida?.components?.find(c => c.type === 'BODY')?.text
  const huecos = elegida ? huecosDePlantilla(elegida) : []

  return (
    <Modal open={!!regla} onClose={onCerrar} title={regla?.id ? 'Editar regla de hito' : 'Nueva regla de hito'} maxWidth="max-w-2xl"
      footer={<><span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2"><Button variant="secondary" onClick={onCerrar}>Cancelar</Button><Button onClick={guardar} style={{ background: ACENTO }}>Guardar</Button></div></>}>
      <div className="space-y-4">
        <Campo label="Nombre"><Input value={f.nombre || ''} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Gracias por 50 servicios" /></Campo>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Campo label="Cuándo se dispara" className="sm:col-span-2">
            <Select value={f.tipo} onChange={e => set('tipo', e.target.value)}>
              {Object.entries(TIPOS_HITO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <span className="block text-[11px] text-gray-400 mt-1">{tipo.ayuda}</span>
          </Campo>
          {tipo.umbral && <Campo label={tipo.umbral}><Input type="number" min="1" value={f.umbral || ''} onChange={e => set('umbral', e.target.value)} /></Campo>}
        </div>
        {f.tipo === 'SERVICIOS_TOTAL' && (
          <label className="flex items-center gap-2 text-[12.5px] text-gray-700">
            <input type="checkbox" checked={!!f.repetir} onChange={e => set('repetir', e.target.checked)} /> Repetir en cada múltiplo ({f.umbral || 'N'}, {2 * (Number(f.umbral) || 0) || '2N'}, {3 * (Number(f.umbral) || 0) || '3N'}…)
          </label>
        )}
        <Campo label="Plantilla aprobada (línea de veterinarias)" ayuda="Si no está, créala en Recursos y plantillas y espera la aprobación de Meta.">
          <Select value={f.plantilla || ''} onChange={e => { set('plantilla', e.target.value); const p = plantillas.find(x => x.name === e.target.value); if (p) set('idioma', p.language) }}>
            <option value="">— Elige —</option>
            {plantillas.map(p => <option key={`${p.name}-${p.language}`} value={p.name}>{p.name} ({p.category?.toLowerCase()})</option>)}
          </Select>
        </Campo>
        {cuerpo && <div className="rounded-xl bg-[#E7FFDB] p-3 text-[12.5px] text-gray-800 whitespace-pre-wrap">{cuerpo}</div>}
        {huecos.length > 0 && (
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-gray-600">Valores de los huecos <span className="font-normal text-gray-400">(vacío = el dato mapeado en Plantillas → Datos). Comodines: {'{valor}'} el número del hito, {'{nombre}'} la veterinaria, {'{contacto}'} la persona, {'{mes}'}.</span></div>
            {huecos.map(h => {
              const clave = h.clave
              const campo = mapeados[clave]
              return (
                <div key={clave} className="flex items-center gap-2">
                  <span className="w-28 text-[11.5px] font-mono text-gray-500">{clave}</span>
                  <Input value={f.valores?.[clave] || ''} onChange={e => set('valores', { ...f.valores, [clave]: e.target.value })}
                    placeholder={campo ? `sale solo: ${campo}` : 'Ej: {valor} — obligatorio si no está mapeado'} />
                </div>
              )
            })}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo label="Cómo sale">
            <Select value={f.modo} onChange={e => set('modo', e.target.value)}>
              <option value="PROPONER">Me lo propone y yo lo envío</option>
              <option value="AUTOMATICO">Sale solo (sin revisión)</option>
            </Select>
          </Campo>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700 pt-5">
            <input type="checkbox" checked={!!f.activo} onChange={e => set('activo', e.target.checked)} /> Regla encendida
          </label>
        </div>
        {f.modo === 'AUTOMATICO' && f.activo && <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg p-2">⚠️ Saldrá sin que nadie lo revise. Recomendado solo cuando la regla ya se probó en modo “propone”.</p>}
      </div>
    </Modal>
  )
}
