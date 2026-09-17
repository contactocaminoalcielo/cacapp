import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { ClipboardList } from 'lucide-react'

// ── Bitácora del técnico sobre ESTE servicio ──────────────────────────────────
// Dos tablas distintas a propósito (migración 164):
//   · REVISIÓN (`bitacora_revisiones_tecnico`) — el sí/no obligatorio al guardar
//     el recibo, con el snapshot `visto_*` de lo que tenía en pantalla.
//   · AJUSTE  (`bitacora_ajustes_tecnico`)     — lo que propone cuando no
//     coincide, con su nota. Es CAPA SOMBRA: no tocó el servicio, ni el recibo,
//     ni el cuadre.
//
// Hasta el 17-sep-2026 esto solo se veía dentro de la app del técnico y en
// Finanzas › Cuadre —filtrado por el técnico de ese cuadre—, así que desde un
// servicio no había forma de leerlo.
//
// Usado en el modal del Kanban y en la ficha del Historial (Gestión).
export default function BitacoraTecnico({ servicioId }) {
  const [entradas, setEntradas] = useState(null)

  useEffect(() => {
    if (!servicioId) { setEntradas(null); return }
    let vivo = true
    // Se leen como LISTA, no con `.maybeSingle()`: el unique es por
    // (servicio_id, tecnico_id), así que un servicio que toquen dos personas
    // —uno recoge, otro entrega— tiene dos filas, y `maybeSingle()` fallaría
    // justo cuando hay MÁS que contar. Hoy no pasa en ningún servicio, pero el
    // esquema lo permite y el fallo sería mudo.
    Promise.all([
      db.from('bitacora_revisiones_tecnico')
        .select('tecnico_id, coincide, visto_cobrado, visto_efectivo, visto_digital, visto_transporte, created_at, updated_at, personal:tecnico_id(nombre, apellido)')
        .eq('servicio_id', servicioId).order('created_at'),
      db.from('bitacora_ajustes_tecnico')
        .select('tecnico_id, cobrado_sugerido, medios_sugeridos, reconocido_sugerido, nota, created_at, personal:tecnico_id(nombre, apellido)')
        .eq('servicio_id', servicioId).order('created_at'),
    ])
      .then(([r, a]) => {
        if (!vivo) return
        const revs = r?.data || [], ajs = a?.data || []
        // Una entrada por persona: su revisión y, si lo hizo, su ajuste.
        const porTecnico = new Map()
        for (const x of revs) porTecnico.set(String(x.tecnico_id), { revision: x, ajuste: null })
        for (const x of ajs) {
          const k = String(x.tecnico_id)
          if (porTecnico.has(k)) porTecnico.get(k).ajuste = x
          else porTecnico.set(k, { revision: null, ajuste: x })
        }
        setEntradas([...porTecnico.values()])
      })
      // Información de apoyo: si falla no se muestra nada, pero no rompe la
      // pantalla que la contiene.
      .catch(() => { if (vivo) setEntradas(null) })
    return () => { vivo = false }
  }, [servicioId])

  if (!entradas?.length) return null

  const quien  = p => p ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : 'el técnico'
  const cuando = ts => ts
    ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  return (
    <>
      {entradas.map(({ revision: rev, ajuste: aj }, i) => {
        // `coincide` es NOT NULL en DB, así que basta el booleano.
        const ok = rev?.coincide === true
        return (
          <div key={i} className="rounded-xl p-3 space-y-2"
            style={{ background: ok ? '#F0FDF4' : '#FFF7ED',
                     border: `1px solid ${ok ? '#BBF7D0' : '#FED7AA'}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: ok ? '#15803D' : '#9A3412' }}>
              <ClipboardList size={10} /> Bitácora del técnico
            </div>

            {rev && (
              <div className="text-[12px] font-semibold" style={{ color: ok ? '#166534' : '#9A3412' }}>
                {/* Las revisiones anteriores al 17-sep son el backfill de la
                    migración 164: se derivaron de un ajuste existente, no de
                    alguien contestando en pantalla. Decir "dijo que no coincide"
                    de esas sería ponerle palabras en la boca; con ajuste se dice
                    lo que de verdad consta. */}
                {ok ? '✓ Revisó y dijo que todo coincide'
                    : aj ? '✗ No coincide — dejó un ajuste'
                         : '✗ Revisó y dijo que no coincide'}
                <span className="font-normal text-gray-500 text-[11px]">
                  {' — '}{quien(rev.personal)}
                  {cuando(rev.updated_at || rev.created_at) ? ` · ${cuando(rev.updated_at || rev.created_at)}` : ''}
                </span>
              </div>
            )}

            {/* Lo que tenía EN PANTALLA al responder. No es lo que hay hoy en el
                servicio: es la foto de ese momento, y por eso sirve para explicar
                una diferencia que apareció después. */}
            {rev && [rev.visto_cobrado, rev.visto_efectivo, rev.visto_digital, rev.visto_transporte]
              .some(v => v != null) && (
              <div className="rounded-lg bg-white border px-2.5 py-2" style={{ borderColor: '#E5E7EB' }}>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Lo que vio en pantalla</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  {rev.visto_cobrado    != null && <div><span className="text-gray-400">Cobrado:</span> <span className="font-semibold">{fmt(rev.visto_cobrado)}</span></div>}
                  {rev.visto_efectivo   != null && <div><span className="text-gray-400">Efectivo:</span> <span className="font-semibold">{fmt(rev.visto_efectivo)}</span></div>}
                  {rev.visto_digital    != null && <div><span className="text-gray-400">Digital:</span> <span className="font-semibold">{fmt(rev.visto_digital)}</span></div>}
                  {rev.visto_transporte != null && <div><span className="text-gray-400">Transporte:</span> <span className="font-semibold">{fmt(rev.visto_transporte)}</span></div>}
                </div>
              </div>
            )}

            {/* El ajuste es capa sombra: NO tocó el servicio ni el cuadre.
                Decirlo aquí evita que alguien lo lea como un valor ya aplicado. */}
            {aj && (
              <div className="rounded-lg bg-white border px-2.5 py-2 space-y-1.5" style={{ borderColor: '#FED7AA' }}>
                <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#9A3412' }}>
                  Lo que propone — no está aplicado
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  {aj.cobrado_sugerido    != null && <div><span className="text-gray-400">Cobrado:</span> <span className="font-semibold">{fmt(aj.cobrado_sugerido)}</span></div>}
                  {aj.reconocido_sugerido != null && <div><span className="text-gray-400">A reconocerle:</span> <span className="font-semibold">{fmt(aj.reconocido_sugerido)}</span></div>}
                </div>
                {aj.medios_sugeridos && (
                  <div className="text-[11px] text-gray-600">
                    <span className="text-gray-400">Medios:</span>{' '}
                    {Array.isArray(aj.medios_sugeridos)
                      ? aj.medios_sugeridos.map(m => `${m.metodo || m} ${m.monto != null ? fmt(m.monto) : ''}`.trim()).join(' · ')
                      : String(aj.medios_sugeridos)}
                  </div>
                )}
                {aj.nota && (
                  <div className="text-[12px] text-gray-800 bg-orange-50 rounded-lg px-2.5 py-1.5 border whitespace-pre-line" style={{ borderColor: '#FED7AA' }}>
                    "{aj.nota}"
                  </div>
                )}
                <div className="text-[10px] text-gray-400">
                  {quien(aj.personal)}{cuando(aj.created_at) ? ` · ${cuando(aj.created_at)}` : ''}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
