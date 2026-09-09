// Configuración → Plantas (migración 149).
//
// Vive fuera de Configuracion.jsx a propósito: ese archivo ya pasa de 3.200
// líneas y cada pestaña nueva lo hace más difícil de leer.
//
// Tres bloques:
//   1. Catálogo — la ESPECIE de la planta cambia con el tiempo (hoy Helecho y
//      Pescadito). Por eso es catálogo editable y no una lista en el código.
//   2. Aviso automático — interruptor + plantilla aprobada en Meta. Mientras la
//      plantilla no exista, el job deja los avisos en PENDIENTE y NO envía nada.
//   3. Tablero — a quién se le avisó, quién ya eligió y qué extras compró.
import { useState, useEffect, useRef } from 'react'
import { db } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { fmt, parsearErrorDB } from '@/lib/utils'
import { cargarPlantas, guardarPlanta, borrarPlanta, enviarAvisoPlanta,
         subirImagenPlanta, MAX_MB_PLANTA, ESTADO_ELECCION } from '@/lib/plantas'
import { Plus, Pencil, Trash2, CheckCircle, Leaf, Send, AlertCircle, Upload, Loader2 } from 'lucide-react'

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1'
const VACIA = { nombre: '', descripcion: '', imagen_url: '', precio: 0, elegible: true, adicional: false, orden: 100, activo: true }

export default function TabPlantas() {
  return (
    <div className="space-y-8">
      <Catalogo />
      <AvisoAutomatico />
      <Tablero />
    </div>
  )
}

