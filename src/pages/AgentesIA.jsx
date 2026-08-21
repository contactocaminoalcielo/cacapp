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
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Bot, Loader2, Phone, Mic, MicOff, ChevronRight, BookOpen, Scale,
  MessageSquare, Plus, AlertTriangle,
} from 'lucide-react'
import Topbar from '@/components/layout/Topbar'
import { listarAgentes } from '@/lib/agenteApi'

export default function AgentesIA() {
  const [agentes, setAgentes]   = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    listarAgentes()
      .then(r => {
        if (!r?.ok) throw new Error(r?.error || 'No se pudieron cargar los agentes')
        setAgentes(r.agentes || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  return (
    <>
      <Topbar />
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">

        <p className="text-[13px] text-neutral-500 leading-snug max-w-2xl">
          Cada agente atiende una línea de WhatsApp: contesta solo, con su propio contexto y
          sus propias reglas. Entra en uno para ver y ajustar lo suyo.
        </p>

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
            {agentes.map((a, i) => <Ficha key={a.id} a={a} i={i} />)}
          </div>
        )}

        {/* Un agente nuevo no se crea desde aquí todavía: es una fila de
            `agente_wa` con su número de Meta, y hacerlo mal deja una línea
            respondiendo a clínicas reales con el contexto de otra empresa. */}
        <div className="rounded-2xl border border-dashed border-neutral-300 p-5 text-center">
          <Plus className="w-5 h-5 text-neutral-300 mx-auto" />
          <p className="text-[13px] text-neutral-500 mt-2">
            Para conectar una línea nueva hace falta darla de alta en Meta y crear su agente.
            Todavía se hace por detrás — pídelo y se configura.
          </p>
        </div>
      </div>
    </>
  )
}

function Ficha({ a, i }) {
  const numeros = a.phone_number_ids || []
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }}
    >
      <Link
        to={`/agentes/${a.clave}`}
        className="group block rounded-2xl border bg-white p-5 shadow-sm no-underline
                   hover:border-neutral-400 hover:shadow-md transition"
      >
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

            <p className="text-[11px] text-neutral-400 mt-2 font-mono">{a.modelo}</p>
          </div>

          <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-600 shrink-0 mt-1 transition" />
        </div>
      </Link>
    </motion.div>
  )
}
