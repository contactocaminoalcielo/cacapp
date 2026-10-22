import { useState } from 'react'
import { Check, Copy, Send, UserPlus, Loader2 } from 'lucide-react'
import { crm as crmApi } from '@/lib/crmApi'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ACENTO, Cabecera, Campo } from '@/components/crm/ui'
import { EnviarPlantillaCrm } from '@/components/crm/EnviarWhatsapp'

const LINK = 'https://orbit.orbitacac.com/#/aliado'

export default function Invitar() {
  const [copiado, setCopiado] = useState(false)
  const [telefono, setTelefono] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [plantillaPara, setPlantillaPara] = useState(null)   // número, cuando la ventana de 24 h está cerrada

  function copiar() {
    navigator.clipboard.writeText(LINK).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  async function enviarPorOrbit() {
    const num = telefono.replace(/\D/g, '')
    if (!num) return
    setEnviando(true); setExito(false); setErrorEnvio(null)
    try {
      await crmApi.invitarAliada({ whatsapp: num })
      setExito(true)
      setTelefono('')
      setTimeout(() => setExito(false), 4000)
    } catch (e) {
      // Fuera de la ventana de 24 h solo sale una plantilla: se abre el selector
      // de la línea de veterinarias, nunca el WhatsApp personal.
      if (e.detalle?.necesita_plantilla) { setErrorEnvio(e.message); setPlantillaPara(e.detalle.numero || num) }
      else setErrorEnvio(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecera titulo="Invitar aliada" sub="Envía el enlace de registro a cualquier clínica o veterinaria que quiera sumarse." />

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

        {/* Copiar enlace */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
          <span className="flex-1 text-[12.5px] font-mono text-gray-700 truncate">{LINK}</span>
          <button onClick={copiar}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition"
            style={{ color: copiado ? '#22C55E' : ACENTO, background: copiado ? '#F0FDF4' : `${ACENTO}15` }}>
            {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
          </button>
        </div>

        {/* Enviar por WhatsApp de Orbit */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="text-[13px] font-semibold text-gray-800">Enviar por WhatsApp de Orbit</div>
          <div className="text-[12px] text-gray-500">
            El mensaje saldrá por la línea de veterinarias de Orbit, no desde tu celular personal.
          </div>
          <Campo label="Número de WhatsApp de la veterinaria">
            <Input
              value={telefono}
              onChange={e => { setTelefono(e.target.value); setExito(false); setErrorEnvio(null) }}
              placeholder="3001234567"
              inputMode="tel"
              onKeyDown={e => e.key === 'Enter' && enviarPorOrbit()}
            />
          </Campo>
          {errorEnvio && <p className="text-[12px] text-red-600">{errorEnvio}</p>}
          <Button
            onClick={enviarPorOrbit}
            disabled={enviando || !telefono.replace(/\D/g, '')}
            className="w-full flex items-center justify-center gap-2"
            style={{ background: exito ? '#22C55E' : ACENTO }}>
            {enviando
              ? <><Loader2 size={14} className="animate-spin" /> Enviando…</>
              : exito
                ? <><Check size={14} /> Enviado</>
                : <><Send size={14} /> Enviar enlace de invitación</>}
          </Button>
        </div>

        <div className="text-[11.5px] text-gray-400 leading-relaxed">
          El enlace no caduca. Para enviarle a una veterinaria ya aprobada su enlace personal,
          usa <strong>Configuración › Aliados</strong> y haz clic en "Generar / Enlace" en su fila.
        </div>
      </div>

      <EnviarPlantillaCrm abierto={!!plantillaPara} onCerrar={() => setPlantillaPara(null)} whatsapp={plantillaPara}
        onEnviada={() => { setErrorEnvio(null); setExito(true); setTelefono(''); setTimeout(() => setExito(false), 4000) }} />
    </div>
  )
}
