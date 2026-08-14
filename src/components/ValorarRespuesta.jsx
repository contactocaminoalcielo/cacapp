// Marcar una respuesta del AGENTE como buena o mala, y decir qué debió decir.
//
// Vive aparte porque se usa en los dos sitios donde se lee una conversación: la
// pantalla `/whatsapp` y la ventanita flotante. Duplicarlo garantizaba que un
// día uno de los dos se quedara atrás.
//
// No cambia nada del agente por sí solo: queda como corrección para que
// coordinación la revise en la pantalla del agente y decida si se vuelve regla
// (migración 099). Se marca en caliente, que es cuando uno se acuerda.
import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { valorarRespuesta } from '@/lib/agenteApi'

/**
 * @param {number}  mensajeId
 * @param {boolean} claro  true sobre fondo oscuro (la burbuja azul de /whatsapp)
 */
export default function ValorarRespuesta({ mensajeId, claro = false }) {
  const [marca, setMarca] = useState(null)      // null | true | false
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function marcar(buena, correccion = null) {
    setGuardando(true)
    setError(null)
    try {
      await valorarRespuesta(mensajeId, buena, correccion)
      setMarca(buena)
      setAbierto(false)
      setTexto('')
    } catch (e) {
      // Se puede volver a intentar; lo que no puede es romper la conversación.
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const apagado = claro ? 'text-white/40' : 'text-gray-300'

  if (marca !== null && !abierto) {
    return (
      <span className={`text-[9.5px] ${claro ? 'text-white/60' : 'text-gray-400'}`}>
        {marca ? '👍 buena' : '👎 corregida'}
      </span>
    )
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button" disabled={guardando} onClick={() => marcar(true)}
        title="Estuvo bien"
        className={`${apagado} hover:text-emerald-500 transition-colors`}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        type="button" disabled={guardando} onClick={() => setAbierto(a => !a)}
        title="Estuvo mal — decir qué debió responder"
        className={`${abierto ? 'text-red-400' : apagado} hover:text-red-400 transition-colors`}
      >
        <ThumbsDown size={12} />
      </button>

      {abierto && (
        // Sale hacia ARRIBA y anclado a la derecha: en el último mensaje del
        // hilo, hacia abajo quedaría tapado por la caja de escribir.
        <div className="absolute bottom-full right-0 mb-1.5 w-[250px] z-20 rounded-xl border border-gray-200 bg-white p-2 shadow-lg text-left">
          <textarea
            rows={2} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="¿Qué debió responder?"
            className="w-full text-[11px] text-gray-800 rounded-lg border border-gray-200 px-2 py-1.5 resize-y outline-none focus:border-gray-400"
          />
          {error && <p className="text-[10px] text-red-600 mt-1">{error}</p>}
          <div className="flex justify-end gap-1 mt-1">
            <button type="button" onClick={() => setAbierto(false)}
              className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800">Cancelar</button>
            <button
              type="button" disabled={guardando || !texto.trim()}
              onClick={() => marcar(false, texto.trim())}
              className="px-2 py-1 text-[11px] rounded-lg bg-[#3D5A27] text-white disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
