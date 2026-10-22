// Lo que se hace estando en la clínica, sea al registrar una visita nueva
// (NuevaVisitaModal) o al cerrar una programada (RegistrarGestion): compartir el
// enlace de afiliación y dejar una PQRS. Vive aquí para que los dos formularios
// no vuelvan a separarse — el 22-oct solo uno lo tenía y el otro, el que se usa
// al darle «Registrar» a una visita de la agenda, no mostraba nada.
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { crm, TICKET_TIPOS, TICKET_CATEGORIAS } from '@/lib/crmApi'
import { EnviarPlantillaCrm } from './EnviarWhatsapp'
import { Campo, ACENTO } from './ui'
import { LifeBuoy, ChevronDown, ChevronUp, Send, Check, Loader2 } from 'lucide-react'

/**
 * El enlace sale SIEMPRE por la línea de veterinarias. Sin `whatsapp`, el
 * backend lo toma de la ficha (aliado_id / prospecto_id). Fuera de la ventana
 * de 24 h el backend manda la plantilla de afiliación; si esa tampoco sale,
 * se abre el selector de plantillas de la misma línea. Nunca wa.me.
 */
export function BotonEnlaceAfiliacion({ whatsapp = null, aliadoId = null, prospectoId = null, onError }) {
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)
  const [plantillaPara, setPlantillaPara] = useState(null)

  async function enviar() {
    setEnviando(true); setExito(false); onError?.(null)
    try {
      await crm.invitarAliada({ whatsapp: whatsapp || undefined, aliado_id: aliadoId || undefined, prospecto_id: prospectoId || undefined })
      setExito(true); setTimeout(() => setExito(false), 4000)
    } catch (e) {
      if (e.detalle?.necesita_plantilla) { onError?.(e.message); setPlantillaPara(e.detalle.numero || whatsapp) }
      else onError?.(`Enlace de afiliación: ${e.message}`)
    } finally { setEnviando(false) }
  }

  return (
    <>
      <button type="button" onClick={enviar} disabled={enviando}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-60"
        style={{ color: exito ? '#22C55E' : '#0F766E', background: exito ? '#F0FDF4' : '#E6F4F1' }}>
        {enviando ? <><Loader2 size={12} className="animate-spin" /> Enviando…</>
          : exito ? <><Check size={12} /> Enviado por la línea de veterinarias</>
          : <><Send size={12} /> Compartir enlace de afiliación (línea de veterinarias)</>}
      </button>
      <EnviarPlantillaCrm abierto={!!plantillaPara} onCerrar={() => setPlantillaPara(null)} whatsapp={plantillaPara}
        destino={aliadoId ? { aliado_id: aliadoId } : prospectoId ? { prospecto_id: prospectoId } : null}
        onEnviada={() => { onError?.(null); setExito(true); setTimeout(() => setExito(false), 4000) }} />
    </>
  )
}

export const PQRS_VACIA = { tipo: 'PETICION', categoria: 'OTRO', prioridad: 'MEDIA', asunto: '', descripcion: '' }

/**
 * `pqrs` null = cerrada. `aviso` = por qué no aplica (el ticket exige una
 * aliada: crm_tickets.aliado_id es NOT NULL).
 */
export function SeccionPqrs({ pqrs, setPqrs, aviso = null }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 overflow-hidden">
      {aviso ? (
        <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] text-gray-500">
          <LifeBuoy size={14} /> {aviso}
        </div>
      ) : (<>
        <button type="button" onClick={() => setPqrs(p => p ? null : { ...PQRS_VACIA })}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 transition">
          <LifeBuoy size={14} style={{ color: pqrs ? ACENTO : undefined }} />
          <span className="flex-1 text-left">{pqrs ? 'Registrar PQRS también' : 'Registrar una PQRS'}</span>
          {pqrs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {pqrs && (
          <div className="px-3.5 pb-3.5 space-y-3 border-t border-gray-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Tipo">
                <Select value={pqrs.tipo || 'PETICION'} onChange={e => setPqrs(p => ({ ...p, tipo: e.target.value }))}>
                  {Object.entries(TICKET_TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Campo>
              <Campo label="Categoría">
                <Select value={pqrs.categoria || 'OTRO'} onChange={e => setPqrs(p => ({ ...p, categoria: e.target.value }))}>
                  {Object.entries(TICKET_CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Campo>
            </div>
            <Campo label="Asunto *">
              <Input value={pqrs.asunto || ''} onChange={e => setPqrs(p => ({ ...p, asunto: e.target.value }))}
                placeholder="Ej: Cobro incorrecto en comisión de octubre" />
            </Campo>
            <Campo label="Descripción">
              <Textarea rows={2} value={pqrs.descripcion || ''} onChange={e => setPqrs(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Detalles del caso…" />
            </Campo>
            <p className="text-[11px] text-gray-400">El ticket quedará con canal <b>Visita</b> y prioridad <b>Media</b>.</p>
          </div>
        )}
      </>)}
    </div>
  )
}

/** Crea el ticket de la PQRS. Lanza con un mensaje claro: la gestión ya quedó. */
export async function guardarPqrs(aliadoId, pqrs) {
  if (!pqrs || !aliadoId || !pqrs.asunto?.trim()) return
  await crm.crearTicket({
    aliado_id: aliadoId, tipo: pqrs.tipo || 'PETICION', categoria: pqrs.categoria || 'OTRO',
    prioridad: pqrs.prioridad || 'MEDIA', canal: 'VISITA',
    asunto: pqrs.asunto.trim(), descripcion: pqrs.descripcion || null,
  }).catch(e => { throw new Error(`La visita quedó registrada, pero la PQRS no: ${e.message}`) })
}
