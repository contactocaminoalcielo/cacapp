import { useEffect, useMemo, useState } from 'react'
import { Bot, Brain, Check, ChevronLeft, ChevronRight, Loader2, ShieldCheck } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORIAS_AGENTE, EFFORT_OPCIONES, cargarMotores, crearAgente } from '@/lib/agenteApi'

const INICIAL = {
  clave: '', nombre: '', etiqueta_menu: '', categoria: 'GENERAL', objetivo: '', idioma: 'es',
  proveedor: '', modelo: '', effort: 'medium', memoria_mensajes: 20,
  instrucciones: 'Responde solo con la información autorizada en tu base de conocimiento. Si no sabes algo, dilo con claridad y ofrece escalarlo a una persona.',
}

export default function CrearAgenteModal({ open, onClose, onCreated }) {
  const [paso, setPaso] = useState(0)
  const [datos, setDatos] = useState(INICIAL)
  const [motores, setMotores] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setPaso(0); setDatos(INICIAL); setError(null); setCargando(true)
    cargarMotores()
      .then(r => {
        const disponibles = (r.motores || []).filter(m => m.activo)
        const estados = r.proveedores || []
        setMotores(disponibles); setProveedores(estados)
        const listo = estados.find(p => p.listo && disponibles.some(m => m.proveedor === p.proveedor))
        const primero = disponibles.find(m => m.proveedor === listo?.proveedor)
        if (primero) setDatos(d => ({ ...d, proveedor: primero.proveedor, modelo: primero.modelo }))
      })
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [open])

  const modelos = useMemo(
    () => motores.filter(m => m.proveedor === datos.proveedor),
    [motores, datos.proveedor]
  )
  const estadoProveedor = proveedores.find(p => p.proveedor === datos.proveedor)

  function set(campo, valor) {
    setDatos(d => ({ ...d, [campo]: valor }))
    setError(null)
  }

  function validar(actual = paso) {
    if (actual === 0) {
      if (!/^[A-Z][A-Z0-9_]{2,29}$/.test(datos.clave)) return 'La clave debe tener de 3 a 30 caracteres: mayúsculas, números o guion bajo.'
      if (!datos.nombre.trim()) return 'Escribe un nombre para reconocer el agente.'
      if (!datos.objetivo.trim()) return 'Define qué resultado debe conseguir este agente.'
    }
    if (actual === 1) {
      if (!datos.proveedor || !datos.modelo) return 'Elige el proveedor y el modelo.'
      if (estadoProveedor && !estadoProveedor.listo) return estadoProveedor.motivo || 'Ese proveedor no está configurado en el servidor.'
    }
    if (actual === 2 && !datos.instrucciones.trim()) return 'El agente necesita instrucciones de comportamiento.'
    return null
  }

  function siguiente() {
    const e = validar()
    if (e) return setError(e)
    setPaso(p => Math.min(3, p + 1)); setError(null)
  }

  async function crear() {
    for (let p = 0; p < 3; p++) {
      const e = validar(p)
      if (e) { setPaso(p); setError(e); return }
    }
    setGuardando(true); setError(null)
    try {
      const r = await crearAgente({
        ...datos,
        nombre: datos.nombre.trim(), objetivo: datos.objetivo.trim(),
        etiqueta_menu: datos.etiqueta_menu.trim() || datos.nombre.trim(),
        instrucciones: datos.instrucciones.trim(),
        memoria_mensajes: Number(datos.memoria_mensajes),
      })
      onCreated?.(r.agente)
    } catch (e) {
      setError(e.message)
    } finally { setGuardando(false) }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={paso ? () => setPaso(p => p - 1) : onClose} disabled={guardando}>
        {paso > 0 && <ChevronLeft size={15} />}{paso ? 'Atrás' : 'Cancelar'}
      </Button>
      {paso < 3 ? (
        <Button onClick={siguiente} disabled={cargando || guardando}>
          Continuar <ChevronRight size={15} />
        </Button>
      ) : (
        <Button onClick={crear} disabled={guardando || cargando}>
          {guardando ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
          Crear apagado
        </Button>
      )}
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title="Agregar agente" footer={footer} maxWidth="max-w-3xl">
      <div className="space-y-5">
        <ol className="grid grid-cols-4 gap-2" aria-label="Progreso de configuración">
          {['Identidad', 'Inteligencia', 'Comportamiento', 'Revisar'].map((nombre, i) => (
            <li key={nombre} className={`rounded-lg border px-2 py-2 text-center text-[11px] font-semibold ${
              i === paso ? 'border-[#1A5CD8] bg-[#EEF3FF] text-[#0B1D4F]'
                : i < paso ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-neutral-200 text-neutral-500'
            }`} aria-current={i === paso ? 'step' : undefined}>
              {i < paso ? <Check size={13} className="inline mr-1" /> : null}{nombre}
            </li>
          ))}
        </ol>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {cargando ? (
          <div className="min-h-48 grid place-items-center text-neutral-500"><Loader2 className="animate-spin" /></div>
        ) : paso === 0 ? (
          <div className="space-y-4">
            <PasoTitulo icono={Bot} titulo="Identidad y objetivo" texto="Describe el trabajo, no el canal donde se usará." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="agente-nombre" label="Nombre visible">
                <Input id="agente-nombre" value={datos.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Asistente comercial" autoFocus />
              </Campo>
              <Campo id="agente-clave" label="Clave portable" ayuda="Identificador estable, sin espacios. Ejemplo: VENTAS_B2B.">
                <Input id="agente-clave" className="font-mono uppercase" value={datos.clave}
                  onChange={e => set('clave', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="VENTAS_B2B" />
              </Campo>
              <Campo id="agente-categoria" label="Tipo de agente">
                <select id="agente-categoria" value={datos.categoria} onChange={e => set('categoria', e.target.value)} className="w-full h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30">
                  {CATEGORIAS_AGENTE.map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
                </select>
              </Campo>
              <Campo id="agente-idioma" label="Idioma">
                <select id="agente-idioma" value={datos.idioma} onChange={e => set('idioma', e.target.value)} className="w-full h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30">
                  <option value="es">Español</option><option value="es-CO">Español de Colombia</option><option value="en">Inglés</option>
                </select>
              </Campo>
              <Campo id="agente-objetivo" label="Objetivo" className="sm:col-span-2" ayuda="El resultado principal que orientará sus decisiones.">
                <Textarea id="agente-objetivo" rows={3} value={datos.objetivo} onChange={e => set('objetivo', e.target.value)}
                  placeholder="Atender prospectos, resolver preguntas y obtener los datos necesarios para..." />
              </Campo>
            </div>
          </div>
        ) : paso === 1 ? (
          <div className="space-y-4">
            <PasoTitulo icono={Brain} titulo="Inteligencia y memoria" texto="El proveedor se conecta con credenciales locales; nunca viajan con el agente." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="agente-proveedor" label="Proveedor de IA">
                <select id="agente-proveedor" className="w-full h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30" value={datos.proveedor} onChange={e => {
                  const proveedor = e.target.value
                  const primero = motores.find(m => m.proveedor === proveedor)
                  setDatos(d => ({ ...d, proveedor, modelo: primero?.modelo || '' })); setError(null)
                }}>
                  {proveedores.map(p => <option key={p.proveedor} value={p.proveedor} disabled={!p.listo}>{p.proveedor}{p.listo ? '' : ' · no configurado'}</option>)}
                </select>
              </Campo>
              <Campo id="agente-modelo" label="Modelo">
                <select id="agente-modelo" className="w-full h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30" value={datos.modelo} onChange={e => set('modelo', e.target.value)}>
                  {modelos.map(m => <option key={m.modelo} value={m.modelo}>{m.etiqueta}</option>)}
                </select>
              </Campo>
              <Campo id="agente-esfuerzo" label="Razonamiento">
                <select id="agente-esfuerzo" className="w-full h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30" value={datos.effort} onChange={e => set('effort', e.target.value)}>
                  {EFFORT_OPCIONES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                </select>
              </Campo>
              <Campo id="agente-memoria" label="Mensajes de memoria" ayuda="Cuántos mensajes recientes recibe el modelo en cada respuesta.">
                <Input id="agente-memoria" type="number" min="2" max="100" value={datos.memoria_mensajes} onChange={e => set('memoria_mensajes', e.target.value)} />
              </Campo>
            </div>
          </div>
        ) : paso === 2 ? (
          <div className="space-y-4">
            <PasoTitulo icono={ShieldCheck} titulo="Comportamiento base" texto="Después podrás agregar conocimiento, reglas y capacidades desde su ficha." />
            <Campo id="agente-instrucciones" label="Instrucciones principales" ayuda="No incluyas contraseñas, tokens, nombres de tablas ni datos de clientes.">
              <Textarea id="agente-instrucciones" rows={10} className="font-mono text-sm" value={datos.instrucciones} onChange={e => set('instrucciones', e.target.value)} />
            </Campo>
          </div>
        ) : (
          <div className="space-y-4">
            <PasoTitulo icono={ShieldCheck} titulo="Revisión segura" texto="Se creará aislado. Nada se conecta ni se activa automáticamente." />
            <dl className="grid gap-3 sm:grid-cols-2 rounded-2xl border bg-neutral-50 p-4 text-sm">
              <Dato label="Agente" valor={`${datos.nombre} (${datos.clave})`} />
              <Dato label="Tipo" valor={CATEGORIAS_AGENTE.find(c => c.valor === datos.categoria)?.label} />
              <Dato label="Inteligencia" valor={`${datos.proveedor} · ${datos.modelo}`} />
              <Dato label="Memoria" valor={`${datos.memoria_mensajes} mensajes`} />
            </dl>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Nacerá <strong>apagado, sin líneas y sin herramientas</strong>. En su ficha cargarás conocimientos y reglas, concederás capacidades y lo probarás antes de conectarlo.
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function PasoTitulo({ icono: Icono, titulo, texto }) {
  return <div className="flex gap-3"><span className="rounded-xl bg-[#EEF3FF] p-2 text-[#1A5CD8]"><Icono size={20} /></span><div><h3 className="font-semibold text-neutral-900">{titulo}</h3><p className="text-sm text-neutral-600">{texto}</p></div></div>
}

function Campo({ id, label, ayuda, className = '', children }) {
  return <div className={className}><label htmlFor={id} className="block text-xs font-semibold text-neutral-700 mb-1.5">{label}</label>{children}{ayuda && <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{ayuda}</p>}</div>
}

function Dato({ label, valor }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</dt><dd className="mt-1 text-neutral-900 break-words">{valor || '—'}</dd></div>
}
