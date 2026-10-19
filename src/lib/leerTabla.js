// Lee una base de datos que alguien consiguió (CSV o Excel .xlsx) y la devuelve
// como { columnas, filas } con filas = arreglos de texto.
//
// Sin librerías: un .xlsx es un ZIP con XML adentro, y el navegador ya trae
// cómo descomprimir (`DecompressionStream('deflate-raw')`) y cómo leer XML
// (`DOMParser`). Agregar SheetJS para esto eran ~400 KB al bundle de todos.

export async function leerTabla(file) {
  const nombre = (file?.name || '').toLowerCase()
  if (nombre.endsWith('.xlsx')) return leerXlsx(await file.arrayBuffer())
  if (nombre.endsWith('.xls')) throw new Error('Formato .xls antiguo: ábrelo en Excel y guárdalo como .xlsx o .csv')
  return leerCsv(await leerTextoCsv(file))
}

// Los CSV de Excel en Colombia suelen venir en Windows-1252 (tildes rotas en
// UTF-8). Si el UTF-8 trae el carácter de reemplazo, se relee en 1252.
async function leerTextoCsv(file) {
  const buf = await file.arrayBuffer()
  let texto = new TextDecoder('utf-8').decode(buf)
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf)
  return texto.replace(/^﻿/, '')
}

export function leerCsv(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] || ''
  const cuenta = c => (primera.match(new RegExp(`\\${c}`, 'g')) || []).length
  const sep = [';', ',', '\t', '|'].sort((a, b) => cuenta(b) - cuenta(a))[0]

  const filas = []
  let fila = [], campo = '', comillas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else comillas = false
      } else campo += ch
    } else if (ch === '"') comillas = true
    else if (ch === sep) { fila.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      fila.push(campo); filas.push(fila); fila = []; campo = ''
    } else campo += ch
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return aTabla(filas)
}

function aTabla(filas) {
  const limpias = filas
    .map(f => f.map(c => String(c ?? '').trim()))
    .filter(f => f.some(c => c !== ''))
  if (!limpias.length) return { columnas: [], filas: [] }
  const ancho = Math.max(...limpias.map(f => f.length))
  const columnas = limpias[0].map((c, i) => c || `Columna ${i + 1}`)
  while (columnas.length < ancho) columnas.push(`Columna ${columnas.length + 1}`)
  return { columnas, filas: limpias.slice(1).map(f => columnas.map((_, i) => f[i] ?? '')) }
}

// ─── XLSX ───────────────────────────────────────────────────────────────────
async function leerXlsx(buffer) {
  const archivos = await descomprimirZip(buffer)
  const xml = nombre => archivos[nombre] ? new DOMParser().parseFromString(archivos[nombre], 'application/xml') : null

  const compartidas = []
  const sst = xml('xl/sharedStrings.xml')
  if (sst) {
    for (const si of sst.getElementsByTagName('si')) {
      compartidas.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''))
    }
  }

  // La PRIMERA hoja visible del libro, no necesariamente "sheet1.xml".
  let ruta = 'xl/worksheets/sheet1.xml'
  const libro = xml('xl/workbook.xml')
  const rels = xml('xl/_rels/workbook.xml.rels')
  const hoja = libro?.getElementsByTagName('sheet')[0]
  if (hoja && rels) {
    const rid = hoja.getAttribute('r:id') || hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid)
    if (rel) {
      const destino = rel.getAttribute('Target').replace(/^\/?xl\//, '')
      ruta = 'xl/' + destino.replace(/^\//, '')
    }
  }
  const doc = xml(ruta)
  if (!doc) throw new Error('No encontré la hoja de cálculo dentro del archivo')

  const filas = []
  for (const row of doc.getElementsByTagName('row')) {
    const fila = []
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || ''
      const col = columnaDeRef(ref)
      const tipo = c.getAttribute('t')
      let valor = ''
      if (tipo === 's') valor = compartidas[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? ''
      else if (tipo === 'inlineStr') valor = [...c.getElementsByTagName('t')].map(t => t.textContent).join('')
      else valor = c.getElementsByTagName('v')[0]?.textContent ?? ''
      // Teléfonos largos guardados como número: 3.00123E+9 → 3001234567.
      if (tipo !== 's' && tipo !== 'inlineStr' && /^\d+(\.\d+)?E\+\d+$/i.test(valor)) valor = String(Math.round(Number(valor)))
      if (col >= 0) fila[col] = valor
      else fila.push(valor)
    }
    filas.push(Array.from(fila, v => v ?? ''))
  }
  return aTabla(filas)
}

