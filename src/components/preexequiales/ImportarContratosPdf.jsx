import { useState, useRef, useEffect } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { fmt, today, parseDate, hoyLocalISO } from '@/lib/utils'
import {
  NIVELES, generarNumeroContrato, validarNumeroContrato, sumarUnAnio, subirComprobanteAfiliacion,
} from '@/lib/afiliaciones'
import { FileUp, FileText, Loader2, AlertTriangle, CheckCircle2, X, Plus, Trash2, RotateCw, Eye } from 'lucide-react'

// Contratos de la base antigua en PDF → la IA los lee (backend
// /afiliaciones/ia/leer-contrato, solo lee) → el coordinador REVISA cada uno →
// se crea cliente + mascotas + contrato, igual que el importador CSV.
//
// Antigüedad (decisión de David 2026-11-03): se guarda la fecha de afiliación
// del PDF y el coordinador elige hasta cuándo está vigente HOY. Si eso va más
// allá del primer año, se crean DOS contratos:
//   · nº 0 — el del papel: fecha original, vence al año, con el PDF adjunto.
//   · nº k — el periodo actual (vigente_hasta − 1 año → vigente_hasta), k = años
//     desde la afiliación. Con numero ≥ 1 la cláusula 5×/3× no aplica, que es
//     lo correcto para alguien que lleva años renovando.
// Sin esto, un ANUAL de 2023 entraba con vencimiento 2024 y el job nocturno lo
// cancelaba esa misma noche.

const LABEL = 'text-[10px] font-bold text-ink3 block mb-0.5'
const TIPOS = ['ANUAL', 'VITALICIO']
const METODOS = [['EFECTIVO', 'Efectivo'], ['TRANSFERENCIA', 'Transferencia'], ['TARJETA', 'Tarjeta'], ['OTRO', 'Otro']]
const SEXOS = ['Macho', 'Hembra']
const TAMANOS = ['Mini', 'Pequeño', 'Mediano', 'Grande', 'Gigante']
// El PDF queda adjunto al contrato y el adjunto tiene tope de 8 MB (subirComprobanteAfiliacion).
const MAX_MB = 8

const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const esFecha = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(parseDate(v))
const digitos = v => String(v ?? '').replace(/\D/g, '')
const enum_ = (v, lista, def) => lista.find(x => norm(x) === norm(v)) || def

function sumarAnios(fechaISO, n) {
  let f = fechaISO
  for (let i = 0; i < n; i++) f = sumarUnAnio(f)
  return f
}

function restarUnAnio(fechaISO) {
  const d = parseDate(fechaISO)
  d.setFullYear(d.getFullYear() - 1)
  return hoyLocalISO(d)
}

// Primer aniversario de la afiliación que todavía no ha pasado (o el del primer
// año si sigue en él). Es la sugerencia; el coordinador la confirma o la cambia.
function proximoAniversario(fechaISO) {
  const hoy = today()
  let f = sumarUnAnio(fechaISO)
  for (let i = 0; i < 60 && f < hoy; i++) f = sumarUnAnio(f)
  return f
}

// Años completos entre dos fechas ISO.
function aniosEntre(desde, hasta) {
  let n = 0
  while (n < 100 && sumarAnios(desde, n + 1) <= hasta) n++
  return n
}

// Número del contrato del periodo actual: el del papel con el sufijo de
// renovación (…-BR0 → …-BR3). Si el papel usa otro formato, se le agrega -R3.
function numeroRenovacion(numeroPapel, k) {
  const m = String(numeroPapel).match(/^(.*-[A-Z]{2})\d+$/)
  return m ? `${m[1]}${k}` : `${numeroPapel}-R${k}`
}

const MASCOTA_VACIA = () => ({ nombre: '', especie: 'Perro', raza: '', sexo: 'Macho', tamano: 'Pequeño', peso_kg: '', edad_anios: '' })

