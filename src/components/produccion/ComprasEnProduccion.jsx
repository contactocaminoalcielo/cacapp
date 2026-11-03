// Compras de recordatorios SIN servicio dentro del tablero de Producción.
//
// Las líneas de una compra (migración 168) no son `servicio_recordatorios`:
// viven en `compra_recordatorio_items` y no tienen servicio. Por eso:
//   · se cargan aparte (`cargarItemsCompras`) y se guardan en OTRO estado de
//     Produccion.jsx. `autoCorregirEstados` agrupa por servicio_id y hace
//     UPDATE a `servicios`: nunca debe recibir una de estas filas;
//   · `aItemsTablero` las disfraza de fila del tablero (mismas claves que leen
//     las vistas) con `__compra` para que cada vista las pinte en morado y el
//     clic abra SU modal;
//   · el modal ESCRIBE POR EL BACKEND (toda escritura de una compra pasa por
//     ahí), nunca directo a la tabla.
import { useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/contexts/ConfirmContext'
import { db, dbTodo } from '@/lib/supabase'
import { actualizarItem, ESTADOS_ITEM } from '@/lib/comprasRecordatorios'
import { ExternalLink } from 'lucide-react'

/** Color que distingue en el tablero lo que es una compra sin servicio. */
export const COMPRA_COLOR = { borde: '#A78BFA', fuerte: '#7C3AED', suave: '#F5F3FF', texto: '#5B21B6' }

/** Lo que el tablero necesita de cada línea, con su compra, mascota y cliente. */
export async function cargarItemsCompras() {
  return dbTodo(() => db.from('compra_recordatorio_items')
    .select(`id, compra_id, recordatorio_id, nombre, cantidad, estado, asignado_a, notas,
             imagenes_urls, datos_cliente, fecha_inicio_prod, fecha_fin_prod, created_at,
             recordatorios ( id, nombre, categoria, requiere_imagen, solo_nombre, recolecta_tecnico,
                             tiempo_produccion_dias, maquina_id ),
             compras_recordatorios!inner ( id, numero, created_at, anulada_en, origen,
               mascotas ( nombre, especies ( nombre ) ),
               clientes ( nombre, apellido, whatsapp ) )`)
    .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
    .is('compras_recordatorios.anulada_en', null)
    .order('created_at', { ascending: true })
    .order('id'))
}

const tieneFotos = ci => (ci.imagenes_urls || []).length > 0
const pideFotos  = ci => ci.recordatorios?.requiere_imagen && !ci.recordatorios?.solo_nombre

/**
 * Líneas de compra → filas con la forma de `servicio_recordatorios` que leen
 * las vistas. Las líneas de una misma compra comparten la «tarjeta»
 * (`servicio_id = compra:<id>`) y un `servicios` falso:
 *   · `planes.nombre` → «Compra CR-n» (lo que se ve donde iría el plan);
 *   · `estado = 'LISTO'` cuando todas sus líneas están listas, para que la
 *     tarjeta suba arriba y no se esconda con el filtro «Pendientes», igual
 *     que un servicio listo para entregar;
 *   · `fecha_imagenes_recibidas` es POR LÍNEA: en una compra las fotos se
 *     cargan por recordatorio, no una vez por servicio.
 */
export function aItemsTablero(items) {
  const porCompra = {}
  for (const ci of items) (porCompra[ci.compra_id] ||= []).push(ci)
  const out = []
  for (const lineas of Object.values(porCompra)) {
    const c = lineas[0].compras_recordatorios
    const listo = lineas.every(l => l.estado === 'LISTO')
    for (const ci of lineas) {
      out.push({
        ...ci,
        __compra: c,
        servicio_id: `compra:${ci.compra_id}`,
        maquina_id: null,
        imagenes_cliente_urls: ci.imagenes_urls || [],
        servicios: {
          id: null,
          estado: listo ? 'LISTO' : null,
          mascotas: c?.mascotas,
          planes: { nombre: `Compra CR-${c?.numero} · sin servicio funerario` },
          // Lo único que la tarjeta lee de aquí es «¿hay fotos?»: por línea.
          fecha_imagenes_recibidas: !pideFotos(ci) || tieneFotos(ci) ? ci.created_at : null,
        },
      })
    }
  }
  return out
}

/** Marca morada «CR-n» que acompaña a una línea de compra en cualquier vista. */
export function MarcaCompra({ compra, chica = false }) {
  if (!compra) return null
  return (
    <span title="Compra de recordatorio – cliente sin servicio funerario"
      className={`inline-flex items-center gap-0.5 rounded-full font-bold whitespace-nowrap ${chica ? 'text-[9px] px-1.5 py-px' : 'text-[10px] px-2 py-0.5'}`}
      style={{ background: COMPRA_COLOR.suave, color: COMPRA_COLOR.texto, border: `1px solid ${COMPRA_COLOR.borde}` }}>
      🛒 CR-{compra.numero}
    </span>
  )
}

export function ModalItemCompra({ item, personal, onClose, onSaved, onAbrirCompra }) {
  const { alert: showAlert } = useConfirm()
  const [estado, setEstado]     = useState(item.estado)
  const [asignado, setAsignado] = useState(item.asignado_a || '')
  const [notas, setNotas]       = useState(item.notas || '')
  const [saving, setSaving]     = useState(false)
  const c = item.compras_recordatorios
  const cli = c?.clientes

  async function guardar() {
    setSaving(true)
    try {
      await actualizarItem(item.compra_id, item.id, { estado, asignado_a: asignado || null, notas })
      onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`${item.nombre}${item.cantidad > 1 ? ` ×${item.cantidad}` : ''} · ${c?.mascotas?.nombre || ''}`}
      footer={<>
        {onAbrirCompra && (
          <Button variant="ghost" onClick={() => onAbrirCompra(item.compra_id)} disabled={saving} className="mr-auto">
            <ExternalLink size={13} /> Abrir la compra
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: COMPRA_COLOR.suave, border: `1px solid ${COMPRA_COLOR.borde}`, color: COMPRA_COLOR.texto }}>
          <strong>Compra CR-{c?.numero}</strong> · cliente sin servicio funerario
          {c?.origen === 'CATALOGO_WEB' && ' · pedido del catálogo web'}
          {cli && <span className="text-gray-500"> · {[cli.nombre, cli.apellido].filter(Boolean).join(' ')}{cli.whatsapp ? ` (${cli.whatsapp})` : ''}</span>}
        </div>
        {/* Las fotos del catálogo web ya son URLs públicas; las de una compra
            interna son rutas privadas y se ven en el detalle de la compra. */}
        {(item.imagenes_urls || []).some(u => /^https?:\/\//i.test(u)) && (
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Fotos del cliente</label>
            <div className="flex flex-wrap gap-2">
              {item.imagenes_urls.filter(u => /^https?:\/\//i.test(u)).map(u => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                  <img src={u} alt="" className="w-20 h-20 rounded-lg object-cover border" />
                </a>
              ))}
            </div>
          </div>
        )}
        {(item.imagenes_urls || []).length > 0 && !(item.imagenes_urls || []).some(u => /^https?:\/\//i.test(u)) && (
          <p className="text-[12px] text-gray-500">Tiene {item.imagenes_urls.length} foto{item.imagenes_urls.length !== 1 ? 's' : ''}: se ven en el detalle de la compra.</p>
        )}
        {pideFotos(item) && !tieneFotos(item) && (
          <p className="text-[12px] font-semibold text-amber-700">Todavía no tiene foto: se adjunta en el detalle de la compra.</p>
        )}
        {item.datos_cliente && Object.keys(item.datos_cliente).length > 0 && (
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Textos del cliente</label>
            <div className="space-y-1 text-[12px] text-gray-700">
              {Object.entries(item.datos_cliente).map(([k, v]) => (
                <div key={k}><span className="text-gray-400">{k}:</span> {(Array.isArray(v) ? v : [v]).join(' · ')}</div>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Estado</label>
          <div className="flex gap-1.5 flex-wrap">
            {ESTADOS_ITEM.filter(e => e.valor !== 'ENTREGADO').map(e => (
              <button key={e.valor} onClick={() => setEstado(e.valor)}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold"
                style={e.valor === estado
                  ? { background: e.bg, color: e.text, border: `1.5px solid ${e.border}` }
                  : { background: '#fff', color: '#9CA3AF', border: '1.5px solid #E5E7EB' }}>
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">La entrega se marca desde la compra, no desde aquí.</p>
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Asignado a</label>
          <Select value={asignado} onChange={e => setAsignado(e.target.value)}>
            <option value="">Sin asignar</option>
            {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido || ''}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Notas de producción</label>
          <Textarea rows={3} value={notas} onChange={e => setNotas(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
