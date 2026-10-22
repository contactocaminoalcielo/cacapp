// Configuración › Recordatorios — panel del catálogo público (migr. 200).
// El enlace para compartir, si recibe pedidos, el valor fijo del envío y los
// datos de pago que ve el cliente al final. Vive en config_operativa
// (modulo CATALOGO_PUBLICO); qué productos salen y a qué precio se decide en
// cada producto («Mostrar en catálogo público» + «Precio público»).
import { useEffect, useState } from 'react'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Check, ExternalLink, ShoppingBag } from 'lucide-react'

export const URL_CATALOGO = 'https://orbit.orbitacac.com/#/catalogo'

export default function CatalogoPublicoPanel({ productosEnCatalogo = 0 }) {
  const [cfg, setCfg]         = useState(null)
  const [form, setForm]       = useState({ activo: true, valor_envio: '', datos_pago: '' })
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg]         = useState('')
  const [copiado, setCopiado] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const { data, error } = await db.from('config_operativa').select('clave, valor').eq('modulo', 'CATALOGO_PUBLICO')
    if (error || !data?.length) { setCfg(false); return }
    const c = Object.fromEntries(data.map(r => [r.clave, r.valor]))
    setCfg(c)
    setForm({ activo: c.activo !== false, valor_envio: String(c.valor_envio ?? 0), datos_pago: typeof c.datos_pago === 'string' ? c.datos_pago : '' })
  }

  async function guardar() {
    setGuardando(true); setMsg('')
    const valores = {
      activo:      form.activo,
      valor_envio: Math.max(0, Math.round(Number(String(form.valor_envio).replace(/\D/g, '')) || 0)),
      datos_pago:  form.datos_pago.trim(),
    }
    const res = await Promise.all(Object.entries(valores).map(([clave, valor]) =>
      db.from('config_operativa').update({ valor, updated_at: new Date().toISOString() })
        .eq('modulo', 'CATALOGO_PUBLICO').eq('clave', clave)))
    setGuardando(false)
    const err = res.find(r => r.error)?.error
    setMsg(err ? 'No se pudo guardar: ' + err.message : 'Guardado.')
    if (!err) cargar()
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(URL_CATALOGO); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sin portapapeles */ }
  }

  if (cfg === null) return null
  if (cfg === false) return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
      El catálogo público todavía no existe en la base de datos (falta aplicar la migración 200).
    </div>
  )

  return (
    <div className="mb-5 rounded-xl border p-4 space-y-3" style={{ borderColor: '#C5DEC9', background: '#F6FBF7' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <ShoppingBag size={15} className="text-green-700" />
        <span className="text-[13px] font-bold text-gray-900">Catálogo público</span>
        <span className="text-[11px] text-gray-500">— clientes sin servicio funerario compran recordatorios solos</span>
        <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full ${productosEnCatalogo ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
          {productosEnCatalogo} producto{productosEnCatalogo === 1 ? '' : 's'} en el catálogo
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-[12px] bg-white border rounded-lg px-2.5 py-1.5 text-gray-700">{URL_CATALOGO}</code>
        <Button size="sm" variant="secondary" onClick={copiar}>{copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar enlace</>}</Button>
        <a href={URL_CATALOGO} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-green-700 flex items-center gap-1 hover:underline">
          <ExternalLink size={12} /> Ver como cliente
        </a>
      </div>
      {!productosEnCatalogo && (
        <p className="text-[11.5px] text-amber-700">Ningún producto está en el catálogo: abre cada recordatorio que quieras vender y marca «Mostrar en catálogo público».</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2 cursor-pointer sm:pt-6">
          <input type="checkbox" checked={form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" />
          <span className="text-[13px] font-semibold text-gray-700">Recibe pedidos</span>
        </label>
        <div>
          <label className="block text-[12px] font-semibold text-gray-600 mb-1">Valor del envío (fijo)</label>
          <Input inputMode="numeric" value={form.valor_envio} onChange={e => setForm(f => ({ ...f, valor_envio: e.target.value.replace(/\D/g, '') }))} />
          <p className="text-[11px] text-gray-400 mt-1">{fmt(Number(form.valor_envio) || 0)} · solo si el pedido trae algo físico</p>
        </div>
        <div className="sm:col-span-3">
          <label className="block text-[12px] font-semibold text-gray-600 mb-1">Datos para el pago (los ve el cliente al final)</label>
          <Textarea rows={3} value={form.datos_pago} onChange={e => setForm(f => ({ ...f, datos_pago: e.target.value }))}
            placeholder={'Nequi 300 000 0000 a nombre de …\nBancolombia ahorros 000-000000-00 …'} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar catálogo'}</Button>
        {msg && <span className={`text-[12px] ${msg.startsWith('No') ? 'text-red-600' : 'text-green-700'}`}>{msg}</span>}
      </div>
    </div>
  )
}