function columnaDeRef(ref) {
  const m = /^([A-Z]+)/.exec(ref)
  if (!m) return -1
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Lee el directorio central del ZIP y descomprime solo los XML. */
async function descomprimirZip(buffer) {
  const dv = new DataView(buffer)
  let fin = -1
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break }
  }
  if (fin < 0) throw new Error('El archivo no parece un Excel válido (.xlsx)')
  const total = dv.getUint16(fin + 10, true)
  let p = dv.getUint32(fin + 16, true)
  const dec = new TextDecoder('utf-8')
  const out = {}
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const metodo = dv.getUint16(p + 10, true)
    const comprimido = dv.getUint32(p + 20, true)
    const largoNombre = dv.getUint16(p + 28, true)
    const largoExtra = dv.getUint16(p + 30, true)
    const largoComent = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const nombre = dec.decode(new Uint8Array(buffer, p + 46, largoNombre))
    p += 46 + largoNombre + largoExtra + largoComent
    if (!nombre.endsWith('.xml') && !nombre.endsWith('.rels')) continue
    const ln = dv.getUint16(local + 26, true)
    const le = dv.getUint16(local + 28, true)
    const datos = new Uint8Array(buffer, local + 30 + ln + le, comprimido)
    if (metodo === 0) out[nombre] = dec.decode(datos)
    else if (metodo === 8) {
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out[nombre] = await new Response(flujo).text()
    }
  }
  return out
}

// ─── Mapeo de columnas a campos del prospecto ───────────────────────────────
export const CAMPOS_IMPORTACION = [
  { clave: 'nombre',          label: 'Nombre de la veterinaria', obligatorio: true,
    pistas: ['nombre', 'veterinaria', 'clinica', 'clínica', 'establecimiento', 'razon social', 'razón social', 'empresa', 'title', 'name'] },
  { clave: 'contacto_nombre', label: 'Persona de contacto', pistas: ['contacto', 'responsable', 'medico', 'médico', 'doctor', 'propietario', 'dueño', 'representante'] },
  { clave: 'contacto_cargo',  label: 'Cargo', pistas: ['cargo', 'rol', 'puesto'] },
  { clave: 'telefono',        label: 'Teléfono', pistas: ['telefono', 'teléfono', 'tel', 'fijo', 'phone'] },
  { clave: 'whatsapp',        label: 'WhatsApp / celular', pistas: ['whatsapp', 'celular', 'movil', 'móvil', 'cel'] },
  { clave: 'email',           label: 'Correo', pistas: ['email', 'correo', 'e-mail', 'mail'] },
  { clave: 'direccion',       label: 'Dirección', pistas: ['direccion', 'dirección', 'address', 'ubicacion', 'ubicación'] },
  { clave: 'barrio',          label: 'Barrio', pistas: ['barrio', 'sector'] },
  { clave: 'localidad',       label: 'Localidad', pistas: ['localidad', 'zona'] },
  { clave: 'ciudad',          label: 'Ciudad / municipio', pistas: ['ciudad', 'municipio', 'city'] },
  { clave: 'instagram',       label: 'Instagram / redes', pistas: ['instagram', 'redes', 'facebook', 'ig'] },
  { clave: 'sitio_web',       label: 'Sitio web', pistas: ['web', 'sitio', 'pagina', 'página', 'website', 'url'] },
  { clave: 'potencial_mensual', label: 'Potencial (servicios/mes)', pistas: ['potencial', 'servicios mes'] },
  { clave: 'notas',           label: 'Notas', pistas: ['nota', 'notas', 'observacion', 'observación', 'comentario', 'descripcion', 'descripción'] },
]

const normal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Adivina a qué campo va cada columna por su encabezado. */
export function mapeoSugerido(columnas) {
  const usado = new Set()
  const mapa = {}
  columnas.forEach((col, i) => {
    const c = normal(col)
    const campo = CAMPOS_IMPORTACION.find(f => !usado.has(f.clave) && f.pistas.some(p => c === normal(p)))
      || CAMPOS_IMPORTACION.find(f => !usado.has(f.clave) && f.pistas.some(p => c.includes(normal(p))))
    if (campo) { mapa[i] = campo.clave; usado.add(campo.clave) } else mapa[i] = ''
  })
  return mapa
}

/** Filas del archivo → objetos para el backend. Lo no mapeado va en `datos`. */
export function aplicarMapeo({ columnas, filas }, mapa) {
  return filas.map(f => {
    const o = { datos: {} }
    columnas.forEach((col, i) => {
      const v = f[i]
      if (!v) return
      if (mapa[i]) o[mapa[i]] = o[mapa[i]] ? `${o[mapa[i]]} ${v}` : v
      else o.datos[col] = v
    })
    return o
  })
}
