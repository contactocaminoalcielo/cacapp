import { useEffect, useState } from 'react'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { petEmoji } from '@/lib/utils'
import { CheckCircle2, Camera, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'

// FOTO – CENIZARIO RESTOS CÁLCICOS (migración 205) en el tablero
// Producción–Diseño. Va APARTE de las líneas de recordatorio (David
// 2026-11-03): marcar el cenizario listo no mueve el estado del servicio, que
// sigue en compostaje. La foto llega del portal de visita y no se mezcla con
// las de memorial, memopet o recordatorios.

const AMBAR = { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E' }

export default function CenizariosRestos({ recargarCada = 0 }) {
  const { alert: showAlert } = useConfirm()
  const [filas, setFilas] = useState(null)
  const [abierto, setAbierto] = useState(true)
  const [guardando, setGuardando] = useState(null)
  const [verListos, setVerListos] = useState(false)

  async function cargar() {
    try {
      const r = await orbitApi('/produccion/restos-calcicos')
      setFilas(r.cenizarios || [])
    } catch (e) {
      // Sin la migración 205 o sin backend: el tablero sigue igual.
      console.warn('[produccion] cenizarios de restos:', e?.message || e)
      setFilas([])
    }
  }
  useEffect(() => { cargar() }, [recargarCada])

  async function marcar(f, listo) {
    setGuardando(f.id)
    try {
      await orbitApi(`/produccion/restos-calcicos/${f.id}/listo`, { method: 'POST', body: { listo } })
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally {
      setGuardando(null)
    }
  }

  const pendientes = (filas || []).filter(f => !f.restos_cenizario_listo_en)
  if (!pendientes.length && !verListos) return null
  const sinFoto = pendientes.filter(f => !f.restos_foto_url).length
  const visibles = verListos ? filas : pendientes

  return (
    <div className="mb-6 rounded-2xl border overflow-hidden" style={{ borderColor: AMBAR.border, background: AMBAR.bg }}>
      <button type="button" onClick={() => setAbierto(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <span className="text-[13px] font-bold" style={{ color: AMBAR.text }}>
          ⚠️ FOTO – CENIZARIO RESTOS CÁLCICOS
        </span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white" style={{ color: AMBAR.text }}>
          {pendientes.length} por hacer{sinFoto ? ` · ${sinFoto} sin foto` : ''}
        </span>
        <span className="ml-auto" style={{ color: AMBAR.text }}>{abierto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {abierto && (
        <div className="px-4 pb-4">
          <p className="text-[11px] mb-3" style={{ color: AMBAR.text }}>
            Cenizarios personalizados para entregar los restos cálcicos con la planta. No cambian el estado del servicio.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {visibles.map(f => {
              const listo = !!f.restos_cenizario_listo_en
              return (
                <div key={f.id} className="flex gap-3 rounded-xl bg-white border p-3" style={{ borderColor: listo ? '#A7F3D0' : AMBAR.border }}>
                  {f.restos_foto_url ? (
                    <a href={f.restos_foto_url} target="_blank" rel="noreferrer" title="Abrir la foto en grande"
                      className="shrink-0">
                      <img src={f.restos_foto_url} alt={`Foto de ${f.mascota} para el cenizario`}
                        className="w-16 h-16 rounded-lg object-cover border border-gray-200" loading="lazy" />
                    </a>
                  ) : (
                    <div className="w-16 h-16 shrink-0 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-[9px] font-bold text-center"
                      style={{ borderColor: AMBAR.border, color: AMBAR.text }}>
                      <Camera size={14} /> FOTO PENDIENTE
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-ink truncate">{petEmoji(f.especie)} {f.mascota}</div>
                    <div className="text-[11px] text-ink3 truncate">{f.propietario}{f.cubiculo ? ` · Cubículo ${f.cubiculo}` : ''}</div>
                    {f.planta_nombre && <div className="text-[10px] text-ink3 truncate">🌱 {f.planta_nombre}</div>}
                    <div className="mt-1.5">
                      {listo ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
                            <CheckCircle2 size={12} /> Listo{f.listo_por ? ` · ${f.listo_por}` : ''}
                          </span>
                          <button type="button" onClick={() => marcar(f, false)} disabled={guardando === f.id}
                            className="inline-flex items-center gap-0.5 text-[10px] text-ink3 hover:text-ink">
                            <RotateCcw size={10} /> Deshacer
                          </button>
                        </div>
                      ) : f.restos_foto_url ? (
                        <button type="button" onClick={() => marcar(f, true)} disabled={guardando === f.id}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-primary-dark text-white disabled:opacity-50">
                          {guardando === f.id ? 'Guardando…' : 'Marcar cenizario listo'}
                        </button>
                      ) : (
                        <span className="text-[10px] font-semibold" style={{ color: AMBAR.text }}>
                          La familia la sube desde el enlace de visita a la planta
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {filas.length > pendientes.length && (
            <button type="button" onClick={() => setVerListos(v => !v)}
              className="mt-2.5 text-[11px] font-semibold hover:underline" style={{ color: AMBAR.text }}>
              {verListos ? 'Ocultar los listos' : `Ver también los listos (${filas.length - pendientes.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
