// Módulo de Inventario — fase 1: catálogo, kardex y saldos.
//
// Lo que esta pantalla NO hace todavía (fase 2, migración 121): descontar sola
// cuando producción marca un recordatorio como LISTO. Aquí todo movimiento se
// registra a mano, a propósito: encender el automatismo contra un catálogo
// vacío produciría números falsos con apariencia de exactitud.
//
// ⚠️ El saldo y el costo promedio NO se editan desde aquí. Los mantiene el
// trigger de la migración 120 junto a cada movimiento. El formulario del insumo
// solo toca configuración (nombre, unidad, mínimos, proveedor).
//
// Diseño completo: docs/Orbit_Context/MODULES/INVENTARIO.md
import { useState, useEffect, useMemo, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { Card, CardContent, StatCard } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { fmt, parsearErrorDB, fmtDateTime } from '@/lib/utils'
import {
  cargarStock, cargarMovimientos, registrarMovimiento, revertirMovimiento,
  importarCatalogo, verificarSaldos,
  listarProveedores, guardarInsumo, guardarProveedor,
  parsearCSV, PLANTILLA_CSV, COLUMNAS_CSV,
  UNIDADES, TIPOS_MOVIMIENTO, LABEL_TIPO, ESTADO_STOCK,
} from '@/lib/inventarioApi'
import {
  Package, Plus, Search, AlertTriangle, TrendingDown, Wallet, ArrowDownToLine,
  ArrowUpFromLine, History, Truck, Upload, RotateCcw, ShieldCheck, FileDown,
} from 'lucide-react'

const LABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1'

const nfCantidad = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 })
const cant = n => nfCantidad.format(Number(n) || 0)

