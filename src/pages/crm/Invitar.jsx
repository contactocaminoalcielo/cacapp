import { useState } from 'react'
import { Check, Copy, Send, UserPlus } from 'lucide-react'
import { ACENTO, Cabecera } from '@/components/crm/ui'

const LINK = 'https://orbit.orbitacac.com/#/aliado'
const MSG  = `Hola 👋, te compartimos el enlace para registrar tu clínica o veterinaria como aliada de Camino al Cielo:\n${LINK}`

export default function Invitar() {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(LINK).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecera titulo="Invitar aliada" sub="Comparte el enlace de registro con cualquier clínica o veterinaria que quiera sumarse." />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mt-4 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `${ACENTO}20` }}>
            <UserPlus size={18} style={{ color: ACENTO }} />
          </div>
          <div>
            <div className="text-[14px] font-bold text-gray-900">Enlace de afiliación</div>
            <div className="text-[12.5px] text-gray-500 mt-0.5">
              Cualquier veterinaria que abra este enlace puede registrar sus datos. Una vez revisada, el coordinador la aprueba y le llega su enlace personal para pedir servicios.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
          <span className="flex-1 text-[12.5px] font-mono text-gray-700 truncate">{LINK}</span>
          <button onClick={copiar}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition"
            style={{ color: copiado ? '#22C55E' : ACENTO, background: copiado ? '#F0FDF4' : `${ACENTO}15` }}>
            {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
          </button>
        </div>

        <a href={`https://wa.me/?text=${encodeURIComponent(MSG)}`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-[13px] font-bold text-white transition hover:opacity-90"
          style={{ background: '#25D366' }}>
          <Send size={15} /> Enviar por WhatsApp
        </a>

        <div className="text-[11.5px] text-gray-400 leading-relaxed">
          El enlace no caduca. Para enviarle a una veterinaria ya aprobada su enlace personal,
          usa <strong>Configuración › Aliados</strong> y haz clic en "Generar / Enlace" en su fila.
        </div>
      </div>
    </div>
  )
}