// Respuesta de la IA → formulario editable, con los valores ya en el dominio de Orbit.
function aFormulario(d, config) {
  const tipo = enum_(d.tipo, TIPOS, 'ANUAL')
  const nivel = enum_(d.nivel, NIVELES, 'BRONCE')
  const fecha = esFecha(d.fecha_afiliacion) ? d.fecha_afiliacion : ''
  const mascotas = (d.mascotas || []).map(m => ({
    nombre: String(m.nombre || '').trim(),
    especie: m.especie || 'Perro',
    raza: m.raza || '',
    sexo: enum_(m.sexo, SEXOS, 'Macho'),
    tamano: enum_(m.tamano, TAMANOS, 'Pequeño'),
    peso_kg: m.peso_kg ?? '',
    edad_anios: m.edad_anios ?? '',
  }))
  let valor = parseFloat(d.valor_por_mascota) || 0
  if (!valor && parseFloat(d.valor_total) > 0 && mascotas.length) valor = Math.round(parseFloat(d.valor_total) / mascotas.length)
  if (!valor) valor = parseFloat(config?.precios?.[tipo]?.[nivel]) || 0
  const c = d.cliente || {}
  return {
    cliente: {
      nombre: c.nombre || '', apellido: c.apellido || '', cedula_nit: digitos(c.cedula_nit),
      whatsapp: digitos(c.whatsapp || c.telefono), telefono: digitos(c.telefono), email: c.email || '',
      direccion: c.direccion || '', ciudad: c.ciudad || 'Bogotá',
    },
    mascotas: mascotas.length ? mascotas : [MASCOTA_VACIA()],
    tipo, nivel, fecha,
    numero: String(d.numero_contrato || '').trim().toUpperCase(),
    valor: valor ? String(valor) : '',
    metodo: enum_(d.metodo_pago, METODOS.map(m => m[0]), 'EFECTIVO'),
    vigenteHasta: tipo === 'ANUAL' && fecha
      ? (esFecha(d.vigente_hasta) && d.vigente_hasta > fecha ? d.vigente_hasta : proximoAniversario(fecha))
      : '',
    observaciones: d.observaciones || '',
  }
}

function erroresDe(f) {
  const e = []
  const c = f.cliente
  if (!c.nombre.trim()) e.push('Falta el nombre del titular')
  if (!c.apellido.trim()) e.push('Falta el apellido (forma parte del nº de contrato)')
  if (!digitos(c.cedula_nit)) e.push('Falta la cédula')
  if (!digitos(c.whatsapp)) e.push('Falta el WhatsApp')
  if (!f.mascotas.some(m => m.nombre.trim())) e.push('Falta al menos una mascota')
  if (!esFecha(f.fecha)) e.push('Fecha de afiliación inválida')
  else if (f.fecha > today()) e.push('La fecha de afiliación está en el futuro')
  if (!(parseFloat(f.valor) > 0)) e.push('Falta el valor por mascota')
  if (f.tipo === 'ANUAL') {
    if (!esFecha(f.vigenteHasta)) e.push('Falta "vigente hasta"')
    else if (esFecha(f.fecha) && f.vigenteHasta <= f.fecha) e.push('"Vigente hasta" debe ser posterior a la afiliación')
  }
  return e
}

// Cómo quedará el contrato, para mostrarlo antes de crearlo.
function planContratos(f) {
  const cliente = f.cliente
  const numero0 = f.numero.trim() || (esFecha(f.fecha) && cliente.apellido
    ? generarNumeroContrato({ fechaInicio: f.fecha, cliente, nivel: f.nivel, tipo: f.tipo, numero: 0 }) : '')
  if (f.tipo === 'VITALICIO' || !esFecha(f.fecha) || !esFecha(f.vigenteHasta))
    return { numero0, actual: null, vence0: null }
  const vence0 = sumarUnAnio(f.fecha)
  if (f.vigenteHasta <= vence0) return { numero0, vence0: f.vigenteHasta, actual: null }
  const inicio = restarUnAnio(f.vigenteHasta)
  const k = Math.max(1, aniosEntre(f.fecha, inicio))
  return { numero0, vence0, actual: { numero: k, numeroContrato: numeroRenovacion(numero0, k), inicio, vence: f.vigenteHasta } }
}

function leerBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('No se pudo leer el archivo'))
    r.readAsDataURL(file)
  })
}

