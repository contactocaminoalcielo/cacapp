// Ventas posteriores › Configuración — lo que coordinación puede ajustar de la
// OFERTA POSTERIOR sin desplegar nada (config_operativa, módulo OFERTA_POSTERIOR,
// migr. 210): descuentos, tiempos, a quién no se le ofrece, y el contenido
// visual de los planes pre-exequiales en el portal.
//
// Qué NO se configura aquí, a propósito (cada cosa tiene un solo dueño):
//   · Encender/apagar el envío → /automatizaciones.
//   · Qué productos se ofrecen, su precio y su foto → Configuración › Recordatorios
//     («Mostrar en catálogo público»). Las cédulas son los productos cuyo nombre
//     contiene «cédula».
//   · El precio de cada plan → Configuración › Afiliaciones.
import { useEffect, useState } from 'react'
import { db } from '@/lib/supabase'
import { subirImagenOferta } from '@/lib/ofertas'
import { fmt } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ImagePlus, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react'

const MOD = 'OFERTA_POSTERIOR'
const NIVELES = ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE']
const TIPOS = ['ANUAL', 'VITALICIO']
const NOMBRE_NIVEL = { BRONCE: 'Bronce', PLATA: 'Plata', ORO: 'Oro', DIAMANTE: 'Diamante' }
const NOMBRE_TIPO = { ANUAL: 'Anual', VITALICIO: 'Vitalicio' }
const LABEL = 'block text-[12px] font-semibold text-gray-600 mb-1'
const ES_CEDULA = /c[eé]dula/i

const NUMEROS = [
  { clave: 'descuento_recordatorios', label: 'Descuento en recordatorios (%)', min: 0, max: 90, grupo: 'descuentos' },
  { clave: 'descuento_cedulas',       label: 'Descuento en cédulas (%)',       min: 0, max: 90, grupo: 'descuentos' },
  { clave: 'descuento_preexequiales', label: 'Descuento en planes pre-exequiales (%)', min: 0, max: 90, grupo: 'descuentos',
    ayuda: 'Solo afiliaciones nuevas. No se suma a los otros descuentos de afiliación.' },
  { clave: 'dias_desde_fallecimiento', label: 'Días desde el fallecimiento', min: 7, max: 365, grupo: 'tiempos' },
  { clave: 'dias_tras_condolencia',    label: 'Días después de las condolencias', min: 0, max: 180, grupo: 'tiempos' },
  { clave: 'dias_tras_entrega',        label: 'Días después de la entrega', min: 0, max: 90, grupo: 'tiempos' },
  { clave: 'dias_vigencia',            label: 'Días que dura la oferta', min: 1, max: 365, grupo: 'tiempos',
    ayuda: 'Desde el envío. Después el portal cierra.' },
  { clave: 'dias_entre_ofertas',       label: 'Días entre dos ofertas a la misma familia', min: 0, max: 3650, grupo: 'tiempos',
    ayuda: 'Si fallecen dos mascoticas, la familia recibe una sola oferta.' },
]

const lista = (v, validos) => (Array.isArray(v) ? v : validos).filter(x => validos.includes(x))

