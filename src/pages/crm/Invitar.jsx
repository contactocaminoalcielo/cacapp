import { useState } from 'react'
import { Check, Copy, Send, UserPlus, Loader2 } from 'lucide-react'
import { crm as crmApi } from '@/lib/crmApi'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ACENTO, Cabecera, Campo } from '@/components/crm/ui'

const LINK = 'https://orbit.orbitacac.com/#/aliado'

export default function Invitar() {
  const [copiado, setCopiado] = useState(false)
  const [telefono, setTelefono] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [waHref, setWaHref] = useState(null)

  function copiar() {
    navigator.clipboard.writeText(LINK).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  async function enviarPorOrbit() {
    const num = telefono.replace(/\D/g, '')
    if (!num) return
    setEnviando(true); setExito(false); setErrorEnvio(null); setWaHref(null)
    try {
      const r = await crmApi.invitarAliada(num)
      if (r?.sin_conversacion) {
        // Número sin conversación previa: WA solo acepta plantillas para iniciar.
        // Mostramos el enlace wa.me para que el coordinador lo envíe desde su celular.
        setWaHref(r.wa_href)
        return
      }
      if (r?.ok === false) throw new Error(r.error || 'No se pudo enviar')
      setExito(true)
      setTelefono('')
      setTimeout(() => setExito(false), 4000)
    } catch (e) {
      setErrorEnvio(e.message)
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
          {waHref && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-[12px] text-amber-800 font-medium">
                Esta veterinaria no tiene conversación previa con Orbit. WhatsApp solo permite plantillas aprobadas para iniciar contacto.
              </p>
              <a href={waHref} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold text-white"
                style={{ background: '#25D366' }}>
                <Send size={14} /> Enviar desde mi WhatsApp personal
              </a>
            </div>
          )}
        </div>

        <div className="text-[11.5px] text-gray-400 leading-relaxed">
          El enlace no caduca. Para enviarle a una veterinaria ya aprobada su enlace personal,
          usa <strong>Configuración › Aliados</strong> y haz clic en "Generar / Enlace" en su fila.
        </div>
      </div>
    </div>
  )
}
