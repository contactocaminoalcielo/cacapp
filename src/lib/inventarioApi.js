// Inventario — cliente del frontend.
//
// REPARTO (mismo criterio que lib/ofertas.js):
//   · CATÁLOGO (insumos, proveedores, presentaciones) → PostgREST directo.
//     Es configuración: nombres, categorías, unidades, mínimos.
//   · MOVIMIENTOS → orbit-backend. Cambian el saldo y el costo promedio, y de
//     ahí salen los números de Finanzas. Van con rol y con transacción.
//
// ⚠️ `stock_actual`, `costo_promedio` y `costo_ultimo` NUNCA se escriben desde
// aquí. Los mantiene el trigger de la migración 120 junto al movimiento, en la
// misma transacción. Mandarlos en un UPDATE del catálogo los desviaría del
// kardex y nadie lo notaría hasta el conteo físico.
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'

export const UNIDADES = ['unidad', 'g', 'kg', 'ml', 'l', 'cm', 'm', 'm2', 'pliego', 'hoja']

export const TIPOS_MOVIMIENTO = [
  { valor: 'ENTRADA_COMPRA',     label: 'Compra',              signo: '+', costo: true  },
  { valor: 'ENTRADA_AJUSTE',     label: 'Ajuste de entrada',   signo: '+', costo: false },
  { valor: 'ENTRADA_DEVOLUCION', label: 'Devolución a bodega', signo: '+', costo: false },
  { valor: 'SALIDA_PRODUCCION',  label: 'Consumo en producción', signo: '−', costo: false },
  { valor: 'SALIDA_MERMA',       label: 'Merma o daño',        signo: '−', costo: false },
  { valor: 'SALIDA_AJUSTE',      label: 'Ajuste de salida',    signo: '−', costo: false },
]

export const LABEL_TIPO = Object.fromEntries(TIPOS_MOVIMIENTO.map(t => [t.valor, t.label]))

export const ESTADO_STOCK = {
  OK:       { label: 'En orden',   clase: 'bg-emerald-50 text-emerald-700' },
  REPONER:  { label: 'Reponer',    clase: 'bg-amber-50 text-amber-700'     },
  NEGATIVO: { label: 'En negativo', clase: 'bg-red-50 text-red-700'        },
}

// ── Backend: movimientos y saldos ───────────────────────────────────────────

/** Existencias + cifras de cabecera. Todo agregado en SQL, no en el navegador. */
export const cargarStock = (soloActivos = true) =>
  orbitApi(`/inventario/stock?solo_activos=${soloActivos}`)

/** Kardex. El backend siempre ordena antes de paginar. */
export function cargarMovimientos({ insumoId, tipo, desde, hasta, limit = 100, offset = 0 } = {}) {
  const q = new URLSearchParams()
  if (insumoId) q.set('insumo_id', insumoId)
  if (tipo)     q.set('tipo', tipo)
  if (desde)    q.set('desde', desde)
  if (hasta)    q.set('hasta', hasta)
  q.set('limit', limit); q.set('offset', offset)
  return orbitApi(`/inventario/movimientos?${q}`)
}

/** `cantidad` va SIEMPRE positiva: el signo lo pone el tipo, en el servidor. */
export const registrarMovimiento = body =>
  orbitApi('/inventario/movimientos', { method: 'POST', body })

export const revertirMovimiento = (id, motivo) =>
  orbitApi(`/inventario/movimientos/${id}/revertir`, { method: 'POST', body: { motivo } })

export const importarCatalogo = filas =>
  orbitApi('/inventario/importar', { method: 'POST', body: { filas } })

/** Compara el saldo guardado contra la suma del kardex. Debería dar siempre ok. */
export const verificarSaldos = () => orbitApi('/inventario/verificar')

// ── Catálogo (PostgREST) ────────────────────────────────────────────────────

export async function listarInsumos() {
  const { data, error } = await db.from('inventario_insumos')
    .select('*, inventario_proveedores(id, nombre)')
    .order('nombre')
  if (error) throw error
  return data || []
}

// Lo que la pantalla puede tocar del catálogo. Todo lo demás —el saldo y el
// costo— es territorio del trigger. La lista blanca es explícita para que
// agregar un campo al formulario sea una decisión, no un accidente.
const CAMPOS_INSUMO = [
  'codigo', 'nombre', 'categoria', 'tipo', 'unidad_base',
  'stock_minimo', 'stock_objetivo', 'proveedor_id', 'dias_reposicion',
  'perecedero', 'notas', 'activo',
]