export default function ConfigOferta() {
  const [cfg, setCfg]   = useState(null)    // null = cargando · false = falta la migración
  const [form, setForm] = useState(null)
  const [estado, setEstado] = useState(null)   // productos y precios, para avisar lo que falta
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg]   = useState('')
  const [subiendo, setSubiendo] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    let data, recs, afil
    try {
      const r = await Promise.all([
        db.from('config_operativa').select('clave, valor').eq('modulo', MOD),
        db.from('recordatorios').select('nombre, foto_url, venta_publica, activo').eq('venta_publica', true),
        db.from('config_operativa').select('valor').eq('modulo', 'AFILIACIONES').eq('clave', 'precios').maybeSingle(),
      ])
      if (r[0].error) throw r[0].error
      data = r[0].data; recs = r[1].data; afil = r[2].data
    } catch (e) {
      // Sin esto, un corte de red dejaba la pestaña en «Cargando…» para siempre.
      setCfg('error'); setMsg(e?.message || 'sin conexión')
      return
    }
    if (!data?.length) { setCfg(false); return }
    const c = Object.fromEntries(data.map(r => [r.clave, r.valor]))
    setCfg(c)
    const info = (c.planes_info && typeof c.planes_info === 'object') ? c.planes_info : {}
    setForm({
      ...Object.fromEntries(NUMEROS.map(n => [n.clave, String(c[n.clave] ?? '')])),
      excluir_calificacion_mala: c.excluir_calificacion_mala !== false,
      excluir_con_queja: c.excluir_con_queja !== false,
      niveles: lista(c.niveles_ofrecidos, NIVELES),
      tipos: lista(c.tipos_ofrecidos, TIPOS),
      datos_pago: typeof c.datos_pago === 'string' ? c.datos_pago : '',
      planes: Object.fromEntries(NIVELES.map(n => [n, {
        descripcion: info[n]?.descripcion || '',
        beneficios: (Array.isArray(info[n]?.beneficios) ? info[n].beneficios : []).join('\n'),
        imagen_url: info[n]?.imagen_url || '',
      }])),
    })
    const vivos = (recs || []).filter(r => r.activo !== false)
    setEstado({
      recordatorios: vivos.filter(r => !ES_CEDULA.test(r.nombre)),
      cedulas: vivos.filter(r => ES_CEDULA.test(r.nombre)),
      precios: afil?.valor || {},
    })
  }

  const set = (clave, valor) => setForm(f => ({ ...f, [clave]: valor }))
  const setPlan = (nivel, campo, valor) =>
    setForm(f => ({ ...f, planes: { ...f.planes, [nivel]: { ...f.planes[nivel], [campo]: valor } } }))
  const alternar = (clave, valor) =>
    setForm(f => ({ ...f, [clave]: f[clave].includes(valor) ? f[clave].filter(x => x !== valor) : [...f[clave], valor] }))

  async function subirImagen(nivel, file) {
    if (!file) return
    setSubiendo(nivel); setMsg('')
    try { setPlan(nivel, 'imagen_url', await subirImagenOferta(file)) }
    catch (e) { setMsg('No se pudo subir la imagen: ' + e.message) }
    finally { setSubiendo('') }
  }

  async function guardar() {
    setGuardando(true); setMsg('')
    const acotar = n => {
      const x = parseInt(form[n.clave])
      return Math.min(Math.max(Number.isFinite(x) ? x : n.min, n.min), n.max)
    }
    const valores = {
      ...Object.fromEntries(NUMEROS.map(n => [n.clave, acotar(n)])),
      excluir_calificacion_mala: form.excluir_calificacion_mala,
      excluir_con_queja: form.excluir_con_queja,
      // En el orden de siempre, no en el que se fueron marcando.
      niveles_ofrecidos: NIVELES.filter(n => form.niveles.includes(n)),
      tipos_ofrecidos: TIPOS.filter(t => form.tipos.includes(t)),
      datos_pago: form.datos_pago.trim(),
      planes_info: Object.fromEntries(NIVELES.map(n => [n, {
        descripcion: form.planes[n].descripcion.trim(),
        beneficios: form.planes[n].beneficios.split('\n').map(b => b.trim()).filter(Boolean),
        imagen_url: form.planes[n].imagen_url || '',
      }])),
    }
    const res = await Promise.all(Object.entries(valores).map(([clave, valor]) =>
      db.from('config_operativa').update({ valor, updated_at: new Date().toISOString() })
        .eq('modulo', MOD).eq('clave', clave)))
    setGuardando(false)
    const err = res.find(r => r.error)?.error
    setMsg(err ? 'No se pudo guardar: ' + err.message : 'Guardado.')
    if (!err) cargar()
  }

  if (cfg === null) return (
    <div className="flex items-center justify-center h-24 gap-3"><div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span></div>
  )
  if (cfg === 'error') return (
    <div className="rounded-xl border-2 p-4 text-[13px] flex flex-wrap items-center gap-3" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>
      <span className="flex-1">No se pudo cargar la configuración ({msg}).</span>
      <Button size="sm" variant="secondary" onClick={() => { setCfg(null); setMsg(''); cargar() }}>Reintentar</Button>
    </div>
  )
  if (cfg === false) return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
      La oferta posterior todavía no existe en la base de datos (falta aplicar la migración 210).
    </div>
  )

  const precio = (tipo, nivel) => Number(estado?.precios?.[tipo]?.[nivel]) || 0
  const planesConPrecio = NIVELES.flatMap(n => TIPOS.map(t => [n, t]))
    .filter(([n, t]) => form.niveles.includes(n) && form.tipos.includes(t) && precio(t, n) > 0)
  const sinFoto = [...(estado?.recordatorios || []), ...(estado?.cedulas || [])].filter(r => !r.foto_url)
  const Linea = ({ ok, children }) => (
    <li className={`flex items-start gap-2 text-[12.5px] ${ok ? 'text-gray-600' : 'text-amber-800'}`}>
      {ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-green-700" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
      <span>{children}</span>
    </li>
  )

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Qué va a ver la familia hoy: lo que falta para que la oferta no salga vacía */}
      <section className="rounded-xl border bg-white p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="text-[13px] font-semibold text-gray-800 mb-2">Qué verá la familia en el portal</div>
        <ul className="space-y-1.5">
          <Linea ok={estado?.recordatorios.length > 0}>
            <strong>{estado?.recordatorios.length || 0}</strong> recordatorio(s) a la venta.
            {!estado?.recordatorios.length && ' Marca «Mostrar en catálogo público» en Configuración › Recordatorios.'}
            {' '}A cada familia solo se le muestran los que NO venían en su servicio.
          </Linea>
          <Linea ok={estado?.cedulas.length > 0}>
            <strong>{estado?.cedulas.length || 0}</strong> cédula(s) a la venta.
            {!estado?.cedulas.length && ' Marca «Mostrar en catálogo público» en la cédula (Configuración › Recordatorios) y ponle precio.'}
          </Linea>
          <Linea ok={planesConPrecio.length > 0}>
            <strong>{planesConPrecio.length}</strong> plan(es) pre-exequial(es) con precio.
            {!planesConPrecio.length && ' Pon los precios en Configuración › Afiliaciones: un plan sin precio no se ofrece.'}
          </Linea>
          <Linea ok={sinFoto.length === 0}>
            {sinFoto.length === 0
              ? 'Todos los productos tienen foto.'
              : <>Sin foto: <strong>{sinFoto.map(r => r.nombre).join(', ')}</strong>. La familia no debería decidir solo leyendo texto.</>}
          </Linea>
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="text-[13px] font-semibold text-gray-800">Descuentos</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {NUMEROS.filter(n => n.grupo === 'descuentos').map(n => (
            <div key={n.clave}>
              <label htmlFor={`co-${n.clave}`} className={LABEL}>{n.label}</label>
              <Input id={`co-${n.clave}`} inputMode="numeric" value={form[n.clave]} onChange={e => set(n.clave, e.target.value.replace(/\D/g, ''))} />
              <p className="text-[11px] text-gray-400 mt-1">{n.ayuda || '0 = sin descuento'}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="text-[13px] font-semibold text-gray-800">Cuándo sale y cuánto dura</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {NUMEROS.filter(n => n.grupo === 'tiempos').map(n => (
            <div key={n.clave}>
              <label htmlFor={`co-${n.clave}`} className={LABEL}>{n.label}</label>
              <Input id={`co-${n.clave}`} inputMode="numeric" value={form[n.clave]} onChange={e => set(n.clave, e.target.value.replace(/\D/g, ''))} />
              {n.ayuda && <p className="text-[11px] text-gray-400 mt-1">{n.ayuda}</p>}
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-gray-500">
          La oferta sale en la fecha más tardía de las tres primeras. Cambiar estos días solo afecta a las ofertas que se programen de aquí en adelante.
        </p>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="text-[13px] font-semibold text-gray-800">A quién no se le ofrece</div>
        <label className="flex items-center gap-2 cursor-pointer text-[13px] text-gray-700">
          <input type="checkbox" checked={form.excluir_calificacion_mala} onChange={e => set('excluir_calificacion_mala', e.target.checked)} className="w-4 h-4 accent-[#1A5CD8]" />
          A quien calificó <strong>Malo</strong> en la encuesta post-entrega
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-[13px] text-gray-700">
          <input type="checkbox" checked={form.excluir_con_queja} onChange={e => set('excluir_con_queja', e.target.checked)} className="w-4 h-4 accent-[#1A5CD8]" />
          A quien tiene una <strong>queja o reclamo</strong> registrado en ese servicio
        </label>
        <p className="text-[11.5px] text-gray-500">
          Siempre se excluye a quien pidió no recibir información, al plan Desamparado, a quien no tiene WhatsApp y a quien coordinación le excluyó la condolencia.
        </p>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div>
          <div className="text-[13px] font-semibold text-gray-800">Planes pre-exequiales en el portal</div>
          <p className="text-[11.5px] text-gray-500 mt-0.5">
            El precio sale de Configuración › Afiliaciones y las condiciones, del contrato. Aquí va lo que hace que la familia lo vea y lo entienda:
            una imagen, una descripción corta y los beneficios (uno por línea).
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <div className={LABEL}>Niveles que se ofrecen</div>
            <div className="flex flex-wrap gap-3">
              {NIVELES.map(n => (
                <label key={n} className="flex items-center gap-1.5 cursor-pointer text-[13px] text-gray-700">
                  <input type="checkbox" checked={form.niveles.includes(n)} onChange={() => alternar('niveles', n)} className="w-4 h-4 accent-[#1A5CD8]" />
                  {NOMBRE_NIVEL[n]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className={LABEL}>Tipos</div>
            <div className="flex flex-wrap gap-3">
              {TIPOS.map(t => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer text-[13px] text-gray-700">
                  <input type="checkbox" checked={form.tipos.includes(t)} onChange={() => alternar('tipos', t)} className="w-4 h-4 accent-[#1A5CD8]" />
                  {NOMBRE_TIPO[t]}
                </label>
              ))}
            </div>
          </div>
        </div>

        {NIVELES.filter(n => form.niveles.includes(n)).map(n => {
          const p = form.planes[n]
          const precios = TIPOS.filter(t => form.tipos.includes(t)).map(t => [t, precio(t, n)])
          return (
            <div key={n} className="rounded-lg border p-3 space-y-3" style={{ borderColor: '#E5E7EB' }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[13px] font-bold text-gray-900">Plan {NOMBRE_NIVEL[n]}</span>
                {precios.map(([t, v]) => (
                  <span key={t} className={`text-[11.5px] ${v > 0 ? 'text-gray-500' : 'text-amber-700 font-semibold'}`}>
                    {NOMBRE_TIPO[t]}: {v > 0 ? fmt(v) : 'sin precio — no se ofrece'}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
                <div>
                  <div className={LABEL}>Imagen</div>
                  {p.imagen_url ? (
                    <div className="relative">
                      <img src={p.imagen_url} alt={`Plan ${NOMBRE_NIVEL[n]}`} className="w-full aspect-[16/10] object-cover rounded-lg border" />
                      <button type="button" onClick={() => setPlan(n, 'imagen_url', '')} aria-label="Quitar la imagen"
                        className="absolute top-1 right-1 w-7 h-7 rounded-lg bg-white/90 border flex items-center justify-center text-red-700 hover:bg-white">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center gap-1 w-full aspect-[16/10] rounded-lg border-2 border-dashed text-[11.5px] text-gray-500 cursor-pointer hover:bg-gray-50">
                      <ImagePlus size={18} /> {subiendo === n ? 'Subiendo…' : 'Subir imagen'}
                      <input type="file" accept="image/*" className="sr-only" disabled={subiendo === n}
                        onChange={e => { subirImagen(n, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label htmlFor={`co-desc-${n}`} className={LABEL}>Descripción corta</label>
                    <Textarea id={`co-desc-${n}`} rows={2} maxLength={600} value={p.descripcion} onChange={e => setPlan(n, 'descripcion', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`co-ben-${n}`} className={LABEL}>Beneficios y coberturas (uno por línea, máximo 12)</label>
                    <Textarea id={`co-ben-${n}`} rows={4} value={p.beneficios} onChange={e => setPlan(n, 'beneficios', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <label htmlFor="co-pago" className="text-[13px] font-semibold text-gray-800 block">Datos para el pago</label>
        <Textarea id="co-pago" rows={3} value={form.datos_pago} onChange={e => set('datos_pago', e.target.value)}
          placeholder={'Nequi 300 000 0000 a nombre de …\nBancolombia ahorros 000-000000-00 …'} />
        <p className="text-[11.5px] text-gray-500">Los ve la familia al pagar. Si lo dejas vacío, se usan los del catálogo público.</p>
      </section>

      <div className="flex items-center gap-3 sticky bottom-0 bg-white/95 border-t -mx-4 md:-mx-6 px-4 md:px-6 py-3">
        <Button onClick={guardar} disabled={guardando || !!subiendo}>{guardando ? 'Guardando…' : 'Guardar configuración'}</Button>
        {msg && <span role="status" className={`text-[12.5px] ${msg.startsWith('No') ? 'text-red-600' : 'text-green-700'}`}>{msg}</span>}
      </div>
    </div>
  )
}
