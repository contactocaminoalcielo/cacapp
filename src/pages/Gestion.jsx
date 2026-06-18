import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { HorarioEditor } from '@/components/ui/horario-editor'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { fmt, parsearErrorDB } from '@/lib/utils'
import { Plus, Search, Trash2, ArrowUpCircle, ArrowDownCircle, History, Upload, Download, CheckCircle2, XCircle, AlertTriangle, FileDown } from 'lucide-react'
import { ESTADO_COLOR, ESTADO_LABEL } from '@/lib/constants'

// Convierte solo los campos indicados a null cuando están vacíos (para enums/FK opcionales)
const nullify = (obj, keys) => {
  const out = { ...obj }
  keys.forEach(k => { if (out[k] === '') out[k] = null })
  return out
}

function useSearch(data, fields) {
  const [q, setQ] = useState('')
  const filtered = data.filter(item =>
    !q || fields.some(f => String(item[f] || '').toLowerCase().includes(q.toLowerCase()))
  )
  return { q, setQ, filtered }
}

// ─── CSV parser genérico ───────────────────────────────────────────────────────
function parsearCSV(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lineas.length < 2) return { headers: [], filas: [] }

  // Detectar delimitador automáticamente (coma o punto y coma)
  const delim = (lineas[0].split(';').length > lineas[0].split(',').length) ? ';' : ','

  function parsearLinea(linea) {
    const campos = []
    let dentro = false, campo = ''
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (c === '"') { dentro = !dentro }
      else if (c === delim && !dentro) { campos.push(campo.trim()); campo = '' }
      else { campo += c }
    }
    campos.push(campo.trim())
    return campos
  }

  const headers = parsearLinea(lineas[0]).map(h => h.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/\s+/g, '_'))
  const filas = lineas.slice(1).map((l, i) => {
    const vals = parsearLinea(l)
    const obj = {}
    headers.forEach((h, j) => { obj[h] = vals[j] ?? '' })
    obj._linea = i + 2
    return obj
  }).filter(f => Object.values(f).some(v => v && v !== ''))

  return { headers, filas }
}

// ─── Importar CSV Aliados ──────────────────────────────────────────────────────
const ALIADO_HEADER_MAP = {
  nombre:             'nombre',
  nit_cedula:         'identificacion_nit',
  nit:                'identificacion_nit',
  identificacion_nit: 'identificacion_nit',
  cedula:             'identificacion_nit',
  contacto_nombre:    'contacto_nombre',
  contacto:           'contacto_nombre',
  whatsapp:           'whatsapp',
  telefono:           'telefono',
  ciudad:             'ciudad',
  localidad:          'localidad',
  barrio:             'barrio',
  direccion:          'direccion',
  modalidad_comision: 'modalidad_comision',
  modalidad:          'modalidad_comision',
  comision:           'modalidad_comision',
  vip:                'vip',
}

const MODALIDAD_MAP = {
  facturacion_mensual:  'FACTURACION_MENSUAL',
  facturacion:          'FACTURACION_MENSUAL',
  mensual:              'FACTURACION_MENSUAL',
  descuento_inmediato:  'DESCUENTO_INMEDIATO',
  descuento:            'DESCUENTO_INMEDIATO',
  inmediato:            'DESCUENTO_INMEDIATO',
  credito_acumulado:    'CREDITO_ACUMULADO',
  credito:              'CREDITO_ACUMULADO',
  acumulado:            'CREDITO_ACUMULADO',
}

function normalizarModalidad(val) {
  if (!val) return 'FACTURACION_MENSUAL'
  const key = val.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')
  return MODALIDAD_MAP[key] || 'FACTURACION_MENSUAL'
}

function normalizarVip(val) {
  if (!val) return false
  const v = val.toLowerCase().trim()
  return ['si', 'sí', '1', 'true', 'verdadero', 'yes', 'vip'].includes(v)
}

function validarFilaAliado(fila, headers) {
  const mapped = {}
  headers.forEach(h => {
    const destino = ALIADO_HEADER_MAP[h]
    if (destino && fila[h] !== undefined) mapped[destino] = fila[h]
  })

  const errores = []
  if (!mapped.nombre?.trim()) errores.push('Nombre requerido')

  const modalidad = normalizarModalidad(mapped.modalidad_comision)
  const validas = ['FACTURACION_MENSUAL', 'DESCUENTO_INMEDIATO', 'CREDITO_ACUMULADO']
  if (mapped.modalidad_comision && !validas.includes(modalidad)) {
    errores.push(`Modalidad inválida: "${mapped.modalidad_comision}"`)
  }

  const row = {
    nombre:             (mapped.nombre || '').trim(),
    identificacion_nit: (mapped.identificacion_nit || '').trim() || null,
    contacto_nombre:    (mapped.contacto_nombre || '').trim() || null,
    whatsapp:           (mapped.whatsapp || '').trim() || null,
    telefono:           (mapped.telefono || '').trim() || null,
    ciudad:             (mapped.ciudad || '').trim() || 'Bogotá',
    localidad:          (mapped.localidad || '').trim() || null,
    barrio:             (mapped.barrio || '').trim() || null,
    direccion:          (mapped.direccion || '').trim() || null,
    modalidad_comision: modalidad,
    vip:                normalizarVip(mapped.vip),
    activo:             true,
  }

  return { row, errores, linea: fila._linea }
}

const TEMPLATE_CSV = `nombre;nit_cedula;contacto_nombre;whatsapp;telefono;ciudad;localidad;barrio;direccion;modalidad_comision;vip
Veterinaria El Bosque;900123456;Dr. Juan Pérez;3001234567;6012345678;Bogotá;Chapinero;El Bosque;Calle 72 # 14-20;FACTURACION_MENSUAL;NO
Clínica Veterinaria Norte;900654321;Dra. Ana López;3109876543;;Bogotá;Usaquén;Santa Bárbara;Carrera 15 # 118-30;DESCUENTO_INMEDIATO;SI
`

function descargarTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'plantilla_aliados.csv'
  a.click(); URL.revokeObjectURL(url)
}