function limpiarInsumo(form) {
  const body = {}
  for (const k of CAMPOS_INSUMO) {
    let v = form[k]
    if (v === '' || v === undefined) v = null
    body[k] = v
  }
  // Numéricos: un NULL explícito NO cae al DEFAULT de la columna, y
  // `stock_minimo` es NOT NULL. Sin esto el guardado revienta con un error que
  // no dice nada.
  body.stock_minimo    = Number(form.stock_minimo) || 0
  body.stock_objetivo  = form.stock_objetivo === '' || form.stock_objetivo == null
    ? null : Number(form.stock_objetivo)
  body.dias_reposicion = form.dias_reposicion === '' || form.dias_reposicion == null
    ? null : parseInt(form.dias_reposicion)
  body.unidad_base     = form.unidad_base || 'unidad'
  body.tipo            = form.tipo || 'INSUMO'
  body.perecedero      = !!form.perecedero
  body.activo          = form.activo !== false
  return body
}

export async function guardarInsumo(id, form) {
  const body = limpiarInsumo(form)
  const { error } = id
    ? await db.from('inventario_insumos').update(body).eq('id', id)
    : await db.from('inventario_insumos').insert(body)
  if (error) throw error
}

export async function listarProveedores() {
  const { data, error } = await db.from('inventario_proveedores')
    .select('*').order('nombre')
  if (error) throw error
  return data || []
}

export async function guardarProveedor(id, form) {
  const body = {
    nombre: form.nombre?.trim(),
    nit: form.nit || null,
    contacto_nombre: form.contacto_nombre || null,
    telefono: form.telefono || null,
    email: form.email || null,
    dias_entrega: parseInt(form.dias_entrega) || 7,
    notas: form.notas || null,
    activo: form.activo !== false,
  }
  const { error } = id
    ? await db.from('inventario_proveedores').update(body).eq('id', id)
    : await db.from('inventario_proveedores').insert(body)
  if (error) throw error
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export const COLUMNAS_CSV = [
  'nombre', 'codigo', 'categoria', 'unidad_base',
  'stock_inicial', 'costo_unitario', 'stock_minimo', 'proveedor',
]

export const PLANTILLA_CSV =
  COLUMNAS_CSV.join(',') + '\n' +
  'Marco de madera 20x25,MAD-2025,MADERA,unidad,30,8500,10,Maderas del Norte\n' +
  'Arcilla polimérica,ARC-001,ARCILLA,g,25000,12,5000,Insumos Creativos\n'

/**
 * Parser de CSV mínimo pero correcto: respeta comillas dobles y comas dentro
 * de ellas, y acepta `;` porque es lo que exporta Excel en español.
 *
 * Devuelve `{ filas, errores }` — nunca lanza. Un CSV torcido debe poder
 * revisarse en pantalla antes de mandar nada al servidor.
 */
export function parsearCSV(texto) {
  const errores = []
  const lineas = (texto || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())
  if (!lineas.length) return { filas: [], errores: ['El archivo está vacío'] }

  const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ','

  const partir = linea => {
    const out = []
    let campo = '', dentro = false
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (c === '"') {
        if (dentro && linea[i + 1] === '"') { campo += '"'; i++ }
        else dentro = !dentro
      } else if (c === sep && !dentro) { out.push(campo); campo = '' }
      else campo += c
    }
    out.push(campo)
    return out.map(v => v.trim())
  }

  const cabecera = partir(lineas[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  if (!cabecera.includes('nombre')) {
    return { filas: [], errores: ['La primera fila debe ser la cabecera y llevar una columna "nombre"'] }
  }

  const filas = []
  for (let i = 1; i < lineas.length; i++) {
    const celdas = partir(lineas[i])
    const fila = {}
    cabecera.forEach((h, j) => { if (COLUMNAS_CSV.includes(h)) fila[h] = celdas[j] ?? '' })
    if (!fila.nombre) { errores.push(`Fila ${i + 1}: sin nombre, se omite`); continue }
    // Cifras en formato colombiano: "8.500,50" y "$ 8.500" tienen que entrar
    // bien. Pegar una columna de Excel sin limpiar es lo normal, no la excepción.
    for (const k of ['stock_inicial', 'costo_unitario', 'stock_minimo']) {
      fila[k] = numeroCO(fila[k])
    }
    filas.push(fila)
  }
  return { filas, errores }
}

function numeroCO(v) {
  if (v == null || v === '') return 0
  const limpio = String(v).replace(/[^\d,.-]/g, '')
  // Si trae punto y coma, el punto es separador de miles y la coma decimal.
  const norm = limpio.includes(',') && limpio.includes('.')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio.replace(',', '.')
  const n = Number(norm)
  return Number.isFinite(n) ? n : 0
}