export default function ImportarContratosPdf({ config, especies, personalData, onClose, onImported }) {
  // items: { id, file, url, estado: LEYENDO|LISTO|ERROR_LECTURA|CREANDO|CREADO|ERROR, error, dudas, form, incluir, clienteExiste, numeroRepetido }
  const [items, setItems] = useState([])
  const [creando, setCreando] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => () => itemsRef.current.forEach(it => URL.revokeObjectURL(it.url)), [])

  const set = (id, patch) => setItems(xs => xs.map(x => x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x))
  const setForm = (id, fn) => set(id, x => ({ form: fn(x.form) }))

  async function revisarExistentes(id, form) {
    const [cl, num] = await Promise.all([
      digitos(form.cliente.cedula_nit)
        ? db.from('clientes').select('id_cliente,nombre,apellido').eq('cedula_nit', digitos(form.cliente.cedula_nit)).maybeSingle()
        : { data: null },
      form.numero ? validarNumeroContrato(form.numero).then(() => false, () => true) : false,
    ])
    set(id, { clienteExiste: cl.data || null, numeroRepetido: num })
  }

  async function leer(item) {
    set(item.id, { estado: 'LEYENDO', error: null })
    try {
      const pdf_base64 = await leerBase64(item.file)
      const d = await orbitApi('/afiliaciones/ia/leer-contrato', { method: 'POST', body: { pdf_base64 } })
      const form = aFormulario(d, config)
      set(item.id, { estado: 'LISTO', form, dudas: d.dudas || [], incluir: true })
      revisarExistentes(item.id, form).catch(() => {})
    } catch (e) {
      set(item.id, { estado: 'ERROR_LECTURA', error: e.message })
    }
  }

  async function agregarArchivos(fileList) {
    const nuevos = []
    for (const file of Array.from(fileList || [])) {
      const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const item = { id: crypto.randomUUID(), file, url: URL.createObjectURL(file), estado: 'LEYENDO', dudas: [], incluir: false }
      if (!esPdf) Object.assign(item, { estado: 'ERROR_LECTURA', error: 'No es un PDF' })
      else if (file.size > MAX_MB * 1024 * 1024) Object.assign(item, { estado: 'ERROR_LECTURA', error: `Supera ${MAX_MB} MB` })
      nuevos.push(item)
    }
    setItems(xs => [...xs, ...nuevos])
    // De a dos a la vez: rápido sin disparar 40 lecturas simultáneas.
    const cola = nuevos.filter(i => i.estado === 'LEYENDO')
    const trabajador = async () => { while (cola.length) await leer(cola.shift()) }
    await Promise.all([trabajador(), trabajador()])
  }

  function quitar(id) {
    setItems(xs => {
      const it = xs.find(x => x.id === id)
      if (it) URL.revokeObjectURL(it.url)
      return xs.filter(x => x.id !== id)
    })
  }

  async function crearUno(it) {
    const f = it.form
    const c = f.cliente
    const cedula = digitos(c.cedula_nit)
    const plan = planContratos(f)
    const numero0 = await validarNumeroContrato(plan.numero0)
    if (plan.actual) await validarNumeroContrato(plan.actual.numeroContrato)

    // Cliente: si ya existe por cédula se usa tal cual (no se pisan sus datos).
    let { data: cliente, error: eCli } = await db.from('clientes')
      .select('id_cliente,nombre,apellido,cedula_nit').eq('cedula_nit', cedula).maybeSingle()
    if (eCli) throw eCli
    if (!cliente) {
      const r = await db.from('clientes').insert({
        nombre: c.nombre.trim(), apellido: c.apellido.trim(), cedula_nit: cedula,
        whatsapp: digitos(c.whatsapp), telefono: digitos(c.telefono) || null,
        email: c.email.trim() || null, direccion: c.direccion.trim() || null,
        ciudad: c.ciudad.trim() || 'Bogotá', tipo_cliente: 'NORMAL',
      }).select('id_cliente,nombre,apellido,cedula_nit').single()
      if (r.error) throw r.error
      cliente = r.data
    }

    const especiesMap = new Map(especies.map(e => [norm(e.nombre), e.id]))
    const mascotaIds = []
    for (const m of f.mascotas.filter(m => m.nombre.trim())) {
      const { data: ya, error } = await db.from('mascotas').select('id_mascota')
        .eq('cliente_id', cliente.id_cliente).ilike('nombre', m.nombre.trim()).limit(1)
      if (error) throw error
      if (ya?.[0]) { mascotaIds.push(ya[0].id_mascota); continue }
      const edad = parseInt(m.edad_anios)
      const edadOk = Number.isFinite(edad) && edad >= 0 && edad <= 40
      const r = await db.from('mascotas').insert({
        nombre: m.nombre.trim(), especie_id: especiesMap.get(norm(m.especie)) || null,
        raza: String(m.raza || '').trim() || null, sexo: m.sexo, tamano: m.tamano,
        peso_kg: parseFloat(String(m.peso_kg).replace(',', '.')) || 0,
        cliente_id: cliente.id_cliente, fallecida: false,
        // La edad del papel es a la fecha del contrato: desde ahí envejece sola (migr. 056).
        edad_anios: edadOk ? edad : null, edad_declarada_en: edadOk ? f.fecha : null,
      }).select('id_mascota').single()
      if (r.error) throw r.error
      mascotaIds.push(r.data.id_mascota)
    }

    const { data: cubiertas, error: eCub } = await db.from('afiliacion_mascotas')
      .select('mascota_id, mascotas(nombre), afiliaciones!inner(estado)')
      .in('mascota_id', mascotaIds).eq('estado', 'VIGENTE')
      .in('afiliaciones.estado', ['VIGENTE', 'VENCIDA'])
    if (eCub) throw eCub
    if (cubiertas?.length) throw new Error('Ya tienen afiliación viva: ' + cubiertas.map(x => x.mascotas?.nombre).join(', '))

    const notas = [`Contrato de la base antigua cargado desde PDF (${it.file.name}).`, f.observaciones.trim()].filter(Boolean).join(' ')
    const { data: afil, error: eAf } = await db.from('afiliaciones').insert({
      tipo: f.tipo, nivel: f.nivel, cliente_id: cliente.id_cliente, estado: 'VIGENTE',
      notas, creado_por: personalData?.id || null,
    }).select('id').single()
    if (eAf) throw eAf

    try {
      const r1 = await db.from('afiliacion_mascotas').insert(
        mascotaIds.map(id => ({ afiliacion_id: afil.id, mascota_id: id, estado: 'VIGENTE' })))
      if (r1.error) throw r1.error

      const original = await subirComprobanteAfiliacion(afil.id, it.file)
      const valor = parseFloat(f.valor)
      const base = {
        afiliacion_id: afil.id, valor, valor_lista: valor, metodo_pago: f.metodo,
        creado_por: personalData?.id || null,
      }
      const r2 = await db.from('afiliacion_contratos').insert({
        ...base, numero: 0, numero_contrato: numero0,
        fecha_inicio: f.fecha, fecha_vencimiento: f.tipo === 'ANUAL' ? plan.vence0 : null,
        fecha_pago: f.fecha,
        comprobantes: [{ ...original, tipo: 'CONTRATO_ORIGINAL', nombre: it.file.name }],
      })
      if (r2.error) throw r2.error
      if (plan.actual) {
        const r3 = await db.from('afiliacion_contratos').insert({
          ...base, numero: plan.actual.numero, numero_contrato: plan.actual.numeroContrato,
          fecha_inicio: plan.actual.inicio, fecha_vencimiento: plan.actual.vence,
          fecha_pago: null, comprobantes: [],
        })
        if (r3.error) throw r3.error
      }
    } catch (e) {
      await db.from('afiliaciones').delete().eq('id', afil.id)   // sin contrato no sirve: no dejar huérfanas
      throw e
    }
  }

  const listos = items.filter(it => it.estado === 'LISTO' || it.estado === 'ERROR')
  const aCrear = listos.filter(it => it.incluir && !erroresDe(it.form).length)
  const leyendo = items.some(it => it.estado === 'LEYENDO')

  async function crearTodos() {
    setCreando(true)
    let ok = 0
    try {
      for (const it of aCrear) {
        set(it.id, { estado: 'CREANDO', error: null })
        try {
          await crearUno(it)
          set(it.id, { estado: 'CREADO' })
          ok++
        } catch (e) {
          set(it.id, { estado: 'ERROR', error: e.message || 'Error desconocido' })
        }
      }
    } finally {
      setCreando(false)
    }
    if (ok > 0) onImported().catch(() => {})
  }

  const creados = items.filter(it => it.estado === 'CREADO').length

  return (
    <Modal open onClose={creando ? () => {} : onClose} title="Subir contratos antiguos (PDF)" maxWidth="max-w-5xl"
      footer={<>
        {creados > 0 && <span className="mr-auto text-[12px] font-semibold text-green-700">{creados} creado{creados === 1 ? '' : 's'}</span>}
        <Button variant="secondary" onClick={onClose} disabled={creando}>Cerrar</Button>
        <Button onClick={crearTodos} disabled={creando || leyendo || !aCrear.length}>
          {creando ? <><Loader2 size={13} className="animate-spin" /> Creando…</>
            : <>Crear {aCrear.length} contrato{aCrear.length === 1 ? '' : 's'}</>}
        </Button>
      </>}>
      <div className="space-y-4">
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center transition-colors hover:border-[#1A5CD8]/40 hover:bg-blue-50/40"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); agregarArchivos(e.dataTransfer.files) }}>
          <FileUp size={22} className="mx-auto mb-2 text-[#1A5CD8]" />
          <span className="block text-[13px] font-bold text-gray-800">Seleccionar o arrastrar contratos en PDF</span>
          <span className="block text-[11px] text-gray-500 mt-1">Uno o varios a la vez · un contrato por archivo · hasta {MAX_MB} MB c/u</span>
          <input type="file" multiple accept="application/pdf,.pdf" className="sr-only"
            onChange={e => { agregarArchivos(e.target.files); e.target.value = '' }} />
        </label>

        <div className="rounded-xl bg-blue-50 px-4 py-3 text-[11px] text-blue-900">
          La IA lee cada contrato y llena los datos; <strong>revísalos contra el PDF antes de crear</strong>.
          Se conserva la <strong>fecha de afiliación</strong> del papel (antigüedad) y tú confirmas <strong>hasta cuándo está vigente hoy</strong>:
          si ya pasó el primer año, entra como renovado y sin cláusula 5×/3×. El PDF queda adjunto al contrato.
        </div>

        {items.map(it => (
          <TarjetaContrato key={it.id} it={it} especies={especies}
            onForm={fn => setForm(it.id, fn)} onIncluir={v => set(it.id, { incluir: v })}
            onReintentar={() => leer(it)} onQuitar={() => quitar(it.id)}
            onRevisar={() => revisarExistentes(it.id, it.form).catch(() => {})} bloqueado={creando} />
        ))}
      </div>
    </Modal>
  )
}