function ImportarAliadosModal({ onClose, onImportado }) {
  const [fase, setFase]         = useState('upload')  // upload | preview | done
  const [filas, setFilas]       = useState([])
  const [headers, setHeaders]   = useState([])
  const [saving, setSaving]     = useState(false)
  const [resultado, setResultado] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  function procesarArchivo(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const texto = e.target.result
      const { headers: hs, filas: fs } = parsearCSV(texto)
      const tieneNombre = hs.some(h => ALIADO_HEADER_MAP[h] === 'nombre')
      if (!tieneNombre) {
        alert('El archivo no tiene columna "nombre". Descarga la plantilla y úsala como base.')
        return
      }
      setHeaders(hs)
      setFilas(fs.map(f => validarFilaAliado(f, hs)))
      setFase('preview')
    }
    reader.readAsText(file, 'UTF-8')
  }

  const validas   = filas.filter(f => f.errores.length === 0)
  const invalidas = filas.filter(f => f.errores.length > 0)

  async function importar() {
    if (!validas.length) return
    setSaving(true)
    const rows  = validas.map(f => f.row)
    const okList = []
    const errList = []

    // Insertar en lotes de 50 para no sobrecargar
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      const { error } = await db.from('aliados').insert(batch)
      if (error) {
        batch.forEach(r => errList.push({ nombre: r.nombre, msg: error.message }))
      } else {
        okList.push(...batch.map(r => r.nombre))
      }
    }

    setSaving(false)
    setResultado({ ok: okList.length, errores: errList })
    setFase('done')
    if (okList.length > 0) onImportado()
  }

  return (
    <Modal open onClose={onClose} title="Importar aliados desde CSV" maxWidth="max-w-2xl">
      {/* ── Fase upload ── */}
      {fase === 'upload' && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 bg-blue-50 border border-blue-200 text-[12px] text-blue-800 space-y-1">
            <p className="font-semibold">Formato esperado del archivo CSV</p>
            <p>Columnas: <code className="bg-blue-100 px-1 rounded">nombre</code> (requerida), nit_cedula, contacto_nombre, whatsapp, telefono, ciudad, localidad, barrio, direccion, modalidad_comision, vip</p>
            <p>Delimitador: coma <strong>(,)</strong> o punto y coma <strong>(;)</strong> — se detecta automáticamente.</p>
            <p><strong>modalidad_comision</strong>: FACTURACION_MENSUAL / DESCUENTO_INMEDIATO / CREDITO_ACUMULADO</p>
            <p><strong>vip</strong>: SI / NO (o 1 / 0)</p>
          </div>

          <button
            onClick={descargarTemplate}
            className="flex items-center gap-2 text-[12px] font-medium text-[#1A5CD8] hover:underline"
          >
            <Download size={14} /> Descargar plantilla de ejemplo
          </button>

          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${dragOver ? 'border-[#1A5CD8] bg-green-50' : 'border-gray-300 hover:border-[#1A5CD8] hover:bg-gray-50'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); procesarArchivo(e.dataTransfer.files[0]) }}
            onClick={() => document.getElementById('csv-input-aliados').click()}
          >
            <Upload size={28} className="mx-auto mb-2 text-gray-400" />
            <p className="font-semibold text-gray-600 text-[13px]">Arrastra tu archivo CSV aquí</p>
            <p className="text-[11px] text-gray-400 mt-1">o haz clic para seleccionar</p>
            <input
              id="csv-input-aliados"
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={e => procesarArchivo(e.target.files[0])}
            />
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* ── Fase preview ── */}
      {fase === 'preview' && (
        <div className="space-y-4">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl p-3 text-center bg-green-50 border border-green-200">
              <p className="text-[22px] font-bold text-green-700">{validas.length}</p>
              <p className="text-[11px] text-green-600">Listos para importar</p>
            </div>
            <div className={`rounded-xl p-3 text-center border ${invalidas.length > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-[22px] font-bold ${invalidas.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>{invalidas.length}</p>
              <p className="text-[11px] text-gray-500">Con errores (se omitirán)</p>
            </div>
            <div className="rounded-xl p-3 text-center bg-gray-50 border border-gray-200">
              <p className="text-[22px] font-bold text-gray-700">{filas.length}</p>
              <p className="text-[11px] text-gray-500">Total en archivo</p>
            </div>
          </div>

          {/* Filas con error */}
          {invalidas.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-1 max-h-32 overflow-y-auto">
              <p className="text-[11px] font-bold text-red-700 mb-1">Filas con error — se omitirán:</p>
              {invalidas.map(f => (
                <p key={f.linea} className="text-[11px] text-red-600">
                  Línea {f.linea}: {f.row.nombre || '(sin nombre)'} — {f.errores.join(', ')}
                </p>
              ))}
            </div>
          )}

          {/* Preview de filas válidas */}
          {validas.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <div className="px-4 py-2 bg-gray-50 border-b text-[11px] font-bold text-gray-500 uppercase tracking-wide" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                Vista previa — primeras {Math.min(validas.length, 8)} filas
              </div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {['Nombre','NIT/Cédula','Contacto','WhatsApp','Ciudad','Modalidad','VIP'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validas.slice(0, 8).map((f, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                        <td className="px-3 py-2 font-medium text-gray-900">{f.row.nombre}</td>
                        <td className="px-3 py-2 text-gray-500">{f.row.identificacion_nit || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{f.row.contacto_nombre || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{f.row.whatsapp || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{f.row.ciudad}</td>
                        <td className="px-3 py-2 text-gray-500 text-[10px]">{f.row.modalidad_comision}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded-full font-bold ${f.row.vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-gray-100 text-gray-400'}`}>
                            {f.row.vip ? 'VIP' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {validas.length > 8 && (
                      <tr><td colSpan={7} className="px-3 py-2 text-center text-[11px] text-gray-400">… y {validas.length - 8} más</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {validas.length === 0 && (
            <div className="rounded-xl p-6 text-center border border-red-200 bg-red-50">
              <XCircle size={28} className="mx-auto mb-2 text-red-500" />
              <p className="font-semibold text-red-700">Ninguna fila válida para importar</p>
              <p className="text-[12px] text-red-500 mt-1">Revisa los errores arriba y corrige el archivo.</p>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setFase('upload')}>← Cambiar archivo</Button>
            <Button onClick={importar} disabled={saving || validas.length === 0}>
              <Upload size={13} /> {saving ? 'Importando...' : `Importar ${validas.length} aliado${validas.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Fase done ── */}
      {fase === 'done' && resultado && (
        <div className="space-y-4">
          {resultado.ok > 0 && (
            <div className="rounded-xl p-5 text-center bg-green-50 border border-green-200">
              <CheckCircle2 size={36} className="mx-auto mb-2 text-green-600" />
              <p className="text-[20px] font-bold text-green-700">{resultado.ok} aliado{resultado.ok !== 1 ? 's' : ''} importado{resultado.ok !== 1 ? 's' : ''}</p>
            </div>
          )}
          {resultado.errores.length > 0 && (
            <div className="rounded-xl p-4 bg-red-50 border border-red-200 space-y-1">
              <p className="text-[12px] font-bold text-red-700">{resultado.errores.length} error{resultado.errores.length !== 1 ? 'es' : ''} al insertar:</p>
              {resultado.errores.map((e, i) => (
                <p key={i} className="text-[11px] text-red-600">{e.nombre}: {e.msg}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// --- CLIENTES TAB ---
function TabClientes({ isAdmin }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','apellido','cedula_nit','whatsapp','email'])

  useEffect(() => {
    cargar()
    const canal = db
      .channel('gestion-clientes-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('clientes').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', apellido: item.apellido || '',
      cedula_nit: item.cedula_nit || '', whatsapp: item.whatsapp || '',
      telefono: item.telefono || '', telefono2: item.telefono2 || '', email: item.email || '',
      direccion: item.direccion || '', ciudad: item.ciudad || 'Bogotá',
      tipo_cliente: item.tipo_cliente || 'NORMAL', activo: item.activo !== false,
    } : { nombre:'',apellido:'',cedula_nit:'',whatsapp:'',telefono:'',telefono2:'',email:'',direccion:'',ciudad:'Bogotá',tipo_cliente:'NORMAL',activo:true })
  }
  async function guardar() {
    if (!form.nombre?.trim()) { await showAlert('El nombre es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = nullify(form, ['tipo_cliente'])
    const { error } = selected?.id_cliente
      ? await db.from('clientes').update(body).eq('id_cliente', selected.id_cliente)
      : await db.from('clientes').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar()
    setSelected(null)
  }
  async function eliminar(c) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${c.nombre} ${c.apellido || ''}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('clientes').delete().eq('id_cliente', c.id_cliente)
    if (error) {
      if (error.code === '23503') {
        if (await confirm(`Tiene servicios o mascotas registradas y no se puede eliminar.\n¿Marcarlo como INACTIVO en su lugar?`, { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' })) {
          await db.from('clientes').update({ activo: false }).eq('id_cliente', c.id_cliente)
          await cargar()
        }
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>Tipo</Th><Th>Activo</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(c => (
              <Tr key={c.id_cliente}>
                <Td><div className="font-semibold text-ink">{c.nombre} {c.apellido}</div></Td>
                <Td className="text-ink3">{c.cedula_nit}</Td>
                <Td className="text-ink3">{c.whatsapp}</Td>
                <Td className="text-ink3">{c.ciudad}</Td>
                <Td className="text-ink3">{c.tipo_cliente}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{c.activo ? 'Sí' : 'No'}</span></Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(c)}>Editar</Button>
                      <button onClick={() => eliminar(c)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id_cliente ? 'Editar cliente' : 'Nuevo cliente'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[['nombre','Nombre',80,true],['apellido','Apellido',80,true],['cedula_nit','Cédula/NIT',30,false],['whatsapp','WhatsApp',20,false],['telefono','2do contacto',20,false],['telefono2','3er contacto',20,false],['email','Email',null,false],['ciudad','Ciudad',80,true],['direccion','Dirección',null,true]].map(([k,l,ml,uc]) => (
                <div key={k} className={k === 'direccion' ? 'col-span-2' : ''}>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label>
                  <Input value={form[k] || ''} onChange={e => setForm(p => ({ ...p, [k]: uc ? e.target.value.toUpperCase() : e.target.value }))} {...(ml ? { maxLength: ml } : {})} />
                </div>
              ))}
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Tipo cliente</label>
                <Select value={form.tipo_cliente || 'NORMAL'} onChange={e => setForm(p => ({ ...p, tipo_cliente: e.target.value }))}>
                  <option value="NORMAL">Normal</option>
                  <option value="VIP">VIP</option>
                  <option value="RECURRENTE">Recurrente</option>
                </Select>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- MASCOTAS TAB ---
function TabMascotas({ isAdmin, canEdit }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData] = useState([])
  const [especies, setEspecies] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','raza'])

  useEffect(() => {
    cargar()
    const canal = db
      .channel('gestion-mascotas-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mascotas' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])
  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: esp }] = await Promise.all([
      db.from('mascotas').select('*, especies(nombre), clientes(nombre,apellido)').order('nombre'),
      db.from('especies').select('*').order('nombre'),
    ])
    setData(d || [])
    setEspecies(esp || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', especie_id: item.especie_id || '',
      raza: item.raza || '', sexo: item.sexo || 'Macho',
      peso_kg: item.peso_kg || '', tamano: item.tamano || 'Mediano', notas: item.notas || '',
    } : { nombre:'',especie_id:'',raza:'',sexo:'Macho',peso_kg:'',tamano:'Mediano',notas:'' })
  }
  async function guardar() {
    if (!form.nombre?.trim()) { await showAlert('El nombre es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = nullify({ ...form, peso_kg: parseFloat(form.peso_kg) || 0 }, ['especie_id'])
    const { error } = selected?.id_mascota
      ? await db.from('mascotas').update(body).eq('id_mascota', selected.id_mascota)
      : await db.from('mascotas').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(m) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${m.nombre}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('mascotas').delete().eq('id_mascota', m.id_mascota)
    if (error) {
      if (error.code === '23503') {
        await showAlert(`${m.nombre} tiene servicios registrados y no se puede eliminar.\nSi necesitas desactivarla, edita el registro del cliente.`, { title: 'No se puede eliminar', variant: 'warning' })
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Especie</Th><Th>Raza</Th><Th>Peso</Th><Th>Cliente</Th>{(canEdit || isAdmin) && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(m => (
              <Tr key={m.id_mascota}>
                <Td className="font-semibold text-ink">{m.nombre}</Td>
                <Td className="text-ink3">{m.especies?.nombre}</Td>
                <Td className="text-ink3">{m.raza || '-'}</Td>
                <Td className="text-ink3">{m.peso_kg}kg</Td>
                <Td className="text-ink3">{m.clientes?.nombre} {m.clientes?.apellido}</Td>
                {(canEdit || isAdmin) && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(m)}>Editar</Button>
                      {isAdmin && (
                        <button onClick={() => eliminar(m)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Editar mascota" maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre</label><Input value={form.nombre||''} onChange={e => setForm(p => ({...p,nombre:e.target.value}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Especie</label>
              <Select value={form.especie_id||''} onChange={e => setForm(p => ({...p,especie_id:e.target.value}))}>
                <option value="">Seleccionar...</option>
                {especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Raza</label><Input value={form.raza||''} onChange={e => setForm(p => ({...p,raza:e.target.value}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Peso (kg)</label><Input type="text" inputMode="decimal" placeholder="Ej: 28.5" value={form.peso_kg||''} onChange={e => setForm(p => ({...p,peso_kg:e.target.value.replace(',','.')}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Sexo</label>
              <Select value={form.sexo||'Macho'} onChange={e => setForm(p => ({...p,sexo:e.target.value}))}>
                <option value="Macho">Macho</option><option value="Hembra">Hembra</option>
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Tamaño</label>
              <Select value={form.tamano||'Mediano'} onChange={e => setForm(p => ({...p,tamano:e.target.value}))}>
                <option value="Mini">Mini</option><option value="Pequeño">Pequeño</option><option value="Mediano">Mediano</option><option value="Grande">Grande</option><option value="Gigante">Gigante</option>
              </Select></div>
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label><Textarea value={form.notas||''} onChange={e => setForm(p => ({...p,notas:e.target.value}))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- ALIADOS TAB ---
function TabAliados({ isAdmin, canEdit }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','contacto_nombre','ciudad'])

  useEffect(() => {
    cargar()
    const canal = db
      .channel('gestion-aliados-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aliados' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('aliados').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', identificacion_nit: item.identificacion_nit || '',
      contacto_nombre: item.contacto_nombre || '', whatsapp: item.whatsapp || '',
      telefono: item.telefono || '', email: item.email || '',
      ciudad: item.ciudad || 'Bogotá', localidad: item.localidad || '',
      barrio: item.barrio || '', direccion: item.direccion || '',
      notas: item.notas || '', vip: item.vip || false,
      modalidad_comision: item.modalidad_comision || 'FACTURACION_MENSUAL',
      saldo_comision: item.saldo_comision || 0, activo: item.activo !== false,
      horario: item.horario || {},
    } : { nombre:'',identificacion_nit:'',contacto_nombre:'',whatsapp:'',telefono:'',email:'',ciudad:'Bogotá',localidad:'',barrio:'',direccion:'',notas:'',vip:false,modalidad_comision:'FACTURACION_MENSUAL',saldo_comision:0,activo:true,horario:{} })
  }
  async function guardar() {
    if (!form.nombre?.trim()) { await showAlert('El nombre es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = nullify(form, ['modalidad_comision'])
    const { error } = selected?.id_aliado
      ? await db.from('aliados').update(body).eq('id_aliado', selected.id_aliado)
      : await db.from('aliados').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(a) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${a.nombre}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('aliados').delete().eq('id_aliado', a.id_aliado)
    if (error) {
      if (error.code === '23503') {
        if (await confirm(`Tiene servicios registrados y no se puede eliminar.\n¿Marcarlo como INACTIVO en su lugar?`, { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' })) {
          await db.from('aliados').update({ activo: false }).eq('id_aliado', a.id_aliado)
          await cargar()
        }
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {(canEdit || isAdmin) && (
          <>
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setModalImport(true)}>
                <Upload size={14} /> Importar CSV
              </Button>
            )}
            <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo aliado</Button>
          </>
        )}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Contacto</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>VIP</Th><Th>Saldo</Th>{(canEdit || isAdmin) && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(a => (
              <Tr key={a.id_aliado}>
                <Td className="font-semibold text-ink">{a.nombre}</Td>
                <Td className="text-ink3">{a.contacto_nombre}</Td>
                <Td className="text-ink3">{a.whatsapp}</Td>
                <Td className="text-ink3">{a.ciudad}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#F0F0F0] text-[#555]'}`}>{a.vip ? 'VIP' : 'No'}</span></Td>
                <Td className="font-semibold text-ink">{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(a.saldo_comision||0)}</Td>
                {(canEdit || isAdmin) && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(a)}>Editar</Button>
                      {isAdmin && (
                        <button onClick={() => eliminar(a)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id_aliado ? 'Editar aliado' : 'Nuevo aliado'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="space-y-4">
            {/* Establecimiento */}
            <div>
              <p className="text-[10px] font-bold text-ink3 uppercase tracking-wider mb-2">Establecimiento</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre *</label><Input value={form.nombre||''} onChange={e => setForm(p=>({...p,nombre:e.target.value}))} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">NIT / Cédula</label><Input value={form.identificacion_nit||''} onChange={e => setForm(p=>({...p,identificacion_nit:e.target.value}))} maxLength={30} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Ciudad</label><Input value={form.ciudad||''} onChange={e => setForm(p=>({...p,ciudad:e.target.value.toUpperCase()}))} maxLength={80} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Barrio</label><Input value={form.barrio||''} onChange={e => setForm(p=>({...p,barrio:e.target.value.toUpperCase()}))} maxLength={80} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Localidad</label><LocalidadSelect value={form.localidad||''} onChange={v => setForm(p=>({...p,localidad:v}))} /></div>
                <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Dirección</label><Input value={form.direccion||''} onChange={e => setForm(p=>({...p,direccion:e.target.value.toUpperCase()}))} placeholder="CALLE, CARRERA, NÚMERO…" /></div>
              </div>
            </div>
            {/* Contacto */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-[10px] font-bold text-ink3 uppercase tracking-wider mb-2">Contacto</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre contacto</label><Input value={form.contacto_nombre||''} onChange={e => setForm(p=>({...p,contacto_nombre:e.target.value}))} maxLength={80} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">WhatsApp</label><Input value={form.whatsapp||''} onChange={e => setForm(p=>({...p,whatsapp:e.target.value}))} maxLength={20} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Teléfono fijo</label><Input value={form.telefono||''} onChange={e => setForm(p=>({...p,telefono:e.target.value}))} maxLength={20} /></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Email</label><Input type="email" value={form.email||''} onChange={e => setForm(p=>({...p,email:e.target.value}))} placeholder="contacto@vet.com" /></div>
                <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-2">Horario de atención</label><HorarioEditor value={form.horario||{}} onChange={v => setForm(p=>({...p,horario:v}))} /></div>
                <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Notas internas</label><Input value={form.notas||''} onChange={e => setForm(p=>({...p,notas:e.target.value}))} placeholder="Observaciones, condiciones especiales..." /></div>
              </div>
            </div>
            {/* Comisiones */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-[10px] font-bold text-ink3 uppercase tracking-wider mb-2">Comisiones y configuración</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">Modalidad comisión</label>
                  <Select value={form.modalidad_comision||'FACTURACION_MENSUAL'} onChange={e => setForm(p=>({...p,modalidad_comision:e.target.value}))}>
                    <option value="FACTURACION_MENSUAL">Facturación mensual</option>
                    <option value="DESCUENTO_INMEDIATO">Descuento inmediato</option>
                    <option value="CREDITO_ACUMULADO">Crédito acumulado</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-2 pt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!form.vip} onChange={e => setForm(p=>({...p,vip:e.target.checked}))} className="w-4 h-4 accent-[#1A5CD8]" />
                    <span className="text-[12px] font-semibold text-ink2">Aliado VIP</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.activo !== false} onChange={e => setForm(p=>({...p,activo:e.target.checked}))} className="w-4 h-4 accent-[#1A5CD8]" />
                    <span className="text-[12px] font-semibold text-ink2">Activo</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {modalImport && (
        <ImportarAliadosModal
          onClose={() => setModalImport(false)}
          onImportado={() => { cargar(); setModalImport(false) }}
        />
      )}
    </div>
  )
}

// --- PERSONAL TAB ---
function TabPersonal({ isAdmin }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','apellido','cedula'])

  useEffect(() => {
    cargar()
    const canal = db
      .channel('gestion-personal-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'personal' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])
  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: r }] = await Promise.all([
      db.from('personal').select('*, roles_personal(nombre)').order('nombre'),
      db.from('roles_personal').select('*').order('nombre'),
    ])
    setData(d || [])
    setRoles(r || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', apellido: item.apellido || '',
      cedula: item.cedula || '', whatsapp: item.whatsapp || '',
      tipo_vehiculo: item.tipo_vehiculo || '', placa_vehiculo: item.placa_vehiculo || '',
      activo: item.activo !== false, rol_principal_id: item.rol_principal_id || '',
    } : { nombre:'',apellido:'',cedula:'',whatsapp:'',tipo_vehiculo:'',placa_vehiculo:'',activo:true,rol_principal_id:'' })
  }
  async function guardar() {
    if (!form.nombre?.trim())   { await showAlert('El nombre es requerido.',   { title: 'Campo requerido', variant: 'warning' }); return }
    if (!form.apellido?.trim()) { await showAlert('El apellido es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = {
      nombre:          form.nombre.trim(),
      apellido:        form.apellido.trim(),
      cedula:          form.cedula?.trim()   || null,
      whatsapp:        form.whatsapp?.trim() || null,
      tipo_vehiculo:   form.tipo_vehiculo    || null,
      placa_vehiculo:  form.placa_vehiculo?.trim() || null,
      activo:          form.activo,
      rol_principal_id: form.rol_principal_id ? parseInt(form.rol_principal_id) : null,
    }
    const { error } = selected?.id
      ? await db.from('personal').update(body).eq('id', selected.id)
      : await db.from('personal').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(p) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${p.nombre} ${p.apellido || ''}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('personal').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        if (await confirm(`Tiene servicios registrados y no se puede eliminar.\n¿Marcarlo como INACTIVO en su lugar?`, { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' })) {
          await db.from('personal').update({ activo: false }).eq('id', p.id)
          await cargar()
        }
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Rol</Th><Th>Vehículo</Th><Th>Activo</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(p => (
              <Tr key={p.id}>
                <Td className="font-semibold text-ink">{p.nombre} {p.apellido}</Td>
                <Td className="text-ink3">{p.cedula}</Td>
                <Td className="text-ink3">{p.whatsapp}</Td>
                <Td className="text-ink3">{p.roles_personal?.nombre || '-'}</Td>
                <Td className="text-ink3">{p.tipo_vehiculo} {p.placa_vehiculo}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{p.activo ? 'Sí' : 'No'}</span></Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button>
                      <button onClick={() => eliminar(p)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id ? 'Editar personal' : 'Nuevo personal'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            {[['nombre','Nombre *',80,true],['apellido','Apellido *',80,true],['cedula','Cédula',20,false],['whatsapp','WhatsApp',20,false],['placa_vehiculo','Placa vehículo',10,true]].map(([k,l,ml,uc]) => (
              <div key={k}><label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label><Input value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:uc ? e.target.value.toUpperCase() : e.target.value}))} {...(ml ? { maxLength: ml } : {})} /></div>
            ))}
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Tipo vehículo</label>
              <Select value={form.tipo_vehiculo||''} onChange={e => setForm(p=>({...p,tipo_vehiculo:e.target.value}))}>
                <option value="">Sin vehículo</option>
                <option value="moto_cajon">Moto cajón</option>
                <option value="moto_trailer">Moto tráiler</option>
                <option value="camioneta">Camioneta</option>
                <option value="bicicleta">Bicicleta</option>
                <option value="a_pie">A pie</option>
              </Select>
            </div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Rol</label>
              <Select value={form.rol_principal_id||''} onChange={e => setForm(p=>({...p,rol_principal_id:e.target.value}))}>
                <option value="">Seleccionar...</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </Select></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- INVENTARIO TAB ---
function TabInventario({ isAdmin }) {
  const { confirm, alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [movItem, setMovItem] = useState(null)       // ítem para registrar movimiento
  const [movForm, setMovForm] = useState({ tipo: 'ENTRADA', cantidad: '', motivo: '' })
  const [movSaving, setMovSaving] = useState(false)
  const [histItem, setHistItem] = useState(null)     // ítem para ver historial
  const [histData, setHistData] = useState([])
  const { q, setQ, filtered } = useSearch(data, ['nombre','descripcion','proveedor','ubicacion'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('inventario').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', descripcion: item.descripcion || '',
      unidad: item.unidad || '', stock_actual: item.stock_actual || 0,
      stock_minimo: item.stock_minimo || 0, proveedor: item.proveedor || '',
      precio_unitario: item.precio_unitario || 0, ubicacion: item.ubicacion || '',
      activo: item.activo !== false,
    } : { nombre:'',descripcion:'',unidad:'',stock_actual:0,stock_minimo:0,proveedor:'',precio_unitario:0,ubicacion:'',activo:true })
  }

  async function guardar() {
    if (!form.nombre?.trim()) { await showAlert('El nombre es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = { ...form, stock_actual: parseFloat(form.stock_actual)||0, stock_minimo: parseFloat(form.stock_minimo)||0, precio_unitario: parseFloat(form.precio_unitario)||0 }
    const { error } = selected?.id
      ? await db.from('inventario').update(body).eq('id', selected.id)
      : await db.from('inventario').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar(); setSelected(null)
  }

  async function eliminar(i) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar "${i.nombre}"?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('inventario').delete().eq('id', i.id)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' }); return }
    await cargar()
  }

  async function registrarMovimiento() {
    if (!movForm.cantidad || parseFloat(movForm.cantidad) <= 0) { await showAlert('Ingrese una cantidad válida.', { title: 'Aviso', variant: 'warning' }); return }
    setMovSaving(true)
    try {
      const cant = parseFloat(movForm.cantidad)
      const delta = movForm.tipo === 'ENTRADA' ? cant : -cant
      const nuevoStock = (movItem.stock_actual || 0) + delta
      if (nuevoStock < 0) { await showAlert('El stock no puede quedar negativo.', { title: 'Aviso', variant: 'warning' }); setMovSaving(false); return }
      await db.from('movimientos_inventario').insert({
        inventario_id: movItem.id,
        tipo: movForm.tipo,
        cantidad: cant,
        motivo: movForm.motivo || null,
        registrado_por: personalData?.id || null,
      })
      await db.from('inventario').update({ stock_actual: nuevoStock }).eq('id', movItem.id)
      await cargar()
      setMovItem(null)
      setMovForm({ tipo: 'ENTRADA', cantidad: '', motivo: '' })
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally {
      setMovSaving(false)
    }
  }

  async function verHistorial(item) {
    setHistItem(item)
    const { data: d } = await db.from('movimientos_inventario')
      .select('*, personal(nombre,apellido)')
      .eq('inventario_id', item.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setHistData(d || [])
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Unidad</Th><Th>Stock actual</Th><Th>Stock mínimo</Th><Th>Proveedor</Th><Th>Precio</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(i => {
              const bajo = i.stock_actual < i.stock_minimo
              return (
                <Tr key={i.id} className={bajo ? 'bg-danger-light/50' : ''}>
                  <Td>
                    <div className="font-semibold text-ink">{i.nombre}</div>
                    <div className="text-[10px] text-ink3">{i.descripcion}</div>
                    {bajo && <span className="text-[9px] font-bold text-danger bg-danger-light px-1.5 py-0.5 rounded-full">STOCK BAJO</span>}
                  </Td>
                  <Td className="text-ink3">{i.unidad}</Td>
                  <Td><span className={`font-bold text-lg ${bajo ? 'text-danger' : 'text-ink'}`}>{i.stock_actual}</span></Td>
                  <Td className="text-ink3">{i.stock_minimo}</Td>
                  <Td className="text-ink3">{i.proveedor}</Td>
                  <Td className="text-ink2">{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(i.precio_unitario||0)}</Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setMovItem(i); setMovForm({ tipo: 'ENTRADA', cantidad: '', motivo: '' }) }}
                        title="Registrar movimiento"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[#1D8A55] hover:bg-green-light transition-colors">
                        <ArrowUpCircle size={15} />
                      </button>
                      <button onClick={() => verHistorial(i)}
                        title="Ver historial"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-ink3 hover:bg-surface2 transition-colors">
                        <History size={14} />
                      </button>
                      {isAdmin && <>
                        <Button size="sm" variant="ghost" onClick={() => abrir(i)}>Editar</Button>
                        <button onClick={() => eliminar(i)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </>}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table></TableWrap>
      )}

      {/* Modal editar/nuevo ítem */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id ? 'Editar ítem' : 'Nuevo ítem'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre</label><Input value={form.nombre||''} onChange={e => setForm(p=>({...p,nombre:e.target.value}))} /></div>
            {[['unidad','Unidad',20],['stock_actual','Stock actual',null],['stock_minimo','Stock mínimo',null],['proveedor','Proveedor',null],['precio_unitario','Precio unitario',null],['ubicacion','Ubicación',80]].map(([k,l,ml]) => (
              <div key={k}><label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label><Input type={['stock_actual','stock_minimo','precio_unitario'].includes(k)?'number':'text'} value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))} {...(ml ? { maxLength: ml } : {})} /></div>
            ))}
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Descripción</label><Textarea value={form.descripcion||''} onChange={e => setForm(p=>({...p,descripcion:e.target.value}))} /></div>
          </div>
        </Modal>
      )}

      {/* Modal registrar movimiento */}
      {movItem && (
        <Modal open={!!movItem} onClose={() => setMovItem(null)}
          title={`Movimiento — ${movItem.nombre}`} maxWidth="max-w-sm"
          footer={<><Button variant="secondary" onClick={() => setMovItem(null)}>Cancelar</Button><Button onClick={registrarMovimiento} disabled={movSaving}>{movSaving ? 'Guardando...' : 'Registrar'}</Button></>}>
          <div className="space-y-3">
            <div className="flex gap-2 bg-surface2 rounded-xl p-1">
              {['ENTRADA','SALIDA'].map(t => (
                <button key={t}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-all ${movForm.tipo === t ? (t === 'ENTRADA' ? 'bg-[#1D8A55] text-white' : 'bg-danger text-white') : 'text-ink2 hover:bg-surface3'}`}
                  onClick={() => setMovForm(p => ({ ...p, tipo: t }))}>
                  {t === 'ENTRADA' ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                  {t}
                </button>
              ))}
            </div>
            <div className="text-center text-[12px] text-ink3">
              Stock actual: <strong className="text-ink">{movItem.stock_actual}</strong> {movItem.unidad}
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Cantidad</label>
              <Input type="number" min="1" value={movForm.cantidad} onChange={e => setMovForm(p => ({ ...p, cantidad: e.target.value }))} placeholder="0" />
              {movForm.cantidad && (
                <div className={`text-[11px] font-semibold mt-1 ${movForm.tipo === 'ENTRADA' ? 'text-[#1D8A55]' : 'text-danger'}`}>
                  Stock resultante: {(movItem.stock_actual || 0) + (movForm.tipo === 'ENTRADA' ? 1 : -1) * parseFloat(movForm.cantidad||0)} {movItem.unidad}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Motivo (opcional)</label>
              <Input value={movForm.motivo} onChange={e => setMovForm(p => ({ ...p, motivo: e.target.value }))} placeholder="Ej: Compra proveedor, Uso producción..." />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal historial */}
      {histItem && (
        <Modal open={!!histItem} onClose={() => setHistItem(null)}
          title={`Historial — ${histItem.nombre}`} maxWidth="max-w-lg"
          footer={<Button variant="secondary" onClick={() => setHistItem(null)}>Cerrar</Button>}>
          {histData.length === 0 ? (
            <div className="text-center py-8 text-ink3 text-sm">Sin movimientos registrados</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {histData.map(m => (
                <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  {m.tipo === 'ENTRADA'
                    ? <ArrowUpCircle size={16} className="text-[#1D8A55] flex-shrink-0" />
                    : <ArrowDownCircle size={16} className="text-danger flex-shrink-0" />
                  }
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[12px] font-bold ${m.tipo === 'ENTRADA' ? 'text-[#1D8A55]' : 'text-danger'}`}>
                        {m.tipo === 'ENTRADA' ? '+' : '-'}{m.cantidad}
                      </span>
                      {m.motivo && <span className="text-[11px] text-ink2">{m.motivo}</span>}
                    </div>
                    <div className="text-[10px] text-ink3">
                      {m.personal ? `${m.personal.nombre} ${m.personal.apellido || ''}` : 'Sin registrar'} · {new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

// --- SERVICIOS (PLANES) TAB ---
function TabServicios({ canEdit }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [formErr, setFormErr] = useState('')
  const { q, setQ, filtered } = useSearch(data, ['nombre', 'codigo', 'tipo_proceso'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('planes').select('*').order('nombre')
    setData(d || []); setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true }); setFormErr('')
    setForm(item ? {
      codigo: item.codigo || '', nombre: item.nombre || '',
      categoria: item.categoria || '', tipo_proceso: item.tipo_proceso || '',
      requiere_imagenes: item.requiere_imagenes !== false,
      dias_entrega_prometidos: item.dias_entrega_prometidos ?? 8,
      precio_base: item.precio_base ?? 0,
      descripcion: item.descripcion || '', activo: item.activo !== false,
    } : {
      codigo: '', nombre: '', categoria: '', tipo_proceso: '',
      requiere_imagenes: true, dias_entrega_prometidos: 8,
      precio_base: 0, descripcion: '', activo: true,
    })
  }

  async function guardar() {
    if (!form.codigo?.trim()) return setFormErr('El código es requerido.')
    if (!form.nombre?.trim()) return setFormErr('El nombre es requerido.')
    setFormErr(''); setSaving(true)
    const body = nullify({
      ...form,
      codigo: form.codigo.trim().toUpperCase(),
      dias_entrega_prometidos: parseInt(form.dias_entrega_prometidos) || null,
      precio_base: parseFloat(form.precio_base) || 0,
    }, ['tipo_proceso', 'categoria'])
    const { error } = selected?.id
      ? await db.from('planes').update(body).eq('id', selected.id)
      : await db.from('planes').insert(body)
    setSaving(false)
    if (error) { setFormErr(parsearErrorDB(error)); return }
    await cargar(); setSelected(null)
  }

  async function eliminar(p) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar "${p.nombre}"?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('planes').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        if (await confirm('Este plan tiene servicios vinculados y no se puede eliminar.\n¿Marcarlo como INACTIVO?', { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' }))
          await db.from('planes').update({ activo: false }).eq('id', p.id)
      } else await showAlert(parsearErrorDB(error), { title: 'Error' })
    }
    await cargar()
  }

  const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v || 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar por nombre o código..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {canEdit && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo plan</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Tipo proceso</Th><Th>Días</Th><Th>Precio base</Th><Th>Estado</Th>{canEdit && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(p => (
              <Tr key={p.id}>
                <Td><span className="font-mono text-[11px] bg-[#F3F4F6] px-2 py-0.5 rounded">{p.codigo}</span></Td>
                <Td className="font-semibold text-ink">{p.nombre}</Td>
                <Td className="text-ink3 text-[12px]">{p.tipo_proceso?.replace(/_/g, ' ') || '—'}</Td>
                <Td className="text-ink3 text-[12px]">{p.dias_entrega_prometidos ?? '—'}</Td>
                <Td className="text-ink3 text-[12px]">{COP(p.precio_base)}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo !== false ? 'bg-green-50 text-green-700' : 'bg-[#F0F0F0] text-[#555]'}`}>{p.activo !== false ? 'Activo' : 'Inactivo'}</span></Td>
                {canEdit && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button>
                      <button onClick={() => eliminar(p)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-ink3 text-sm">Sin planes registrados</td></tr>}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? `Editar — ${selected.nombre}` : 'Nuevo plan de servicio'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          {formErr && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formErr}</div>}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Código *</label>
                <Input value={form.codigo || ''} onChange={e => setForm(p => ({ ...p, codigo: e.target.value.toUpperCase() }))} placeholder="BASICO" maxLength={60} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Nombre *</label>
                <Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Tipo de proceso</label>
                <Select value={form.tipo_proceso || ''} onChange={e => setForm(p => ({ ...p, tipo_proceso: e.target.value }))}>
                  <option value="">Sin definir</option>
                  <option value="CREMACION_GRUPAL">Cremación grupal</option>
                  <option value="CREMACION_INDIVIDUAL">Cremación individual</option>
                  <option value="COMPOSTAJE_GRUPAL">Compostaje grupal</option>
                  <option value="COMPOSTAJE_INDIVIDUAL">Compostaje individual</option>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Categoría</label>
                <Select value={form.categoria || ''} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))}>
                  <option value="">— Sin categoría —</option>
                  <option value="individual">Individual</option>
                  <option value="grupal">Grupal</option>
                  <option value="especial">Especial</option>
                  <option value="presequial">Presequial</option>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Días de entrega</label>
                <Input type="number" min="1" value={form.dias_entrega_prometidos || ''} onChange={e => setForm(p => ({ ...p, dias_entrega_prometidos: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Precio base ($)</label>
                <Input type="number" min="0" value={form.precio_base || ''} onChange={e => setForm(p => ({ ...p, precio_base: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Descripción</label>
              <Textarea value={form.descripcion || ''} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} />
            </div>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.requiere_imagenes} onChange={e => setForm(p => ({ ...p, requiere_imagenes: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" />
                <span className="text-[12px] font-semibold text-ink2">Requiere imágenes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.activo !== false} onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" />
                <span className="text-[12px] font-semibold text-ink2">Activo</span>
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- HISTORIAL DE SERVICIOS TAB ---
const PAGO_COLOR = {
  PENDIENTE: { bg: '#FEE8E8', text: '#C03030' },
  PARCIAL:   { bg: '#FFF3DC', text: '#9A5500' },
  COMPLETO:  { bg: '#E8F3EB', text: '#1D8A55' },
}

const SELECT_HISTORIAL = `
  id, estado, fecha_ingreso, valor_total, valor_pagado, estado_pago,
  canal_entrada, ciudad_recogida,
  mascotas:mascota_id(
    nombre, peso_kg, raza,
    especies(nombre),
    clientes:cliente_id(nombre, apellido, whatsapp, telefono, telefono2, email)
  ),
  planes:plan_id(nombre, codigo),
  aliados:aliado_origen_id(nombre),
  tecnico:tecnico_id(nombre, apellido)
`

function TabHistorialServicios() {
  const [data, setData]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [total, setTotal]             = useState(0)
  const [exporting, setExporting]     = useState(false)
  // catálogos para dropdowns
  const [catPlanes,   setCatPlanes]   = useState([])
  const [catAliados,  setCatAliados]  = useState([])
  const [catPersonal, setCatPersonal] = useState([])
  // filtros
  const [busqueda,      setBusqueda]      = useState('')
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroPago,    setFiltroPago]    = useState('')
  const [filtroPlan,    setFiltroPlan]    = useState('')
  const [filtroAliado,  setFiltroAliado]  = useState('')
  const [filtroTecnico, setFiltroTecnico] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const PAGE_SIZE = 100

  useEffect(() => {
    Promise.all([
      db.from('planes').select('id,nombre').order('nombre'),
      db.from('aliados').select('id_aliado,nombre').eq('activo', true).order('nombre'),
      db.from('personal').select('id,nombre,apellido').eq('activo', true).order('nombre'),
    ]).then(([{ data: pl }, { data: al }, { data: pe }]) => {
      setCatPlanes(pl || [])
      setCatAliados(al || [])
      setCatPersonal(pe || [])
    })
  }, [])

  function buildQuery(base) {
    if (filtroEstado)  base = base.eq('estado', filtroEstado)
    if (filtroPago)    base = base.eq('estado_pago', filtroPago)
    if (filtroPlan)    base = base.eq('plan_id', filtroPlan)
    if (filtroAliado)  base = base.eq('aliado_origen_id', filtroAliado)
    if (filtroTecnico) base = base.eq('tecnico_id', filtroTecnico)
    if (desde)         base = base.gte('fecha_ingreso', desde)
    if (hasta)         base = base.lte('fecha_ingreso', hasta)
    return base
  }

  async function cargar(offsetInicial = 0) {
    setLoading(true)
    const q = buildQuery(
      db.from('servicios')
        .select(SELECT_HISTORIAL, { count: 'exact' })
        .order('fecha_ingreso', { ascending: false })
        .range(offsetInicial, offsetInicial + PAGE_SIZE - 1)
    )
    const { data: d, count } = await q
    setData(prev => offsetInicial === 0 ? (d || []) : [...prev, ...(d || [])])
    setTotal(count || 0)
    setLoading(false)
  }

  useEffect(() => { cargar(0) }, [filtroEstado, filtroPago, filtroPlan, filtroAliado, filtroTecnico, desde, hasta])

  async function exportarCSV() {
    setExporting(true)
    const q = buildQuery(
      db.from('servicios').select(SELECT_HISTORIAL).order('fecha_ingreso', { ascending: false }).limit(5000)
    )
    const { data: d } = await q
    const filas = d || []
    const headers = ['Fecha','Cliente','WhatsApp','Tel 2','Tel 3','Email','Mascota','Especie','Raza','Peso kg','Plan','Aliado','Ciudad','Técnico','Estado','Estado pago','Valor total','Valor pagado']
    const rows = filas.map(s => {
      const cli = s.mascotas?.clientes || {}
      const tec = s.tecnico
      return [
        s.fecha_ingreso || '',
        `${cli.nombre || ''} ${cli.apellido || ''}`.trim(),
        cli.whatsapp || '', cli.telefono || '', cli.telefono2 || '', cli.email || '',
        s.mascotas?.nombre || '',
        s.mascotas?.especies?.nombre || '',
        s.mascotas?.raza || '',
        s.mascotas?.peso_kg ?? '',
        s.planes?.nombre || '',
        s.aliados?.nombre || '',
        s.ciudad_recogida || '',
        tec ? `${tec.nombre} ${tec.apellido || ''}`.trim() : '',
        ESTADO_LABEL[s.estado] || s.estado || '',
        s.estado_pago || '',
        s.valor_total ?? 0,
        s.valor_pagado ?? 0,
      ]
    })
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `servicios_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
    setExporting(false)
  }

  const filtrados = busqueda.trim()
    ? data.filter(s => {
        const txt = busqueda.toLowerCase()
        const cli = s.mascotas?.clientes || {}
        return (
          `${cli.nombre || ''} ${cli.apellido || ''}`.toLowerCase().includes(txt) ||
          (cli.whatsapp || '').includes(txt) ||
          (cli.email || '').toLowerCase().includes(txt) ||
          (s.mascotas?.nombre || '').toLowerCase().includes(txt) ||
          (s.aliados?.nombre || '').toLowerCase().includes(txt) ||
          (s.planes?.nombre || '').toLowerCase().includes(txt)
        )
      })
    : data

  const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v || 0)
  const fmtFecha = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

  const hayFiltros = filtroEstado || filtroPago || filtroPlan || filtroAliado || filtroTecnico || desde || hasta || busqueda
  function limpiarFiltros() {
    setBusqueda(''); setFiltroEstado(''); setFiltroPago('')
    setFiltroPlan(''); setFiltroAliado(''); setFiltroTecnico('')
    setDesde(''); setHasta('')
  }

  return (
    <div>
      {/* Filtros — fila 1 */}
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8 w-52" placeholder="Cliente, mascota..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <Select value={filtroPlan} onChange={e => setFiltroPlan(e.target.value)} className="w-44">
          <option value="">Todos los planes</option>
          {catPlanes.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <Select value={filtroAliado} onChange={e => setFiltroAliado(e.target.value)} className="w-44">
          <option value="">Todos los aliados</option>
          {catAliados.map(a => <option key={a.id_aliado} value={a.id_aliado}>{a.nombre}</option>)}
        </Select>
        <Select value={filtroTecnico} onChange={e => setFiltroTecnico(e.target.value)} className="w-40">
          <option value="">Todos los técnicos</option>
          {catPersonal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido || ''}</option>)}
        </Select>
      </div>
      {/* Filtros — fila 2 */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className="w-40">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={filtroPago} onChange={e => setFiltroPago(e.target.value)} className="w-36">
          <option value="">Todo pago</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="PARCIAL">Parcial</option>
          <option value="COMPLETO">Completo</option>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-ink3 whitespace-nowrap">Desde</span>
          <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="w-36" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-ink3 whitespace-nowrap">Hasta</span>
          <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="w-36" />
        </div>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="text-[11px] font-semibold text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors">
            × Limpiar filtros
          </button>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={exportarCSV} disabled={exporting}>
            <FileDown size={14} /> {exporting ? 'Exportando...' : 'Exportar CSV'}
          </Button>
        </div>
      </div>

      {/* Conteo */}
      {!loading && total > 0 && (
        <p className="text-[12px] text-ink3 mb-3">
          {data.length < total ? `${data.length} de ${total}` : total} servicios
          {busqueda && filtrados.length !== data.length && ` · ${filtrados.length} coinciden`}
        </p>
      )}

      {loading && data.length === 0 ? (
        <div className="text-center py-12 text-ink3">Cargando historial...</div>
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Cliente</Th>
                  <Th>Contacto</Th>
                  <Th>Mascota</Th>
                  <Th>Plan</Th>
                  <Th>Aliado</Th>
                  <Th>Ciudad</Th>
                  <Th>Técnico</Th>
                  <Th>Estado</Th>
                  <Th>Pago</Th>
                  <Th>Valor</Th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(s => {
                  const cli = s.mascotas?.clientes || {}
                  const ec  = ESTADO_COLOR[s.estado] || {}
                  const pc  = PAGO_COLOR[s.estado_pago] || {}
                  const tec = s.tecnico
                  return (
                    <Tr key={s.id}>
                      <Td className="text-[11px] text-ink3 whitespace-nowrap">{fmtFecha(s.fecha_ingreso)}</Td>
                      <Td>
                        <div className="font-semibold text-ink text-[12px] whitespace-nowrap">{cli.nombre} {cli.apellido}</div>
                        {cli.email && <div className="text-[10px] text-ink3 max-w-[140px] truncate">{cli.email}</div>}
                      </Td>
                      <Td className="text-[11px] text-ink3 space-y-0.5">
                        {cli.whatsapp  && <div>{cli.whatsapp}</div>}
                        {cli.telefono  && <div>{cli.telefono}</div>}
                        {cli.telefono2 && <div>{cli.telefono2}</div>}
                      </Td>
                      <Td>
                        <div className="font-medium text-ink text-[12px]">{s.mascotas?.nombre}</div>
                        <div className="text-[10px] text-ink3">
                          {s.mascotas?.especies?.nombre}
                          {s.mascotas?.peso_kg ? ` · ${s.mascotas.peso_kg} kg` : ''}
                        </div>
                        {s.mascotas?.raza && <div className="text-[10px] text-ink3">{s.mascotas.raza}</div>}
                      </Td>
                      <Td className="text-[12px] text-ink2 whitespace-nowrap">{s.planes?.nombre || '—'}</Td>
                      <Td className="text-[11px] text-ink3">{s.aliados?.nombre || '—'}</Td>
                      <Td className="text-[11px] text-ink3 whitespace-nowrap">{s.ciudad_recogida || '—'}</Td>
                      <Td className="text-[11px] text-ink3 whitespace-nowrap">{tec ? `${tec.nombre} ${tec.apellido || ''}`.trim() : '—'}</Td>
                      <Td>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: ec.bg, color: ec.text, border: `1px solid ${ec.border || ec.bg}` }}>
                          {ESTADO_LABEL[s.estado] || s.estado}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: pc.bg, color: pc.text }}>
                          {s.estado_pago || '—'}
                        </span>
                      </Td>
                      <Td className="text-[12px] font-semibold text-ink whitespace-nowrap">{COP(s.valor_total)}</Td>
                    </Tr>
                  )
                })}
                {filtrados.length === 0 && !loading && (
                  <tr><td colSpan={11} className="text-center py-10 text-ink3 text-sm">Sin servicios para los filtros aplicados</td></tr>
                )}
              </tbody>
            </Table>
          </TableWrap>

          {data.length < total && (
            <div className="flex justify-center mt-5">
              <Button variant="secondary" onClick={() => cargar(data.length)} disabled={loading}>
                {loading ? 'Cargando...' : `Cargar más — ${total - data.length} restantes`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Gestion() {
  const { personalData } = useAuth()
  const isAdmin = personalData?.rol === 'ADMIN'
  const isCoord = personalData?.rol === 'COORDINADOR'
  const canEdit = isAdmin || isCoord

  return (
    <div>
      <Topbar />
      <div className="p-7">
        <Tabs defaultValue="historial">
          <TabsList className="mb-6">
            <TabsTrigger value="historial">Historial</TabsTrigger>
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
            <TabsTrigger value="mascotas">Mascotas</TabsTrigger>
            <TabsTrigger value="aliados">Aliados</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="inventario">Inventario</TabsTrigger>
            <TabsTrigger value="planes">Planes</TabsTrigger>
          </TabsList>
          <TabsContent value="historial"><TabHistorialServicios /></TabsContent>
          <TabsContent value="clientes"><TabClientes isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="mascotas"><TabMascotas isAdmin={isAdmin} canEdit={canEdit} /></TabsContent>
          <TabsContent value="aliados"><TabAliados isAdmin={isAdmin} canEdit={canEdit} /></TabsContent>
          <TabsContent value="personal"><TabPersonal isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="inventario"><TabInventario isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="planes"><TabServicios canEdit={canEdit} /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