// ─── 1. Catálogo ─────────────────────────────────────────────────────────────
function Catalogo() {
  const { confirm } = useConfirm()
  const [rows, setRows]   = useState([])
  const [load, setLoad]   = useState(true)
  const [sel, setSel]     = useState(null)
  const [err, setErr]     = useState('')
  const [saving, setSaving] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { recargar() }, [])

  /** Sube la foto y deja su URL en el formulario. No guarda: eso lo decide David. */
  async function subir(file) {
    if (!file) return
    setSubiendo(true); setErr('')
    try {
      const url = await subirImagenPlanta(file)
      setSel(p => ({ ...p, imagen_url: url }))
    } catch (e) { setErr(e.message) }
    finally { setSubiendo(false) }
  }
  async function recargar() {
    setLoad(true)
    try { setRows(await cargarPlantas()) } catch (e) { setErr(parsearErrorDB(e)) }
    finally { setLoad(false) }
  }

  async function guardar() {
    setSaving(true); setErr('')
    try { await guardarPlanta(sel); setSel(null); await recargar() }
    catch (e) { setErr(e.message || parsearErrorDB(e)) }
    finally { setSaving(false) }
  }

  async function eliminar(p) {
    // Borrar no es lo mismo que retirar: si alguien ya la eligió o la compró,
    // la FK lo impide. Desactivar conserva la historia.
    const ok = await confirm(
      'Si alguna familia ya la compró, la base lo impedirá. Para retirarla del portal sin perder la historia, desactívala.',
      { title: `¿Eliminar "${p.nombre}"?`, confirmLabel: 'Eliminar', variant: 'danger' }
    )
    if (!ok) return
    try { await borrarPlanta(p.id); await recargar() }
    catch (e) { setErr(parsearErrorDB(e)) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-bold text-gray-800 flex items-center gap-1.5">
          <Leaf size={14} /> Catálogo de plantas
        </h3>
        <Button onClick={() => setSel({ ...VACIA })}><Plus size={14} className="mr-1" /> Nueva</Button>
      </div>
      <p className="text-[12px] text-gray-500 mb-4">
        <strong>Opción</strong>: la que la familia escoge (va incluida, precio $0).
        <strong className="ml-2">Extra</strong>: se ofrece en el mismo portal con su precio y se suma al servicio.
        Una misma planta puede ser las dos cosas.
      </p>

      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{err}</div>}

      {load ? <div className="text-center py-8 text-gray-400">Cargando...</div> : (
        <TableWrap>
          <Table>
            <thead><tr>
              <Th>Planta</Th><Th>Uso</Th><Th>Precio</Th><Th>Orden</Th><Th>Estado</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map(p => (
                <Tr key={p.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      {p.imagen_url
                        ? <img src={p.imagen_url} alt="" loading="lazy"
                               className="w-9 h-9 rounded-lg object-cover shrink-0" />
                        : <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center"
                               style={{ background: '#F3F4F6' }}><Leaf size={14} className="text-gray-300" /></div>}
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900">{p.nombre}</div>
                        {p.descripcion && <div className="text-[11px] text-gray-400 max-w-xs">{p.descripcion}</div>}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {p.elegible  && <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#E8F3EB', color: '#1D8A55' }}>Opción</span>}
                      {p.adicional && <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#EEF3FB', color: '#3B6FBF' }}>Extra</span>}
                    </div>
                  </Td>
                  <Td>{Number(p.precio) > 0 ? fmt(p.precio) : <span className="text-gray-400">Incluida</span>}</Td>
                  <Td>{p.orden}</Td>
                  <Td>{p.activo
                    ? <span className="text-[11px] font-semibold text-green-700">Activa</span>
                    : <span className="text-[11px] font-semibold text-gray-400">Inactiva</span>}</Td>
                  <Td>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setSel({ ...p })} className="p-1.5 rounded hover:bg-gray-100" aria-label={`Editar ${p.nombre}`}><Pencil size={13} /></button>
                      <button onClick={() => eliminar(p)} className="p-1.5 rounded hover:bg-red-50 text-red-600" aria-label={`Eliminar ${p.nombre}`}><Trash2 size={13} /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {!rows.length && <Tr><Td colSpan={6}><div className="text-center py-6 text-gray-400 text-[13px]">Sin plantas todavía.</div></Td></Tr>}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)}
        title={sel?.id ? `Editar — ${sel.nombre}` : 'Nueva planta'} maxWidth="max-w-lg"
        footer={<>
          <Button variant="ghost" onClick={() => setSel(null)}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving || subiendo}>{saving ? 'Guardando...' : 'Guardar'}</Button>
        </>}>
        {sel && (
          <div className="space-y-3">
            <div><label className={LBL}>Nombre</label>
              <Input value={sel.nombre} onChange={e => setSel(p => ({ ...p, nombre: e.target.value }))} placeholder="Helecho" /></div>
            <div><label className={LBL}>Descripción (la ve la familia)</label>
              <Textarea rows={2} value={sel.descripcion || ''} onChange={e => setSel(p => ({ ...p, descripcion: e.target.value }))} /></div>
            <div>
              <label className={LBL}>Foto de la planta</label>
              <div className="flex items-start gap-3">
                <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
                     style={{ background: '#F3F4F6', border: '1px solid #E5E7EB' }}>
                  {sel.imagen_url
                    ? <img src={sel.imagen_url} alt={`Foto de ${sel.nombre || 'la planta'}`}
                           className="w-full h-full object-cover" />
                    : <Leaf size={20} className="text-gray-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <Button type="button" variant="secondary" disabled={subiendo}
                    onClick={() => fileRef.current?.click()}>
                    {subiendo
                      ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Subiendo…</>
                      : <><Upload size={14} className="mr-1.5" /> {sel.imagen_url ? 'Cambiar foto' : 'Subir foto'}</>}
                  </Button>
                  {sel.imagen_url && !subiendo && (
                    <button type="button" onClick={() => setSel(p => ({ ...p, imagen_url: '' }))}
                      className="block text-[11px] font-semibold text-red-500 mt-2">
                      Quitar foto
                    </button>
                  )}
                  <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                    Opcional. JPG, PNG o WEBP, hasta {MAX_MB_PLANTA} MB — se recomprime sola.
                    Si no pones foto, el portal dibuja la planta.
                  </p>
                </div>
              </div>
              {/* El input real va oculto: el botón de arriba es el que se ve */}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LBL}>Precio del extra</label>
                <Input type="number" min="0" value={sel.precio} onChange={e => setSel(p => ({ ...p, precio: e.target.value }))} />
                <p className="text-[10px] text-gray-400 mt-1">$0 si va incluida en el plan.</p></div>
              <div><label className={LBL}>Orden</label>
                <Input type="number" value={sel.orden} onChange={e => setSel(p => ({ ...p, orden: e.target.value }))} />
                <p className="text-[10px] text-gray-400 mt-1">Menor aparece primero.</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LBL}>¿Se puede elegir?</label>
                <Select value={sel.elegible ? 'true' : 'false'} onChange={e => setSel(p => ({ ...p, elegible: e.target.value === 'true' }))}>
                  <option value="true">Sí — aparece entre las opciones</option>
                  <option value="false">No</option>
                </Select></div>
              <div><label className={LBL}>¿Se ofrece como extra?</label>
                <Select value={sel.adicional ? 'true' : 'false'} onChange={e => setSel(p => ({ ...p, adicional: e.target.value === 'true' }))}>
                  <option value="false">No</option>
                  <option value="true">Sí — se vende con su precio</option>
                </Select></div>
            </div>
            <div><label className={LBL}>Estado</label>
              <Select value={sel.activo ? 'true' : 'false'} onChange={e => setSel(p => ({ ...p, activo: e.target.value === 'true' }))}>
                <option value="true">Activa</option>
                <option value="false">Inactiva (no se muestra)</option>
              </Select></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─── 2. Aviso automático ─────────────────────────────────────────────────────
function AvisoAutomatico() {
  const [cfg, setCfg]     = useState(null)
  const [load, setLoad]   = useState(true)
  const [save, setSave]   = useState(false)
  const [ok, setOk]       = useState(false)
  const [err, setErr]     = useState('')

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoad(true)
    const { data } = await db.from('config_operativa').select('clave, valor').eq('modulo', 'PLANTAS')
    const map = {}
    for (const r of data || []) map[r.clave] = r.valor
    const pl = map.plantilla && typeof map.plantilla === 'object' ? map.plantilla : {}
    setCfg({
      activo:              map.activo !== false,
      plantilla_nombre:    pl.nombre    || '',
      plantilla_idioma:    pl.idioma    || 'es_MX',
      plantilla_categoria: pl.categoria || 'UTILITY',
      max_envios:          map.max_envios_por_corrida ?? 30,
      max_adicionales:     map.max_adicionales ?? 4,
      dias_ventana:        map.dias_ventana_portal ?? 120,
      arranque_desde:      map.arranque_desde || '',
    })
    setLoad(false)
  }

  async function guardar() {
    setSave(true); setOk(false); setErr('')
    try {
      // La plantilla lleva SIEMPRE las mismas dos variables, en este orden:
      // {{1}} nombre de la mascota, {{2}} enlace del portal. Si Meta aprueba
      // otra forma, se cambia aquí y en el body de la plantilla, juntos.
      const plantilla = cfg.plantilla_nombre.trim()
        ? { nombre: cfg.plantilla_nombre.trim(), idioma: cfg.plantilla_idioma,
            categoria: cfg.plantilla_categoria, vars: ['mascota', 'enlace'] }
        : null
      const updates = [
        ['activo',                 !!cfg.activo],
        ['plantilla',              plantilla],
        ['max_envios_por_corrida', parseInt(cfg.max_envios) || 30],
        ['max_adicionales',        parseInt(cfg.max_adicionales) || 4],
        ['dias_ventana_portal',    parseInt(cfg.dias_ventana) || 120],
        ['arranque_desde',         cfg.arranque_desde || null],
      ]
      for (const [clave, valor] of updates) {
        const { error } = await db.from('config_operativa')
          .upsert({ modulo: 'PLANTAS', clave, valor }, { onConflict: 'modulo,clave' })
        if (error) throw error
      }
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(parsearErrorDB(e)) }
    finally { setSave(false) }
  }

  if (load || !cfg) return <div className="text-center py-6 text-gray-400">Cargando...</div>

  return (
    <div className="pt-6 border-t" style={{ borderColor: '#E5E7EB' }}>
      <h3 className="text-[14px] font-bold text-gray-800 mb-1">Aviso automático</h3>
      <p className="text-[12px] text-gray-500 mb-4">
        Se manda al cumplirse el compostaje: fecha de ingreso al cubículo + los meses que fijó
        el operario (2, 2.5 o 3). <strong>Sin plantilla aprobada no sale nada</strong>: los avisos
        quedan en «Por avisar» y se reportan.
      </p>

      {!cfg.plantilla_nombre.trim() && (
        <div className="mb-4 px-3 py-2.5 rounded-lg flex items-start gap-2 text-[12px]"
             style={{ background: '#FFF3DC', border: '1px solid #FFD980', color: '#9A5500' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Falta la plantilla de Meta. Créala en WhatsApp → Plantillas con dos variables
            (<strong>{'{{1}}'}</strong> nombre de la mascota, <strong>{'{{2}}'}</strong> enlace) y escribe aquí su nombre exacto.</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={LBL}>Aviso automático</label>
          <Select value={cfg.activo ? 'true' : 'false'} onChange={e => setCfg(p => ({ ...p, activo: e.target.value === 'true' }))}>
            <option value="true">Encendido</option>
            <option value="false">Apagado</option>
          </Select></div>
        <div className="sm:col-span-2"><label className={LBL}>Nombre exacto de la plantilla</label>
          <Input value={cfg.plantilla_nombre} onChange={e => setCfg(p => ({ ...p, plantilla_nombre: e.target.value }))}
            placeholder="eleccion_planta_cliente" /></div>
        <div><label className={LBL}>Idioma</label>
          <Input value={cfg.plantilla_idioma} onChange={e => setCfg(p => ({ ...p, plantilla_idioma: e.target.value }))} /></div>
        <div><label className={LBL}>Categoría en Meta</label>
          <Select value={cfg.plantilla_categoria} onChange={e => setCfg(p => ({ ...p, plantilla_categoria: e.target.value }))}>
            <option value="UTILITY">UTILITY</option>
            <option value="MARKETING">MARKETING</option>
          </Select>
          <p className="text-[10px] text-gray-400 mt-1">Debe coincidir con la aprobada, o Meta la rechaza.</p></div>
        <div><label className={LBL}>Máx. avisos por corrida</label>
          <Input type="number" min="1" value={cfg.max_envios} onChange={e => setCfg(p => ({ ...p, max_envios: e.target.value }))} /></div>
        <div><label className={LBL}>Extras que ve la familia</label>
          <Input type="number" min="0" value={cfg.max_adicionales} onChange={e => setCfg(p => ({ ...p, max_adicionales: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Es un momento sensible: pocos y los primeros por orden.</p></div>
        <div><label className={LBL}>Días que vive el enlace</label>
          <Input type="number" min="1" value={cfg.dias_ventana} onChange={e => setCfg(p => ({ ...p, dias_ventana: e.target.value }))} /></div>
        <div><label className={LBL}>No avisar antes de</label>
          <Input type="date" value={cfg.arranque_desde || ''} onChange={e => setCfg(p => ({ ...p, arranque_desde: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Deja vacío para incluir todo lo cumplido.</p></div>
      </div>

      {err && <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{err}</div>}
      <div className="flex items-center gap-3 mt-5">
        <Button onClick={guardar} disabled={save}>{save ? 'Guardando...' : 'Guardar'}</Button>
        {ok && <span className="flex items-center gap-1 text-[12px] font-semibold text-green-700"><CheckCircle size={14} /> Guardado</span>}
      </div>
    </div>
  )
}

// ─── 3. Tablero ──────────────────────────────────────────────────────────────
function Tablero() {
  const [rows, setRows] = useState([])
  const [load, setLoad] = useState(true)
  const [msg, setMsg]   = useState('')

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoad(true)
    const { data } = await db.from('v_plantas_pendientes')
      .select('*').order('fecha_cumplida', { ascending: false }).limit(200)
    setRows(data || [])
    setLoad(false)
  }

  async function reenviar(id) {
    setMsg('')
    try {
      const r = await enviarAvisoPlanta(id)
      setMsg(r.enviado ? '✅ Aviso enviado' : `No se envió: ${r.motivo || 'sin detalle'}`)
      await cargar()
    } catch (e) { setMsg('Error: ' + (e.message || '')) }
  }

  return (
    <div className="pt-6 border-t" style={{ borderColor: '#E5E7EB' }}>
      <h3 className="text-[14px] font-bold text-gray-800 mb-1">Quién ya eligió</h3>
      <p className="text-[12px] text-gray-500 mb-4">Compostajes cumplidos, su aviso y lo que compró la familia.</p>
      {msg && <div className="mb-3 text-[12px] font-medium text-gray-700">{msg}</div>}

      {load ? <div className="text-center py-8 text-gray-400">Cargando...</div> : (
        <TableWrap>
          <Table>
            <thead><tr>
              <Th>Mascota</Th><Th>Familia</Th><Th>Cumplió</Th><Th>Estado</Th>
              <Th>Planta</Th><Th>Extras</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const e = ESTADO_ELECCION[r.estado] || {}
                return (
                  <Tr key={r.eleccion_id}>
                    <Td><div className="font-semibold text-gray-900">{r.mascota}</div>
                      {r.cubiculo && <div className="text-[11px] text-gray-400">{r.cubiculo}</div>}</Td>
                    <Td><div className="text-[12px]">{r.propietario}</div>
                      <div className="text-[11px] text-gray-400">{r.whatsapp}</div></Td>
                    <Td>{r.fecha_cumplida}</Td>
                    <Td>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold"
                            style={{ background: e.bg, color: e.color }}>{e.label || r.estado}</span>
                      {r.error && <div className="text-[10px] text-red-600 max-w-[180px]">{r.error}</div>}
                    </Td>
                    <Td>{r.planta_nombre || <span className="text-gray-400">—</span>}</Td>
                    <Td>{r.extras_comprados > 0
                      ? <span className="font-semibold text-gray-900">{r.extras_comprados} · {fmt(r.valor_extras)}</span>
                      : <span className="text-gray-400">—</span>}</Td>
                    <Td>
                      {['PENDIENTE', 'ERROR'].includes(r.estado) && (
                        <button onClick={() => reenviar(r.eleccion_id)}
                          className="p-1.5 rounded hover:bg-gray-100" aria-label={`Enviar aviso a ${r.propietario}`}>
                          <Send size={13} />
                        </button>
                      )}
                    </Td>
                  </Tr>
                )
              })}
              {!rows.length && <Tr><Td colSpan={7}><div className="text-center py-6 text-gray-400 text-[13px]">
                Nadie ha cumplido los meses de compostaje todavía.
              </div></Td></Tr>}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  )
}
