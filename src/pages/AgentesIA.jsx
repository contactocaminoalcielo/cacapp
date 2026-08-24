// Agentes IA — la portada del módulo.
//
// 🩸 POR QUÉ EXISTE: hasta ahora el agente era UNO, y por eso el menú tenía
// cinco entradas sueltas ("Agente WA", "Plantillas WA", "Botones y menús",
// "Materiales WA"…) que no decían de quién eran. Van a llegar más líneas, y con
// esa forma cada línea nueva habría sumado tres entradas más al menú hasta
// hacerlo ilegible.
//
// Aquí cada tarjeta es una LÍNEA: su número, su cerebro, su voz. Lo que
// configura a un agente (reglas, materiales, botones) vive dentro de él, no
// suelto por el menú.
import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Bot, Loader2, Phone, Mic, MicOff, ChevronRight, BookOpen, Scale,
  MessageSquare, Plus, AlertTriangle, Download, Upload,
} from 'lucide-react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import CrearAgenteModal from '@/components/agente/CrearAgenteModal'
import { exportarAgente, importarAgente, listarAgentes } from '@/lib/agenteApi'

export default function AgentesIA() {
  const navigate = useNavigate()
  const [agentes, setAgentes]   = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState(null)
  const [creando, setCreando]   = useState(false)
  const [importando, setImportando] = useState(false)
  const archivoRef = useRef(null)

  useEffect(() => {
    listarAgentes()
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'No se pudieron cargar los agentes')
        setAgentes(r.agentes || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  async function importarArchivo(file) {
    if (!file) return
    setImportando(true); setError(null)
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error('El paquete supera el límite de 60 MB.')
      const json = JSON.parse(await file.text())
      const definicion = json.definicion || json
      if (definicion.schema !== 'orbit-agent/v1' && definicion.formato !== 1) {
        throw new Error('Ese archivo no es una definición de agente compatible.')
      }
      const r = await importarAgente(definicion)
      navigate(`/agentes/${r.agente.clave}`)
    } catch (e) {
      setError(e instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : e.message)
    } finally {
      setImportando(false)
      if (archivoRef.current) archivoRef.current.value = ''
    }
  }

  return (
    <>
      <Topbar />
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Agentes configurables</h1>
            <p className="mt-1 text-[13px] text-neutral-600 leading-relaxed max-w-2xl">
              Cada agente tiene inteligencia, conocimientos, reglas y capacidades propias. Se crea
              aislado y solo responde cuando le asignas una línea y lo enciendes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <input ref={archivoRef} type="file" accept="application/json,.json,.orbit-agent" className="hidden"
              onChange={e => importarArchivo(e.target.files?.[0])} />
            <Button variant="secondary" onClick={() => archivoRef.current?.click()} disabled={importando}>
              {importando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar agente
            </Button>
            <Button onClick={() => setCreando(true)}><Plus size={15} /> Agregar agente</Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {cargando ? (
          <div className="p-12 grid place-items-center text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !agentes.length ? (
          <p className="text-sm text-neutral-500 py-10 text-center">
            Todavía no hay ningún agente configurado.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {agentes.map((a, i) => <Ficha key={a.id} a={a} i={i} onError={setError} />)}
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-neutral-300 p-5 text-center">
          <ShieldNotice />
          <p className="text-[13px] text-neutral-500 mt-2">
            Crear o importar no conecta nada. Los agentes nuevos nacen apagados, sin líneas y sin
            herramientas; puedes configurarlos y probarlos sin afectar a Veterinarias.
          </p>
        </div>
      </div>
      <CrearAgenteModal open={creando} onClose={() => setCreando(false)} onCreated={a => navigate(`/agentes/${a.clave}`)} />
    </>
  )
}

function Ficha({ a, i, onError }) {
  const numeros = a.phone_number_ids || []
  const [exportando, setExportando] = useState(false)

  async function descargar() {
    setExportando(true)
    try {
      const r = await exportarAgente(a.clave)
      const blob = new Blob([JSON.stringify(r.definicion, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `${a.clave.toLowerCase()}.orbit-agent.json`
      enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { onError?.(e.message) } finally { setExportando(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }}
    >
      <div className="group rounded-2xl border bg-white p-5 shadow-sm hover:border-neutral-400 hover:shadow-md transition">
        <div className="flex items-start gap-3">
          <div className={`rounded-xl p-2.5 shrink-0 ${
            a.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-400'
          }`}>
            <Bot className="w-5 h-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-neutral-900 truncate">{a.nombre}</h3>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                a.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
              }`}>
                {a.activo ? 'Encendido' : 'Apagado'}
              </span>
            </div>

            <p className="text-[12px] text-neutral-500 mt-0.5 flex items-center gap-1.5">
              <Phone className="w-3 h-3 shrink-0" />
              {numeros.length
                ? `${numeros.length} línea${numeros.length > 1 ? 's' : ''} asignada${numeros.length > 1 ? 's' : ''}`
                : 'sin línea asignada'}
              <span className="text-neutral-300">·</span>
              {a.voz_activa
                ? <><Mic className="w-3 h-3" /> con voz</>
                : <><MicOff className="w-3 h-3" /> sin voz</>}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{a.piezas} piezas</span>
              <span className="flex items-center gap-1"><Scale className="w-3 h-3" />{a.reglas} reglas</span>
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />{a.respuestas_7d} en 7 días
              </span>
            </div>

            <p className="text-[11px] text-neutral-500 mt-2 font-mono">{a.proveedor} · {a.modelo}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <button type="button" onClick={descargar} disabled={exportando}
            className="min-h-9 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 disabled:opacity-50">
            {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Exportar
          </button>
          <Link to={`/agentes/${a.clave}`}
            className="min-h-9 inline-flex items-center gap-1 rounded-lg px-3 text-xs font-semibold text-[#1A5CD8] hover:bg-[#EEF3FF] focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 no-underline">
            Configurar <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function ShieldNotice() {
  return <Bot className="w-5 h-5 text-neutral-400 mx-auto" aria-hidden="true" />
}
