// Mandar por la línea de veterinarias una plantilla aprobada o un recurso del
// catálogo, desde la ficha. Queda en la bitácora de la cuenta.
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import EnviarPlantilla from '@/components/whatsapp/EnviarPlantilla'
import { cargarMateriales, pesoLegible } from '@/lib/materialesApi'
import { crm } from '@/lib/crmApi'
import { useCrm } from './CrmContext'
import { ACENTO } from './ui'

export function EnviarPlantillaCrm({ abierto, onCerrar, destino, whatsapp, onEnviada }) {
  const { lineaVets } = useCrm()
  if (!abierto) return null
  if (!whatsapp) {
    return (
      <Modal open onClose={onCerrar} title="Enviar plantilla" maxWidth="max-w-md">
        <p className="text-[13px] text-gray-600">Esta cuenta no tiene WhatsApp en la ficha. Agrégalo primero.</p>
      </Modal>
    )
  }
  let numero = String(whatsapp).replace(/\D/g, '')
  if (numero.length === 10) numero = '57' + numero
  return (
    <EnviarPlantilla contacto={numero} linea={lineaVets} nombreLinea="Veterinarias" onCerrar={onCerrar}
      onEnviada={async nombre => {
        await crm.registrarGestion({ ...destino, tipo: 'PLANTILLA', resumen: `Plantilla enviada por WhatsApp: ${nombre || ''}`.trim() }).catch(() => {})
        onEnviada?.()
        onCerrar()
      }} />
  )
}

export function EnviarMaterialCrm({ abierto, onCerrar, destino, onEnviado }) {
  const { agenteVets, agenteVentas } = useCrm()
  const [materiales, setMateriales] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setError(null); setMateriales(null)
    const ids = [agenteVets?.id, agenteVentas?.id].filter(Boolean)
    Promise.all(ids.map(id => cargarMateriales(id).then(r => (r.materiales || []).map(m => ({ ...m, _agente: id }))).catch(() => [])))
      .then(listas => setMateriales(listas.flat().filter(m => m.activo)))
  }, [abierto, agenteVets?.id, agenteVentas?.id])

  async function enviar(m) {
    setEnviando(m.id); setError(null)
    try {
      const fn = destino.aliado_id ? crm.materialAliado : crm.materialProspecto
      await fn(destino.aliado_id || destino.prospecto_id, { clave: m.clave, agente_id: m._agente })
      onEnviado?.()
      onCerrar()
    } catch (e) {
      setError(/24|ventana|window/i.test(e.message)
        ? 'Fuera de la ventana de 24 h: WhatsApp solo deja enviar archivos si la vet escribió en el último día. Manda primero una plantilla.'
        : e.message)
    } finally { setEnviando(null) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Enviar recurso del catálogo" maxWidth="max-w-lg">
      {materiales === null ? <div className="py-6 text-center text-gray-400 text-sm">Cargando…</div>
        : !materiales.length ? <p className="text-[13px] text-gray-500">No hay recursos cargados. Súbelos en <b>Recursos</b>.</p>
        : (
          <div className="space-y-2">
            {materiales.map(m => (
              <div key={`${m._agente}-${m.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-gray-800 truncate">{m.nombre}</div>
                  <div className="text-[11px] text-gray-400 truncate">{m.nombre_archivo} · {pesoLegible(m.bytes)}</div>
                </div>
                <Button size="sm" onClick={() => enviar(m)} disabled={!!enviando} style={{ background: ACENTO }}>
                  {enviando === m.id ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
            ))}
          </div>
        )}
      {error && <p className="text-[12px] text-red-600 mt-3">{error}</p>}
    </Modal>
  )
}
