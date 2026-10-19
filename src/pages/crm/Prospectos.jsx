import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Upload, Search, Phone, LayoutGrid, List, FileSpreadsheet } from 'lucide-react'
import { crm, ETAPAS, FUENTES, fechaCorta, relativo, telHref } from '@/lib/crmApi'
import { leerTabla, CAMPOS_IMPORTACION, mapeoSugerido, aplicarMapeo } from '@/lib/leerTabla'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Cabecera, Cargando, ErrorCaja, Campo, Chip, EtapaChip, ACENTO } from '@/components/crm/ui'
import { useCrm } from '@/components/crm/CrmContext'

export default function Prospectos() {
  const { alert: avisar } = useConfirm()
  const navegar = useNavigate()
  const { equipo } = useCrm()
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [fuente, setFuente] = useState('')
  const [responsable, setResponsable] = useState('')
  const [vista, setVista] = useState('kanban')
  const [verCerrados, setVerCerrados] = useState(false)
  const [modal, setModal] = useState(null)       // 'nuevo' | 'importar' | {perder: p} | {ganar: p}
  const arrastrando = useRef(null)
  const [sobre, setSobre] = useState(null)

  const cargar = () => { setError(null); crm.prospectos().then(r => setLista(r.prospectos || [])).catch(e => setError(e.message)) }
  useEffect(cargar, [])

  const filtrados = useMemo(() => (lista || []).filter(p => {
    if (fuente && p.fuente !== fuente) return false
    if (responsable && p.responsable_id !== responsable) return false
    const t = q.trim().toLowerCase()
    if (t && ![p.nombre, p.contacto_nombre, p.localidad, p.ciudad, p.telefono, p.whatsapp].some(x => (x || '').toLowerCase().includes(t))) return false
    return true
  }), [lista, q, fuente, responsable])

  const etapasVisibles = ETAPAS.filter(e => verCerrados || !['GANADO', 'PERDIDO'].includes(e.clave))

  async function soltar(etapaDestino) {
    const p = arrastrando.current
    arrastrando.current = null
    setSobre(null)
    if (!p || p.etapa === etapaDestino) return
    if (etapaDestino === 'PERDIDO') { setModal({ perder: p }); return }
    if (etapaDestino === 'GANADO') { setModal({ ganar: p }); return }
    const columna = filtrados.filter(x => x.etapa === etapaDestino)
    const orden = columna.length ? Math.min(...columna.map(x => x.orden)) - 1 : 0
    setLista(l => l.map(x => (x.id === p.id ? { ...x, etapa: etapaDestino, orden } : x)))
    try { await crm.moverProspecto(p.id, { etapa: etapaDestino, orden }) }
    catch (e) { await avisar(e.message, { title: 'No se pudo mover' }); cargar() }
  }

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!lista) return <Cargando />

  const abiertos = lista.filter(p => !['GANADO', 'PERDIDO'].includes(p.etapa))
  const potencial = Math.round(abiertos.reduce((a, p) => a + (p.potencial_mensual || 0) * (p.probabilidad_efectiva || 0) / 100, 0))

  return (
    <div className="max-w-[1600px] mx-auto">
      <Cabecera titulo="Prospectos" sub={`${abiertos.length} en curso · ≈ ${potencial} servicios/mes ponderados · arrastra las tarjetas entre etapas`}>
        <Button variant="secondary" onClick={() => setModal('importar')}><Upload size={14} /> Importar base</Button>
        <Button onClick={() => setModal('nuevo')} style={{ background: ACENTO }}><Plus size={14} /> Nuevo prospecto</Button>
      </Cabecera>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar prospecto…" />
        </div>
        <Select value={fuente} onChange={e => setFuente(e.target.value)} className="w-auto">
          <option value="">Todas las fuentes</option>
          {Object.entries(FUENTES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={responsable} onChange={e => setResponsable(e.target.value)} className="w-auto">
          <option value="">Cualquier responsable</option>
          {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-600 px-2">
          <input type="checkbox" checked={verCerrados} onChange={e => setVerCerrados(e.target.checked)} /> Ver ganados y perdidos
        </label>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          {[['kanban', LayoutGrid, 'Tablero'], ['lista', List, 'Lista']].map(([v, I, t]) => (
            <button key={v} onClick={() => setVista(v)} className={`h-10 px-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${vista === v ? 'text-white' : 'text-gray-500'}`}
              style={vista === v ? { background: ACENTO } : undefined}><I size={15} /> {t}</button>
          ))}
        </div>
      </div>

      {!lista.length && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-5 py-4 mb-4 flex items-center gap-4">
          <FileSpreadsheet size={28} className="text-gray-300 flex-shrink-0" />
          <div>
            <p className="text-[13.5px] font-semibold text-gray-700">Todavía no hay prospectos</p>
            <p className="text-[12.5px] text-gray-500">Importa una base de datos de veterinarias (Excel o CSV) o créalos uno a uno. Las clínicas que se
              preregistran en el portal y las que escriben pidiendo afiliarse entran solas.</p>
          </div>
        </div>
      )}
      {vista === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {etapasVisibles.map(e => {
            const de = filtrados.filter(p => p.etapa === e.clave).sort((a, b) => a.orden - b.orden)
            const pot = de.reduce((a, p) => a + (p.potencial_mensual || 0), 0)
            return (
              <div key={e.clave}
                onDragOver={ev => { ev.preventDefault(); setSobre(e.clave) }}
                onDragLeave={() => setSobre(s => (s === e.clave ? null : s))}
                onDrop={ev => { ev.preventDefault(); soltar(e.clave) }}
                className={`w-[272px] flex-shrink-0 rounded-2xl border transition ${sobre === e.clave ? 'bg-teal-50 border-teal-300' : 'bg-white/60 border-gray-100'}`}>
                <div className="px-3 py-2.5 border-b-2" style={{ borderColor: e.color }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-bold" style={{ color: e.color }}>{e.label}</span>
                    <span className="text-[11px] font-bold text-gray-400">{de.length}</span>
                  </div>
                  {pot > 0 && <div className="text-[10.5px] text-gray-400">potencial {pot} serv/mes</div>}
                </div>
                <div className="p-2 space-y-2 min-h-[120px] max-h-[68vh] overflow-y-auto">
                  {de.map(p => (
                    <div key={p.id} draggable onDragStart={() => { arrastrando.current = p }}
                      onClick={() => navegar(`/crm/prospectos/${p.id}`)}
                      className="bg-white rounded-xl border border-gray-100 p-2.5 shadow-sm hover:shadow-md cursor-pointer transition">
                      <div className="text-[12.5px] font-semibold text-gray-900 truncate">{p.no_contactar ? '🚫 ' : ''}{p.nombre}</div>
                      <div className="text-[11px] text-gray-400 truncate">{[p.contacto_nombre, p.localidad || p.ciudad].filter(Boolean).join(' · ') || '—'}</div>
                      <div className="flex items-center justify-between mt-1.5 gap-1">
                        <Chip color="#64748B">{FUENTES[p.fuente] || p.fuente}</Chip>
                        <span className="text-[10.5px] font-semibold text-gray-500">{p.probabilidad_efectiva}%</span>
                      </div>
                      {p.proximo_seguimiento && (
                        <div className={`text-[10.5px] font-semibold mt-1 ${new Date(p.proximo_seguimiento) <= new Date() ? 'text-red-600' : 'text-teal-700'}`}>
                          📅 {relativo(p.proximo_seguimiento)}
                        </div>
                      )}
                      {p.etapa === 'PERDIDO' && p.motivo_perdida && <div className="text-[10.5px] text-red-500 mt-1 truncate">✕ {p.motivo_perdida}</div>}
                    </div>
                  ))}
                  {!de.length && <div className="text-[11px] text-gray-300 text-center py-6">Suelta aquí</div>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2.5">Prospecto</th><th className="px-3">Etapa</th><th className="px-3">Fuente</th>
                <th className="px-3">Responsable</th><th className="px-3">Gestiones</th><th className="px-3">Próximo</th><th className="px-3">Creado</th><th />
              </tr>
            </thead>
            <tbody>
              {filtrados.filter(p => verCerrados || !['GANADO', 'PERDIDO'].includes(p.etapa)).map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-teal-50/30">
                  <td className="px-4 py-2"><Link to={`/crm/prospectos/${p.id}`} className="font-semibold text-gray-900 no-underline">{p.nombre}</Link>
                    <div className="text-[11px] text-gray-400">{[p.contacto_nombre, p.localidad || p.ciudad].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-3"><EtapaChip clave={p.etapa} /></td>
                  <td className="px-3 text-gray-500">{FUENTES[p.fuente]}</td>
                  <td className="px-3 text-gray-500">{p.responsable || '—'}</td>
                  <td className="px-3 tabular-nums">{p.gestiones}</td>
                  <td className="px-3 text-[11.5px]">{p.proximo_seguimiento ? fechaCorta(p.proximo_seguimiento) : '—'}</td>
                  <td className="px-3 text-[11.5px] text-gray-400">{fechaCorta(p.created_at)}</td>
                  <td className="px-3">{telHref(p.telefono || p.whatsapp) && <a href={telHref(p.telefono || p.whatsapp)} className="text-teal-700"><Phone size={14} /></a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NuevoProspecto abierto={modal === 'nuevo'} onCerrar={() => setModal(null)} onCreado={p => { cargar(); navegar(`/crm/prospectos/${p.id}`) }} />
      <Importar abierto={modal === 'importar'} onCerrar={() => setModal(null)} onListo={cargar} />
      <Perder prospecto={modal?.perder} onCerrar={() => setModal(null)} onListo={cargar} />
      <Ganar prospecto={modal?.ganar} onCerrar={() => setModal(null)} onListo={r => { cargar(); if (r?.aliado_id) navegar(`/crm/veterinarias/${r.aliado_id}`) }} />
    </div>
  )
}

export function NuevoProspecto({ abierto, onCerrar, onCreado }) {
  const { equipo } = useCrm()
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [duplicado, setDuplicado] = useState(null)
  useEffect(() => { if (abierto) { setF({ fuente: 'MANUAL' }); setError(null); setDuplicado(null) } }, [abierto])
  const txt = k => ({ value: f[k] ?? '', onChange: e => setF(x => ({ ...x, [k]: e.target.value })) })

  async function guardar(forzar = false) {
    setGuardando(true); setError(null)
    try {
      const r = await crm.crearProspecto({ ...f, forzar })
      onCreado?.(r.prospecto)
      onCerrar()
    } catch (e) {
      if (e.status === 409) setDuplicado(e.detalle?.duplicado || null)
      setError(e.message)
    } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Nuevo prospecto" maxWidth="max-w-2xl"
      footer={<>
        <span className="text-[12px] text-red-600">
          {error}{duplicado && <> · <Link to={duplicado.tipo === 'ALIADO' ? `/crm/veterinarias/${duplicado.id}` : `/crm/prospectos/${duplicado.id}`} className="underline" onClick={onCerrar}>abrirlo</Link></>}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          {duplicado?.tipo === 'PROSPECTO' && <Button variant="secondary" onClick={() => guardar(true)}>Crear igual</Button>}
          <Button onClick={() => guardar(false)} disabled={guardando || !String(f.nombre || '').trim()} style={{ background: ACENTO }}>
            {guardando ? 'Creando…' : 'Crear'}
          </Button>
        </div>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Nombre de la veterinaria" className="sm:col-span-2"><Input {...txt('nombre')} /></Campo>
        <Campo label="Persona de contacto"><Input {...txt('contacto_nombre')} /></Campo>
        <Campo label="Cargo"><Input {...txt('contacto_cargo')} /></Campo>
        <Campo label="Teléfono"><Input {...txt('telefono')} /></Campo>
        <Campo label="WhatsApp"><Input {...txt('whatsapp')} /></Campo>
        <Campo label="Correo"><Input {...txt('email')} /></Campo>
        <Campo label="Instagram / web"><Input {...txt('instagram')} /></Campo>
        <Campo label="Ciudad"><Input {...txt('ciudad')} placeholder="Bogotá" /></Campo>
        <Campo label="Localidad"><LocalidadSelect value={f.localidad || ''} onChange={v => setF(x => ({ ...x, localidad: v }))} /></Campo>
        <Campo label="Dirección" className="sm:col-span-2"><Input {...txt('direccion')} /></Campo>
        <Campo label="Fuente">
          <Select {...txt('fuente')}>{Object.entries(FUENTES).filter(([k]) => k !== 'IMPORTACION' && k !== 'AGENTE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Campo>
        <Campo label="Detalle de la fuente"><Input {...txt('fuente_detalle')} placeholder="Ej: referido por Dra. Paula, feria vet…" /></Campo>
        <Campo label="Potencial (servicios/mes)"><Input type="number" min="0" {...txt('potencial_mensual')} /></Campo>
        <Campo label="Responsable">
          <Select {...txt('responsable_id')}><option value="">Yo / sin asignar</option>{equipo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Select>
        </Campo>
        <Campo label="Notas" className="sm:col-span-2"><Textarea rows={2} {...txt('notas')} /></Campo>
      </div>
    </Modal>
  )
}

function Importar({ abierto, onCerrar, onListo }) {
  const { equipo } = useCrm()
  const [paso, setPaso] = useState('archivo')    // archivo | mapeo | resultado
  const [tabla, setTabla] = useState(null)
  const [archivo, setArchivo] = useState('')
  const [mapa, setMapa] = useState({})
  const [fuenteDetalle, setFuenteDetalle] = useState('')
  const [responsableId, setResponsableId] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState(null)
  const [resultado, setResultado] = useState(null)

  useEffect(() => { if (abierto) { setPaso('archivo'); setTabla(null); setError(null); setResultado(null); setFuenteDetalle(''); setResponsableId('') } }, [abierto])

  async function leer(file) {
    if (!file) return
    setError(null); setTrabajando(true)
    try {
      const t = await leerTabla(file)
      if (!t.filas.length) throw new Error('El archivo no tiene filas debajo de los encabezados')
      setTabla(t); setArchivo(file.name); setMapa(mapeoSugerido(t.columnas)); setFuenteDetalle(file.name.replace(/\.[^.]+$/, ''))
      setPaso('mapeo')
    } catch (e) { setError(e.message) } finally { setTrabajando(false) }
  }

  const filas = tabla ? aplicarMapeo(tabla, mapa) : []
  const validas = filas.filter(f => String(f.nombre || '').trim())

  async function importar() {
    setTrabajando(true); setError(null)
    try {
      const r = await crm.importar({ filas: validas, nombre_archivo: archivo, fuente: 'IMPORTACION', fuente_detalle: fuenteDetalle, responsable_id: responsableId || null })
      setResultado(r); setPaso('resultado'); onListo?.()
    } catch (e) { setError(e.message) } finally { setTrabajando(false) }
  }

  function plantilla() {
    const cab = CAMPOS_IMPORTACION.map(c => c.label).join(';')
    const ej = 'Veterinaria Patitas;Dra. Liliana Ruiz;Dueña;6015551234;3001234567;contacto@patitas.co;Cra 15 # 80-25;Chicó;Chapinero;Bogotá;@patitas;patitas.co;4;La conocimos en la feria'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + cab + '\n' + ej], { type: 'text/csv;charset=utf-8' }))
    a.download = 'plantilla-prospectos.csv'
    a.click()
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Importar base de datos de veterinarias" maxWidth="max-w-4xl"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          {paso === 'mapeo' && <Button variant="secondary" onClick={() => setPaso('archivo')}>Otro archivo</Button>}
          {paso === 'mapeo' && (
            <Button onClick={importar} disabled={trabajando || !validas.length || !Object.values(mapa).includes('nombre')} style={{ background: ACENTO }}>
              {trabajando ? 'Importando…' : `Importar ${validas.length} prospectos`}
            </Button>
          )}
          {paso !== 'mapeo' && <Button variant="secondary" onClick={onCerrar}>Cerrar</Button>}
        </div>
      </>}>
      {paso === 'archivo' && (
        <div className="space-y-4">
          <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center cursor-pointer hover:border-teal-500 transition">
            <Upload size={28} className="mx-auto text-gray-300" />
            <div className="text-[14px] font-semibold text-gray-700 mt-2">{trabajando ? 'Leyendo…' : 'Elige un archivo Excel (.xlsx) o CSV'}</div>
            <div className="text-[12px] text-gray-400 mt-1">La primera fila deben ser los encabezados. Se lee la primera hoja.</div>
            <input type="file" accept=".xlsx,.csv,text/csv" className="hidden" onChange={e => leer(e.target.files?.[0])} />
          </label>
          <div className="text-[12.5px] text-gray-500">
            ¿No sabes qué columnas poner? <button onClick={plantilla} className="font-semibold underline" style={{ color: ACENTO }}>Descarga la plantilla</button>.
            Los duplicados (mismo teléfono o mismo nombre, contra aliadas y prospectos) se saltan solos y te los muestro al final.
          </div>
        </div>
      )}

      {paso === 'mapeo' && tabla && (
        <div className="space-y-4">
          <div className="text-[12.5px] text-gray-600"><b>{archivo}</b> · {tabla.filas.length} filas · {tabla.columnas.length} columnas. Revisa a qué campo va cada columna (lo que no se asigne se guarda como dato extra del prospecto).</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {tabla.columnas.map((col, i) => (
              <div key={i} className="rounded-xl border border-gray-100 p-2">
                <div className="text-[11.5px] font-semibold text-gray-700 truncate" title={col}>{col}</div>
                <div className="text-[10.5px] text-gray-400 truncate mb-1">ej: {tabla.filas.find(f => f[i])?.[i] || '—'}</div>
                <Select value={mapa[i] || ''} onChange={e => setMapa(m => ({ ...m, [i]: e.target.value }))}>
                  <option value="">— dato extra —</option>
                  {CAMPOS_IMPORTACION.map(c => <option key={c.clave} value={c.clave}>{c.label}{c.obligatorio ? ' *' : ''}</option>)}
                </Select>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Nombre de esta base (de dónde salió)"><Input value={fuenteDetalle} onChange={e => setFuenteDetalle(e.target.value)} /></Campo>
            <Campo label="Asignar todos a">
              <Select value={responsableId} onChange={e => setResponsableId(e.target.value)}>
                <option value="">Sin asignar</option>{equipo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Select>
            </Campo>
          </div>
          {!Object.values(mapa).includes('nombre') && <div className="text-[12.5px] text-red-600">Falta indicar qué columna es el nombre de la veterinaria.</div>}
          <div>
            <div className="text-[11.5px] font-semibold text-gray-500 mb-1">Vista previa (5 primeras)</div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-[11.5px]">
                <thead><tr className="bg-gray-50 text-left">{['nombre', 'contacto_nombre', 'telefono', 'whatsapp', 'localidad', 'ciudad'].map(k => <th key={k} className="px-2 py-1.5">{CAMPOS_IMPORTACION.find(c => c.clave === k).label}</th>)}</tr></thead>
                <tbody>{validas.slice(0, 5).map((f, i) => <tr key={i} className="border-t border-gray-50">{['nombre', 'contacto_nombre', 'telefono', 'whatsapp', 'localidad', 'ciudad'].map(k => <td key={k} className="px-2 py-1">{f[k] || ''}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {filas.length - validas.length > 0 && <div className="text-[11.5px] text-amber-600 mt-1">{filas.length - validas.length} filas sin nombre se omitirán.</div>}
          </div>
        </div>
      )}

      {paso === 'resultado' && resultado && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-green-50 p-4 text-center"><div className="text-[26px] font-bold text-green-700">{resultado.creadas}</div><div className="text-[12px] text-green-800">creados</div></div>
            <div className="rounded-xl bg-amber-50 p-4 text-center"><div className="text-[26px] font-bold text-amber-700">{resultado.duplicadas.length}</div><div className="text-[12px] text-amber-800">ya existían</div></div>
            <div className="rounded-xl bg-red-50 p-4 text-center"><div className="text-[26px] font-bold text-red-700">{resultado.errores.length}</div><div className="text-[12px] text-red-800">con error</div></div>
          </div>
          {resultado.duplicadas.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-100 p-2 text-[12px]">
              {resultado.duplicadas.map((d, i) => (
                <div key={i} className="py-0.5">Fila {d.fila}: <b>{d.nombre}</b> → ya {d.con?.tipo === 'ALIADO' ? 'es aliada' : 'es prospecto'} como “{d.con?.nombre}”{d.con?.no_contactar && <span className="text-red-600 font-semibold"> · 🚫 no contactar</span>}</div>
              ))}
            </div>
          )}
          {resultado.errores.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-xl border border-red-100 p-2 text-[12px] text-red-700">
              {resultado.errores.map((d, i) => <div key={i}>Fila {d.fila} ({d.nombre}): {d.error}</div>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Perder({ prospecto, onCerrar, onListo }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => { setMotivo(''); setError(null) }, [prospecto])
  async function guardar() {
    try { await crm.moverProspecto(prospecto.id, { etapa: 'PERDIDO', motivo_perdida: motivo }); onListo?.(); onCerrar() }
    catch (e) { setError(e.message) }
  }
  return (
    <Modal open={!!prospecto} onClose={onCerrar} title={`Marcar perdido: ${prospecto?.nombre || ''}`} maxWidth="max-w-md"
      footer={<><span className="text-[12px] text-red-600">{error}</span>
        <Button variant="danger" onClick={guardar} disabled={!motivo.trim()}>Marcar perdido</Button></>}>
      <Campo label="¿Por qué se perdió?" ayuda="Sirve para ver patrones: precio, ya trabaja con otra funeraria, no hace eutanasias…">
        <Textarea rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} />
      </Campo>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {['Ya trabaja con otra funeraria', 'Precio', 'No le interesa', 'No contesta nunca', 'Clínica cerró', 'Número errado'].map(m => (
          <button key={m} onClick={() => setMotivo(m)} className="px-2.5 py-1 rounded-full border border-gray-200 text-[11.5px] text-gray-600 hover:bg-gray-50">{m}</button>
        ))}
      </div>
    </Modal>
  )
}

export function Ganar({ prospecto, onCerrar, onListo }) {
  const [modalidad, setModalidad] = useState('DESCUENTO_INMEDIATO')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState(null)
  const [resultado, setResultado] = useState(null)
  useEffect(() => { setError(null); setResultado(null); setModalidad('DESCUENTO_INMEDIATO') }, [prospecto])
  async function convertir() {
    setTrabajando(true); setError(null)
    try { const r = await crm.convertirProspecto(prospecto.id, { modalidad_comision: modalidad }); setResultado(r) }
    catch (e) { setError(e.message) } finally { setTrabajando(false) }
  }
  return (
    <Modal open={!!prospecto} onClose={() => { if (resultado) onListo?.(resultado); onCerrar() }} title={`Convertir en aliada: ${prospecto?.nombre || ''}`} maxWidth="max-w-md"
      footer={<><span className="text-[12px] text-red-600">{error}</span>
        {resultado
          ? <Button onClick={() => { onListo?.(resultado); onCerrar() }} style={{ background: ACENTO }}>Abrir su ficha</Button>
          : <Button onClick={convertir} disabled={trabajando} style={{ background: ACENTO }}>{trabajando ? 'Creando…' : 'Crear veterinaria aliada'}</Button>}</>}>
      {resultado ? (
        <div className="space-y-2 text-[13px] text-gray-700">
          <p>🎉 {resultado.creada ? 'Quedó creada como veterinaria aliada, activa.' : 'Se ató a la veterinaria que ya existía con ese teléfono.'}</p>
          {resultado.enlace && <p>Su enlace para registrar servicios:<br /><code className="text-[11.5px] break-all bg-gray-50 rounded px-1.5 py-1 block mt-1">{resultado.enlace}</code></p>}
          <p className="text-[12px] text-gray-500">Las gestiones, seguimientos y fotos del prospecto pasaron a su ficha.</p>
        </div>
      ) : (
        <div className="space-y-3 text-[13px] text-gray-700">
          <p>Se crea la veterinaria en Orbit (activa, con su enlace personal de registro). Si ya existe una con el mismo teléfono, se ata a esa en vez de duplicarla.</p>
          <Campo label="Modalidad de comisión">
            <Select value={modalidad} onChange={e => setModalidad(e.target.value)}>
              <option value="DESCUENTO_INMEDIATO">Descuento inmediato</option>
              <option value="FACTURACION_MENSUAL">Facturación mensual</option>
            </Select>
          </Campo>
        </div>
      )}
    </Modal>
  )
}