export default function Inventario() {
  const { alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  // El PRODUCTOR ve el inventario y reporta merma —tiene el material en la mano—
  // pero no toca catálogo, compras ni proveedores. El backend lo revalida.
  const esProductor = personalData?.rol === 'PRODUCTOR'

  const [resumen, setResumen] = useState(null)
  const [insumos, setInsumos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('existencias')

  const [editando, setEditando] = useState(null)   // insumo | { _nuevo: true }
  const [moviendo, setMoviendo] = useState(null)   // { insumo, tipoInicial }
  const [verKardex, setVerKardex] = useState(null) // insumo

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const r = await cargarStock(false)
      setResumen(r.resumen); setInsumos(r.insumos || [])
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo cargar el inventario' })
    } finally { setLoading(false) }
  }

  async function verificar() {
    try {
      const r = await verificarSaldos()
      if (r.ok) {
        await showAlert('Todos los saldos cuadran con el kardex.', { title: 'Sin descuadres' })
      } else {
        await showAlert(
          r.descuadres.map(d => `${d.nombre}: guardado ${cant(d.stock_actual)}, kardex ${cant(d.suma_kardex)}`).join('\n'),
          { title: `${r.descuadres.length} descuadre(s)`, variant: 'warning' })
      }
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo verificar' })
    }
  }

  return (
    <div>
      <Topbar />
      <div className="p-4 sm:p-7 space-y-6">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Valor del inventario" value={fmt(resumen?.valor_total)} icon={Wallet}
                    valueColor="#1A5CD8"
                    sub={resumen?.sin_costo ? `${resumen.sin_costo} sin costo cargado` : null} />
          <StatCard label="Hay que reponer" value={resumen?.a_reponer ?? '—'} icon={AlertTriangle}
                    valueColor={resumen?.a_reponer ? '#B45309' : undefined} />
          <StatCard label="En negativo" value={resumen?.en_negativo ?? '—'} icon={TrendingDown}
                    valueColor={resumen?.en_negativo ? '#DC2626' : undefined}
                    sub={resumen?.en_negativo ? 'Falta registrar entradas' : null} />
          <StatCard label="Insumos" value={resumen?.insumos ?? '—'} icon={Package} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="existencias">Existencias</TabsTrigger>
              <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
              {!esProductor && <TabsTrigger value="proveedores">Proveedores</TabsTrigger>}
              {!esProductor && <TabsTrigger value="importar">Importar</TabsTrigger>}
            </TabsList>
            {!esProductor && (
              <Button size="sm" variant="ghost" onClick={verificar}>
                <ShieldCheck size={14} /> Verificar saldos
              </Button>
            )}
          </div>

          <TabsContent value="existencias" className="mt-5">
            <TabExistencias
              insumos={insumos} loading={loading} esProductor={esProductor}
              onNuevo={() => setEditando({ _nuevo: true })}
              onEditar={i => setEditando(i)}
              onMover={(insumo, tipoInicial) => setMoviendo({ insumo, tipoInicial })}
              onKardex={i => setVerKardex(i)} />
          </TabsContent>

          <TabsContent value="movimientos" className="mt-5">
            <TabMovimientos insumos={insumos} esProductor={esProductor} onCambio={cargar} />
          </TabsContent>

          {!esProductor && (
            <TabsContent value="proveedores" className="mt-5"><TabProveedores /></TabsContent>
          )}
          {!esProductor && (
            <TabsContent value="importar" className="mt-5">
              <TabImportar onImportado={cargar} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {editando && (
        <ModalInsumo insumo={editando._nuevo ? null : editando}
          onClose={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar() }} />
      )}

      {moviendo && (
        <ModalMovimiento insumo={moviendo.insumo} tipoInicial={moviendo.tipoInicial}
          esProductor={esProductor}
          onClose={() => setMoviendo(null)}
          onListo={async () => { setMoviendo(null); await cargar() }} />
      )}

      {verKardex && (
        <ModalKardex insumo={verKardex} onClose={() => setVerKardex(null)} />
      )}
    </div>
  )
}

// ─── Existencias ─────────────────────────────────────────────────────────────
function TabExistencias({ insumos, loading, esProductor, onNuevo, onEditar, onMover, onKardex }) {
  const [q, setQ] = useState('')
  const [soloReponer, setSoloReponer] = useState(false)
  const [verInactivos, setVerInactivos] = useState(false)

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return insumos.filter(i =>
      (verInactivos || i.activo) &&
      (!soloReponer || i.estado_stock !== 'OK') &&
      (!t || (i.nombre || '').toLowerCase().includes(t)
          || (i.codigo || '').toLowerCase().includes(t)
          || (i.categoria || '').toLowerCase().includes(t))
    )
  }, [insumos, q, soloReponer, verInactivos])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" placeholder="Buscar por nombre, código o categoría..."
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={soloReponer} onChange={e => setSoloReponer(e.target.checked)}
                 className="w-4 h-4 accent-[#1A5CD8]" />
          <span className="text-[12px] font-semibold text-gray-600">Solo lo que hay que pedir</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)}
                 className="w-4 h-4 accent-[#1A5CD8]" />
          <span className="text-[12px] font-semibold text-gray-600">Ver inactivos</span>
        </label>
        {!esProductor && (
          <Button size="sm" className="ml-auto" onClick={onNuevo}><Plus size={14} /> Nuevo insumo</Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando inventario…</div>
      ) : filtrados.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Package size={30} className="mx-auto mb-3 text-gray-300" />
          <p className="text-[14px] font-semibold text-gray-600">
            {insumos.length === 0 ? 'Todavía no hay insumos cargados' : 'Ninguno coincide con el filtro'}
          </p>
          <p className="text-[12px] text-gray-400 mt-1 max-w-md mx-auto">
            {insumos.length === 0
              ? 'Carga el catálogo desde la pestaña Importar con el saldo real de un conteo. Los números solo sirven si arrancan de algo cierto.'
              : 'Prueba quitando los filtros.'}
          </p>
        </CardContent></Card>
      ) : (
        <Card>
          <TableWrap>
            <Table>
              <thead><tr>
                <Th>Insumo</Th><Th>Categoría</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="text-right">Cobertura</Th>
                <Th className="text-right">Costo unit.</Th>
                <Th className="text-right">Valor</Th>
                <Th>Estado</Th><Th></Th>
              </tr></thead>
              <tbody>
                {filtrados.map(i => {
                  const est = ESTADO_STOCK[i.estado_stock] || ESTADO_STOCK.OK
                  const cob = i.dias_cobertura
                  return (
                    <Tr key={i.id} className={!i.activo ? 'opacity-50' : ''}>
                      <Td>
                        <button onClick={() => !esProductor && onEditar(i)}
                                className="text-left font-semibold text-gray-900 hover:text-[#1A5CD8] transition-colors">
                          {i.nombre}
                        </button>
                        {i.codigo && <div className="text-[11px] text-gray-400 font-mono">{i.codigo}</div>}
                      </Td>
                      <Td><span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {i.categoria || '—'}</span></Td>
                      <Td className="text-right tabular-nums font-semibold text-gray-900">
                        {cant(i.stock_actual)}
                        <span className="text-[11px] text-gray-400 font-normal ml-1">{i.unidad_base}</span>
                      </Td>
                      <Td className="text-right tabular-nums text-[12px]">
                        {cob == null ? <span className="text-gray-300">—</span> : (
                          <span className={cob <= Number(i.dias_reposicion) ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
                            {cant(cob)} d
                          </span>
                        )}
                        <div className="text-[10px] text-gray-400">proveedor {i.dias_reposicion} d</div>
                      </Td>
                      <Td className="text-right tabular-nums text-[12px] text-gray-600">
                        {Number(i.costo_promedio) > 0
                          ? fmt(i.costo_promedio)
                          : <span className="text-amber-600 font-semibold">sin costo</span>}
                      </Td>
                      <Td className="text-right tabular-nums text-[12px] text-gray-700">{fmt(i.valor_inventario)}</Td>
                      <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${est.clase}`}>{est.label}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1 justify-end">
                          {!esProductor && (
                            <button title="Registrar entrada" onClick={() => onMover(i, 'ENTRADA_COMPRA')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50">
                              <ArrowDownToLine size={14} />
                            </button>
                          )}
                          <button title="Registrar salida" onClick={() => onMover(i, esProductor ? 'SALIDA_MERMA' : 'SALIDA_PRODUCCION')}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100">
                            <ArrowUpFromLine size={14} />
                          </button>
                          <button title="Ver kardex" onClick={() => onKardex(i)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100">
                            <History size={14} />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  )
}

// ─── Movimientos (kardex global) ─────────────────────────────────────────────
function TabMovimientos({ insumos, esProductor, onCambio }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [movs, setMovs] = useState([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [f, setF] = useState({ insumoId: '', tipo: '', desde: '', hasta: '' })

  useEffect(() => { recargar() }, [f.insumoId, f.tipo, f.desde, f.hasta])

  async function recargar(offset = 0) {
    setCargando(true)
    try {
      const r = await cargarMovimientos({ ...f, offset })
      setMovs(offset ? m => [...m, ...r.movimientos] : r.movimientos)
      setHayMas(r.hay_mas)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo leer el kardex' })
    } finally { setCargando(false) }
  }

  async function revertir(m) {
    const ok = await confirm(
      'No se borra el movimiento: se registra el contrario y los dos quedan en el kardex. El saldo vuelve a donde estaba.',
      { title: `¿Revertir ${LABEL_TIPO[m.tipo] || m.tipo} de ${m.insumo_nombre}?`, variant: 'warning', confirmLabel: 'Revertir' })
    if (!ok) return
    try {
      await revertirMovimiento(m.id)
      await recargar(); await onCambio()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo revertir' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={LABEL}>Insumo</label>
          <Select value={f.insumoId} onChange={e => setF(p => ({ ...p, insumoId: e.target.value }))}>
            <option value="">Todos</option>
            {insumos.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </Select>
        </div>
        <div>
          <label className={LABEL}>Tipo</label>
          <Select value={f.tipo} onChange={e => setF(p => ({ ...p, tipo: e.target.value }))}>
            <option value="">Todos</option>
            {TIPOS_MOVIMIENTO.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </Select>
        </div>
        <div>
          <label className={LABEL}>Desde</label>
          <Input type="date" value={f.desde} onChange={e => setF(p => ({ ...p, desde: e.target.value }))} />
        </div>
        <div>
          <label className={LABEL}>Hasta</label>
          <Input type="date" value={f.hasta} onChange={e => setF(p => ({ ...p, hasta: e.target.value }))} />
        </div>
      </div>

      {cargando && movs.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando kardex…</div>
      ) : movs.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <History size={30} className="mx-auto mb-3 text-gray-300" />
          <p className="text-[14px] font-semibold text-gray-600">Sin movimientos</p>
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <TableWrap>
              <Table>
                <thead><tr>
                  <Th>Fecha</Th><Th>Insumo</Th><Th>Tipo</Th>
                  <Th className="text-right">Cantidad</Th>
                  <Th className="text-right">Costo unit.</Th>
                  <Th>Motivo</Th><Th>Quién</Th><Th></Th>
                </tr></thead>
                <tbody>
                  {movs.map(m => {
                    const entra = Number(m.cantidad) > 0
                    return (
                      <Tr key={m.id} className={m.revertido_en ? 'opacity-45' : ''}>
                        <Td className="text-[12px] text-gray-500 whitespace-nowrap">{fmtDateTime(m.created_at)}</Td>
                        <Td className="font-semibold text-gray-900">{m.insumo_nombre}</Td>
                        <Td>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            entra ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {LABEL_TIPO[m.tipo] || m.tipo}
                          </span>
                          {m.origen_tipo === 'REVERSA' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ml-1">
                              reversa
                            </span>
                          )}
                        </Td>
                        <Td className={`text-right tabular-nums font-semibold ${entra ? 'text-emerald-700' : 'text-gray-800'}`}>
                          {entra ? '+' : ''}{cant(m.cantidad)}
                          <span className="text-[11px] text-gray-400 font-normal ml-1">{m.unidad_base}</span>
                        </Td>
                        <Td className="text-right tabular-nums text-[12px] text-gray-600">{fmt(m.costo_unitario)}</Td>
                        <Td className="text-[12px] text-gray-500 max-w-xs truncate">{m.motivo || '—'}</Td>
                        <Td className="text-[12px] text-gray-400">{m.registrado_por_nombre || '—'}</Td>
                        <Td>
                          {!esProductor && !m.revertido_en && m.origen_tipo !== 'REVERSA' && (
                            <button title="Revertir" onClick={() => revertir(m)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600">
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
          {hayMas && (
            <div className="text-center">
              <Button size="sm" variant="secondary" disabled={cargando}
                      onClick={() => recargar(movs.length)}>
                {cargando ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Proveedores ─────────────────────────────────────────────────────────────
function TabProveedores() {
  const { alert: showAlert } = useConfirm()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try { setData(await listarProveedores()) }
    catch (e) { await showAlert(parsearErrorDB(e), { title: 'Error' }) }
    finally { setLoading(false) }
  }

  function abrir(p) {
    setEditando(p || { _nuevo: true }); setError('')
    setForm(p ? { ...p } : { nombre: '', dias_entrega: 7, activo: true })
  }

  async function guardar() {
    if (!form.nombre?.trim()) return setError('El nombre es requerido.')
    setGuardando(true); setError('')
    try {
      await guardarProveedor(editando._nuevo ? null : editando.id, form)
      setEditando(null); await cargar()
    } catch (e) { setError(parsearErrorDB(e)) }
    finally { setGuardando(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo proveedor</Button>
      </div>
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Cargando…</div>
      ) : data.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Truck size={30} className="mx-auto mb-3 text-gray-300" />
          <p className="text-[14px] font-semibold text-gray-600">Sin proveedores</p>
          <p className="text-[12px] text-gray-400 mt-1">
            Los días de entrega de cada uno son lo que convierte «queda poco» en «hay que pedir hoy».
          </p>
        </CardContent></Card>
      ) : (
        <Card><TableWrap><Table>
          <thead><tr>
            <Th>Proveedor</Th><Th>Contacto</Th><Th>Teléfono</Th>
            <Th className="text-right">Entrega</Th><Th>Estado</Th>
          </tr></thead>
          <tbody>
            {data.map(p => (
              <Tr key={p.id} onClick={() => abrir(p)}>
                <Td className="font-semibold text-gray-900">{p.nombre}</Td>
                <Td className="text-[12px] text-gray-500">{p.contacto_nombre || '—'}</Td>
                <Td className="text-[12px] text-gray-500">{p.telefono || '—'}</Td>
                <Td className="text-right tabular-nums text-[12px] text-gray-600">{p.dias_entrega} d</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  p.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.activo ? 'Activo' : 'Inactivo'}</span></Td>
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap></Card>
      )}

      {editando && (
        <Modal open onClose={() => setEditando(null)}
          title={editando._nuevo ? 'Nuevo proveedor' : editando.nombre}
          footer={<>
            <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
          </>}>
          <div className="space-y-4">
            {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={LABEL}>Nombre *</label>
                <Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div><label className={LABEL}>NIT</label>
                <Input value={form.nit || ''} onChange={e => setForm(p => ({ ...p, nit: e.target.value }))} /></div>
              <div><label className={LABEL}>Contacto</label>
                <Input value={form.contacto_nombre || ''} onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))} /></div>
              <div><label className={LABEL}>Teléfono</label>
                <Input value={form.telefono || ''} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} /></div>
              <div><label className={LABEL}>Email</label>
                <Input value={form.email || ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className={LABEL}>Días de entrega</label>
                <Input type="number" min="0" value={form.dias_entrega ?? 7}
                       onChange={e => setForm(p => ({ ...p, dias_entrega: e.target.value }))} />
                <p className="text-[11px] text-gray-400 mt-1">Cuánto tarda desde que se le pide.</p></div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.activo !== false}
                     onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))}
                     className="w-4 h-4 accent-[#1A5CD8]" />
              <span className="text-[13px] font-semibold text-gray-700">Activo</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Importar CSV ────────────────────────────────────────────────────────────
function TabImportar({ onImportado }) {
  const { alert: showAlert } = useConfirm()
  const fileRef = useRef(null)
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState(null)
  const [subiendo, setSubiendo] = useState(false)

  function analizar(t) {
    setTexto(t)
    setPrevia(t.trim() ? parsearCSV(t) : null)
  }

  async function leerArchivo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    analizar(await f.text())
    e.target.value = ''
  }

  function descargarPlantilla() {
    // BOM al frente: sin él, Excel en Windows abre las tildes como basura.
    const blob = new Blob(['﻿' + PLANTILLA_CSV], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'plantilla-inventario.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importar() {
    if (!previa?.filas.length) return
    setSubiendo(true)
    try {
      const r = await importarCatalogo(previa.filas)
      await showAlert(
        `${r.creados} insumos nuevos, ${r.actualizados} actualizados, ${r.con_saldo} con saldo inicial.` +
        (r.errores?.length ? `\n\nOmitidos:\n${r.errores.join('\n')}` : ''),
        { title: 'Catálogo importado' })
      setTexto(''); setPrevia(null)
      await onImportado()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo importar' })
    } finally { setSubiendo(false) }
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-4">
        <div>
          <p className="text-[14px] font-semibold text-gray-900">Carga inicial del catálogo</p>
          <p className="text-[12px] text-gray-500 mt-1 max-w-2xl">
            Sube el listado con el saldo real de un conteo. El saldo entra como <strong>ajuste
            de entrada</strong>, no como compra: no se compró hoy, es lo que había el día que se
            contó. Reimportar el mismo archivo actualiza los datos del insumo pero{' '}
            <strong>no vuelve a sumar existencias</strong>.
          </p>
        </div>

        <div className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2 font-mono overflow-x-auto">
          {COLUMNAS_CSV.join(' · ')}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Elegir archivo
          </Button>
          <Button size="sm" variant="ghost" onClick={descargarPlantilla}>
            <FileDown size={14} /> Descargar plantilla
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={leerArchivo} className="hidden" />
        </div>

        <div>
          <label className={LABEL}>…o pega el contenido aquí</label>
          <Textarea rows={6} value={texto} onChange={e => analizar(e.target.value)}
            placeholder={'nombre,codigo,categoria,unidad_base,stock_inicial,costo_unitario,stock_minimo,proveedor'}
            className="font-mono text-[12px]" />
        </div>
      </CardContent></Card>

      {previa && (
        <Card><CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] font-semibold text-gray-900">
              {previa.filas.length} fila{previa.filas.length !== 1 ? 's' : ''} lista
              {previa.filas.length !== 1 ? 's' : ''} para importar
            </p>
            <Button size="sm" onClick={importar} disabled={subiendo || !previa.filas.length}>
              {subiendo ? 'Importando…' : 'Importar catálogo'}
            </Button>
          </div>

          {previa.errores.length > 0 && (
            <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
              {previa.errores.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {previa.filas.length > 0 && (
            <TableWrap><Table>
              <thead><tr>
                <Th>Nombre</Th><Th>Código</Th><Th>Categoría</Th><Th>Unidad</Th>
                <Th className="text-right">Saldo</Th><Th className="text-right">Costo</Th>
                <Th className="text-right">Mínimo</Th><Th>Proveedor</Th>
              </tr></thead>
              <tbody>
                {previa.filas.slice(0, 25).map((f, i) => (
                  <Tr key={i}>
                    <Td className="font-semibold text-gray-900">{f.nombre}</Td>
                    <Td className="text-[12px] font-mono text-gray-500">{f.codigo || '—'}</Td>
                    <Td className="text-[12px] text-gray-500">{f.categoria || '—'}</Td>
                    <Td className="text-[12px] text-gray-500">{f.unidad_base || 'unidad'}</Td>
                    <Td className="text-right tabular-nums">{cant(f.stock_inicial)}</Td>
                    <Td className="text-right tabular-nums text-[12px]">{fmt(f.costo_unitario)}</Td>
                    <Td className="text-right tabular-nums text-[12px]">{cant(f.stock_minimo)}</Td>
                    <Td className="text-[12px] text-gray-500">{f.proveedor || '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table></TableWrap>
          )}
          {previa.filas.length > 25 && (
            <p className="text-[11px] text-gray-400">Se muestran las primeras 25; se importan todas.</p>
          )}
        </CardContent></Card>
      )}
    </div>
  )
}

// ─── Modal: insumo ───────────────────────────────────────────────────────────
function ModalInsumo({ insumo, onClose, onGuardado }) {
  const [proveedores, setProveedores] = useState([])
  const [form, setForm] = useState(() => insumo ? {
    codigo: insumo.codigo || '', nombre: insumo.nombre || '',
    categoria: insumo.categoria || '', tipo: insumo.tipo || 'INSUMO',
    unidad_base: insumo.unidad_base || 'unidad',
    stock_minimo: insumo.stock_minimo ?? 0, stock_objetivo: insumo.stock_objetivo ?? '',
    proveedor_id: insumo.proveedor_id || '', dias_reposicion: insumo.dias_reposicion ?? '',
    perecedero: !!insumo.perecedero, notas: insumo.notas || '', activo: insumo.activo !== false,
  } : {
    codigo: '', nombre: '', categoria: '', tipo: 'INSUMO', unidad_base: 'unidad',
    stock_minimo: 0, stock_objetivo: '', proveedor_id: '', dias_reposicion: '',
    perecedero: false, notas: '', activo: true,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { listarProveedores().then(setProveedores).catch(() => {}) }, [])

  async function guardar() {
    if (!form.nombre?.trim()) return setError('El nombre es requerido.')
    setGuardando(true); setError('')
    try {
      await guardarInsumo(insumo?.id, form)
      await onGuardado()
    } catch (e) { setError(parsearErrorDB(e)) }
    finally { setGuardando(false) }
  }

  return (
    <Modal open onClose={onClose} title={insumo ? insumo.nombre : 'Nuevo insumo'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        {insumo && (
          <div className="text-[12px] text-gray-600 bg-gray-50 rounded-lg px-3 py-2 flex flex-wrap gap-x-5 gap-y-1">
            <span>Saldo: <strong className="tabular-nums">{cant(insumo.stock_actual)} {insumo.unidad_base}</strong></span>
            <span>Costo promedio: <strong>{fmt(insumo.costo_promedio)}</strong></span>
            <span className="text-gray-400">Se mueven con movimientos, no desde aquí.</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={LABEL}>Nombre *</label>
            <Input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} /></div>
          <div><label className={LABEL}>Código</label>
            <Input value={form.codigo} onChange={e => setForm(p => ({ ...p, codigo: e.target.value.toUpperCase() }))}
                   placeholder="MAD-2025" /></div>
          <div><label className={LABEL}>Categoría</label>
            <Input value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value.toUpperCase() }))}
                   placeholder="MADERA" /></div>
          <div>
            <label className={LABEL}>Unidad de consumo</label>
            <Select value={form.unidad_base} onChange={e => setForm(p => ({ ...p, unidad_base: e.target.value }))}>
              {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </Select>
            <p className="text-[11px] text-gray-400 mt-1">En la que se gasta, no en la que se compra.</p>
          </div>
          <div>
            <label className={LABEL}>Tipo</label>
            <Select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}>
              <option value="INSUMO">Insumo</option>
              <option value="MATERIA_PRIMA">Materia prima</option>
              <option value="SERVICIO_EXTERNO">Servicio externo</option>
            </Select>
          </div>
          <div><label className={LABEL}>Stock mínimo</label>
            <Input type="number" min="0" step="any" value={form.stock_minimo}
                   onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))} />
            <p className="text-[11px] text-gray-400 mt-1">Piso manual para consumo irregular.</p></div>
          <div><label className={LABEL}>Stock objetivo</label>
            <Input type="number" min="0" step="any" value={form.stock_objetivo}
                   onChange={e => setForm(p => ({ ...p, stock_objetivo: e.target.value }))} />
            <p className="text-[11px] text-gray-400 mt-1">Hasta dónde reponer al comprar.</p></div>
          <div>
            <label className={LABEL}>Proveedor</label>
            <Select value={form.proveedor_id} onChange={e => setForm(p => ({ ...p, proveedor_id: e.target.value }))}>
              <option value="">— Sin proveedor —</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Select>
          </div>
          <div><label className={LABEL}>Días de reposición</label>
            <Input type="number" min="0" value={form.dias_reposicion}
                   onChange={e => setForm(p => ({ ...p, dias_reposicion: e.target.value }))}
                   placeholder="usa los del proveedor" /></div>
        </div>

        <div><label className={LABEL}>Notas</label>
          <Textarea rows={2} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} /></div>

        <div className="flex gap-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.perecedero}
                   onChange={e => setForm(p => ({ ...p, perecedero: e.target.checked }))}
                   className="w-4 h-4 accent-[#1A5CD8]" />
            <span className="text-[13px] font-semibold text-gray-700">Perecedero</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.activo}
                   onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))}
                   className="w-4 h-4 accent-[#1A5CD8]" />
            <span className="text-[13px] font-semibold text-gray-700">Activo</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: movimiento ───────────────────────────────────────────────────────
function ModalMovimiento({ insumo, tipoInicial, esProductor, onClose, onListo }) {
  // El PRODUCTOR solo puede reportar merma; el backend lo vuelve a validar.
  const tipos = esProductor
    ? TIPOS_MOVIMIENTO.filter(t => t.valor === 'SALIDA_MERMA')
    : TIPOS_MOVIMIENTO

  const [tipo, setTipo]       = useState(tipos.some(t => t.valor === tipoInicial) ? tipoInicial : tipos[0].valor)
  const [cantidad, setCant]   = useState('')
  const [costo, setCosto]     = useState('')
  const [motivo, setMotivo]   = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError]     = useState('')

  const def   = TIPOS_MOVIMIENTO.find(t => t.valor === tipo)
  const entra = def?.signo === '+'
  const nuevoSaldo = Number(insumo.stock_actual) + (entra ? 1 : -1) * (Number(cantidad) || 0)

  async function guardar() {
    const n = Number(cantidad)
    if (!(n > 0)) return setError('La cantidad debe ser mayor que cero.')
    if (def?.costo && !(Number(costo) > 0)) {
      return setError('Una compra necesita el costo unitario. Si fue donación o traslado, usa "Ajuste de entrada".')
    }
    setGuardando(true); setError('')
    try {
      await registrarMovimiento({
        insumo_id: insumo.id, tipo, cantidad: n,
        costo_unitario: Number(costo) || 0,
        motivo: motivo.trim() || null,
      })
      await onListo()
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Movimiento — ${insumo.nombre}`} maxWidth="max-w-lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={guardando}>{guardando ? 'Registrando…' : 'Registrar'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        <div>
          <label className={LABEL}>Tipo</label>
          <Select value={tipo} onChange={e => { setTipo(e.target.value); setError('') }}>
            {tipos.map(t => <option key={t.valor} value={t.valor}>{t.signo} {t.label}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Cantidad ({insumo.unidad_base})</label>
            <Input type="number" min="0" step="any" value={cantidad} autoFocus
                   onChange={e => setCant(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">Siempre en positivo.</p>
          </div>
          {def?.costo && (
            <div>
              <label className={LABEL}>Costo por {insumo.unidad_base}</label>
              <Input type="number" min="0" step="any" value={costo} onChange={e => setCosto(e.target.value)} />
              <p className="text-[11px] text-gray-400 mt-1">Recalcula el promedio.</p>
            </div>
          )}
        </div>

        <div><label className={LABEL}>Motivo</label>
          <Input value={motivo} onChange={e => setMotivo(e.target.value)}
                 placeholder={entra ? 'Factura 1042 — Maderas del Norte' : 'Se rompieron 2 láminas al cortar'} /></div>

        <div className="text-[12px] text-gray-600 bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>Saldo actual: <strong className="tabular-nums">{cant(insumo.stock_actual)}</strong></span>
          <span>→</span>
          <span>Queda: <strong className={`tabular-nums ${nuevoSaldo < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {cant(nuevoSaldo)}</strong></span>
        </div>

        {nuevoSaldo < 0 && (
          <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            El saldo queda en negativo. Se registra igual —el inventario nunca frena la operación—
            pero significa que falta registrar alguna entrada.
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Modal: kardex de un insumo ──────────────────────────────────────────────
function ModalKardex({ insumo, onClose }) {
  const [movs, setMovs] = useState(null)

  useEffect(() => {
    cargarMovimientos({ insumoId: insumo.id, limit: 200 })
      .then(r => setMovs(r.movimientos))
      .catch(() => setMovs([]))
  }, [insumo.id])

  return (
    <Modal open onClose={onClose} title={`Kardex — ${insumo.nombre}`} maxWidth="max-w-3xl">
      {movs === null ? (
        <div className="py-10 text-center text-gray-400 text-sm">Cargando…</div>
      ) : movs.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-sm">Sin movimientos todavía.</div>
      ) : (
        <TableWrap><Table>
          <thead><tr>
            <Th>Fecha</Th><Th>Tipo</Th>
            <Th className="text-right">Cantidad</Th>
            <Th className="text-right">Costo unit.</Th>
            <Th>Motivo</Th>
          </tr></thead>
          <tbody>
            {movs.map(m => {
              const entra = Number(m.cantidad) > 0
              return (
                <Tr key={m.id} className={m.revertido_en ? 'opacity-45 line-through' : ''}>
                  <Td className="text-[12px] text-gray-500 whitespace-nowrap">{fmtDateTime(m.created_at)}</Td>
                  <Td className="text-[12px]">{LABEL_TIPO[m.tipo] || m.tipo}</Td>
                  <Td className={`text-right tabular-nums font-semibold ${entra ? 'text-emerald-700' : 'text-gray-800'}`}>
                    {entra ? '+' : ''}{cant(m.cantidad)}
                  </Td>
                  <Td className="text-right tabular-nums text-[12px] text-gray-600">{fmt(m.costo_unitario)}</Td>
                  <Td className="text-[12px] text-gray-500">{m.motivo || '—'}</Td>
                </Tr>
              )
            })}
          </tbody>
        </Table></TableWrap>
      )}
    </Modal>
  )
}