function TarjetaContrato({ it, onForm, onIncluir, onReintentar, onQuitar, onRevisar, bloqueado }) {
  const cab = (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
      <FileText size={15} className="text-ink3 shrink-0" />
      <span className="text-[12px] font-bold text-ink truncate">{it.file.name}</span>
      <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1A5CD8] hover:underline">
        <Eye size={12} /> Ver PDF
      </a>
      <span className="ml-auto" />
      {it.estado === 'LEYENDO' && <span className="inline-flex items-center gap-1 text-[11px] text-ink3"><Loader2 size={12} className="animate-spin" /> Leyendo con IA…</span>}
      {it.estado === 'CREANDO' && <span className="inline-flex items-center gap-1 text-[11px] text-ink3"><Loader2 size={12} className="animate-spin" /> Creando…</span>}
      {it.estado === 'CREADO' && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700"><CheckCircle2 size={12} /> Creado</span>}
      {(it.estado === 'LISTO' || it.estado === 'ERROR') && (
        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink2">
          <input type="checkbox" checked={it.incluir} disabled={bloqueado} onChange={e => onIncluir(e.target.checked)} /> Incluir
        </label>
      )}
      {it.estado !== 'CREANDO' && it.estado !== 'CREADO' && (
        <button type="button" onClick={onQuitar} disabled={bloqueado} className="p-1 text-ink3 hover:text-danger" aria-label="Quitar"><X size={14} /></button>
      )}
    </div>
  )

  if (it.estado === 'LEYENDO') return <div className="rounded-xl border border-gray-200">{cab}</div>
  if (it.estado === 'ERROR_LECTURA') return (
    <div className="rounded-xl border border-red-200">
      {cab}
      <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-red-700">
        <AlertTriangle size={14} /> No se pudo leer: {it.error}
        {it.error !== 'No es un PDF' && !/Supera/.test(it.error) && (
          <button type="button" onClick={onReintentar} className="ml-2 inline-flex items-center gap-1 font-semibold text-[#1A5CD8] hover:underline"><RotateCw size={12} /> Reintentar</button>
        )}
      </div>
    </div>
  )

  const f = it.form
  const errores = erroresDe(f)
  const plan = planContratos(f)
  const cerrado = it.estado === 'CREADO' || it.estado === 'CREANDO' || bloqueado
  const setC = (k, v) => onForm(x => ({ ...x, cliente: { ...x.cliente, [k]: v } }))
  const setF = (k, v) => onForm(x => {
    const n = { ...x, [k]: v }
    // Al cambiar la fecha o el tipo se vuelve a sugerir la vigencia
    if ((k === 'fecha' || k === 'tipo') && n.tipo === 'ANUAL' && esFecha(n.fecha)) n.vigenteHasta = proximoAniversario(n.fecha)
    return n
  })
  const setM = (i, k, v) => onForm(x => ({ ...x, mascotas: x.mascotas.map((m, j) => j === i ? { ...m, [k]: v } : m) }))
  const hoy = today()
  const anios = esFecha(f.fecha) ? aniosEntre(f.fecha, hoy) : null

  return (
    <div className={'rounded-xl border ' + (it.estado === 'CREADO' ? 'border-green-200 bg-green-50/30' : it.estado === 'ERROR' ? 'border-red-200' : 'border-gray-200')}>
      {cab}
      <fieldset disabled={cerrado} className="px-4 py-3 space-y-3">
        {it.dudas?.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-[#FFF3DC] px-3 py-2 text-[11px] text-[#9A5500]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span><b>La IA tuvo dudas:</b> {it.dudas.join(' · ')}</span>
          </div>
        )}

        <div>
          <div className="text-[11px] font-bold text-ink2 mb-1">Titular
            {it.clienteExiste && <span className="ml-2 font-semibold text-primary-dark">· ya existe en Orbit ({it.clienteExiste.nombre} {it.clienteExiste.apellido}): se usa ese cliente</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div><label className={LABEL}>Nombres</label><Input value={f.cliente.nombre} onChange={e => setC('nombre', e.target.value)} /></div>
            <div><label className={LABEL}>Apellidos</label><Input value={f.cliente.apellido} onChange={e => setC('apellido', e.target.value)} /></div>
            <div><label className={LABEL}>Cédula</label><Input value={f.cliente.cedula_nit} onChange={e => setC('cedula_nit', e.target.value)} onBlur={onRevisar} /></div>
            <div><label className={LABEL}>WhatsApp</label><Input value={f.cliente.whatsapp} onChange={e => setC('whatsapp', e.target.value)} /></div>
            <div><label className={LABEL}>Teléfono</label><Input value={f.cliente.telefono} onChange={e => setC('telefono', e.target.value)} /></div>
            <div><label className={LABEL}>Email</label><Input value={f.cliente.email} onChange={e => setC('email', e.target.value)} /></div>
            <div><label className={LABEL}>Dirección</label><Input value={f.cliente.direccion} onChange={e => setC('direccion', e.target.value)} /></div>
            <div><label className={LABEL}>Ciudad</label><Input value={f.cliente.ciudad} onChange={e => setC('ciudad', e.target.value)} /></div>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-ink2 mb-1">Mascotas ({f.mascotas.length})</div>
          <div className="space-y-1.5">
            {f.mascotas.map((m, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_.9fr_1fr_.7fr_.7fr_auto] gap-2 items-end">
                <div><label className={LABEL}>Nombre</label><Input value={m.nombre} onChange={e => setM(i, 'nombre', e.target.value)} /></div>
                <div><label className={LABEL}>Especie</label><Input value={m.especie} onChange={e => setM(i, 'especie', e.target.value)} /></div>
                <div><label className={LABEL}>Raza</label><Input value={m.raza} onChange={e => setM(i, 'raza', e.target.value)} /></div>
                <div><label className={LABEL}>Sexo</label>
                  <Select value={m.sexo} onChange={e => setM(i, 'sexo', e.target.value)}>{SEXOS.map(s => <option key={s}>{s}</option>)}</Select></div>
                <div><label className={LABEL}>Tamaño</label>
                  <Select value={m.tamano} onChange={e => setM(i, 'tamano', e.target.value)}>{TAMANOS.map(s => <option key={s}>{s}</option>)}</Select></div>
                <div><label className={LABEL}>Peso kg</label><Input value={m.peso_kg} onChange={e => setM(i, 'peso_kg', e.target.value)} /></div>
                <div><label className={LABEL}>Edad</label><Input value={m.edad_anios} onChange={e => setM(i, 'edad_anios', e.target.value)} /></div>
                <button type="button" aria-label="Quitar mascota" disabled={f.mascotas.length === 1}
                  onClick={() => onForm(x => ({ ...x, mascotas: x.mascotas.filter((_, j) => j !== i) }))}
                  className="p-2 text-ink3 hover:text-danger disabled:opacity-30"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onForm(x => ({ ...x, mascotas: [...x.mascotas, MASCOTA_VACIA()] }))}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1A5CD8] hover:underline"><Plus size={11} /> Agregar mascota</button>
        </div>

        <div>
          <div className="text-[11px] font-bold text-ink2 mb-1">Plan</div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <div><label className={LABEL}>Tipo</label>
              <Select value={f.tipo} onChange={e => setF('tipo', e.target.value)}>{TIPOS.map(s => <option key={s}>{s}</option>)}</Select></div>
            <div><label className={LABEL}>Nivel</label>
              <Select value={f.nivel} onChange={e => setF('nivel', e.target.value)}>{NIVELES.map(s => <option key={s}>{s}</option>)}</Select></div>
            <div><label className={LABEL}>Fecha de afiliación</label><Input type="date" value={f.fecha} max={hoy} onChange={e => setF('fecha', e.target.value)} /></div>
            <div><label className={LABEL}>Valor por mascota</label><Input type="number" min="0" value={f.valor} onChange={e => setF('valor', e.target.value)} /></div>
            <div><label className={LABEL}>Método de pago</label>
              <Select value={f.metodo} onChange={e => setF('metodo', e.target.value)}>{METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
            <div><label className={LABEL}>Vigente hasta</label>
              {f.tipo === 'ANUAL'
                ? <Input type="date" value={f.vigenteHasta} onChange={e => setF('vigenteHasta', e.target.value)} />
                : <Input value="De por vida" disabled readOnly />}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div><label className={LABEL}>Nº de contrato (el del papel; vacío = se genera)</label>
              <Input className="font-mono" value={f.numero} placeholder={plan.numero0}
                onChange={e => setF('numero', e.target.value.toUpperCase())} onBlur={onRevisar} /></div>
            <div><label className={LABEL}>Observaciones</label><Input value={f.observaciones} onChange={e => setF('observaciones', e.target.value)} /></div>
          </div>
        </div>

        {/* Así quedará: que el coordinador vea antigüedad y vigencia antes de crear */}
        {!errores.length && (
          <div className="rounded-lg bg-surface2 px-3 py-2 text-[11px] text-ink2 space-y-0.5">
            <div>Afiliado desde <b>{f.fecha}</b>{anios > 0 ? ` (${anios} año${anios === 1 ? '' : 's'} de antigüedad)` : ''} ·
              {' '}{f.mascotas.filter(m => m.nombre.trim()).length} mascota(s) × {fmt(parseFloat(f.valor) || 0)}</div>
            <div>Contrato del papel: <span className="font-mono font-bold">{plan.numero0}</span>
              {f.tipo === 'ANUAL' && <> · {f.fecha} → {plan.vence0}</>}</div>
            {plan.actual && (
              <div>Periodo actual (renovación {plan.actual.numero}): <span className="font-mono font-bold">{plan.actual.numeroContrato}</span> · {plan.actual.inicio} → {plan.actual.vence} · sin cláusula 5×/3×</div>
            )}
            {f.tipo === 'ANUAL' && f.vigenteHasta < hoy && (
              <div className="text-[#9A5500] font-semibold">⚠ "Vigente hasta" ya pasó: entrará vencido (o cancelado si pasó la gracia).</div>
            )}
          </div>
        )}

        {(errores.length > 0 || it.numeroRepetido || it.error) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 space-y-0.5">
            {errores.map(e => <div key={e}>· {e}</div>)}
            {it.numeroRepetido && <div>· El nº de contrato {f.numero} ya existe en Orbit: ¿este contrato ya se subió?</div>}
            {it.error && <div>· {it.error}</div>}
          </div>
        )}
      </fieldset>
    </div>
  )
}
