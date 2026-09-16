// Casilla obligatoria de autorización de datos personales.
//
// Va en TODO formulario donde se captan datos de una persona. La ley pide una
// manifestación previa, expresa e informada (Ley 1581 de 2012, art. 9), así que
// la casilla NACE VACÍA: marcarla por defecto no es autorización, es un dato
// puesto por nosotros. No cambiar eso.
//
// Tres redacciones, porque no siempre autoriza el mismo:
//   titular → la persona marca por sus propios datos (portales del cliente)
//   tercero → una clínica aliada declara que el dueño ya la autorizó
//   interno → alguien del equipo deja constancia de la autorización que el
//             titular dio por teléfono, WhatsApp o en persona
//
// El enlace a la política abre en otra pestaña a propósito: perder un
// formulario a medio llenar por ir a leer es la forma más segura de que nadie
// lo lea.
import { useId } from 'react'
import { AVISO_CORTO, RESPONSABLE, URL_POLITICA } from '@/lib/privacidad'

const TEXTOS = {
  titular: <>Autorizo a {RESPONSABLE.comercial} a tratar mis datos personales para prestar el servicio,
    conforme a la</>,
  tercero: <>Declaro que cuento con la autorización del dueño de la mascota para entregar sus datos a{' '}
    {RESPONSABLE.comercial}, conforme a la</>,
  interno: <>El titular autorizó el tratamiento de sus datos y se le informó la</>,
}

export default function CasillaDatos({
  checked, onChange, variante = 'titular', tono = 'claro', error = null, className = '',
}) {
  const id = useId()
  const errId = `${id}-err`
  const portal = tono === 'portal'

  const caja = portal
    ? { background: '#FBF7F0', border: `1px solid ${error ? '#B4443A' : '#E3DDCE'}`, color: '#2A2620' }
    : undefined
  const enlaceColor = portal ? '#2F5D45' : undefined

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={`flex items-start gap-3 cursor-pointer rounded-xl p-3 ${
          portal ? '' : `border bg-white ${error ? 'border-red-400' : 'border-gray-200'}`
        }`}
        style={caja}
      >
        <input
          id={id}
          type="checkbox"
          checked={!!checked}
          onChange={e => onChange(e.target.checked)}
          aria-invalid={!!error}
          aria-describedby={error ? errId : undefined}
          className="cac-foco mt-0.5 h-5 w-5 flex-shrink-0 rounded"
        />
        <span className="text-[13px] leading-relaxed">
          {TEXTOS[variante] || TEXTOS.titular}{' '}
          <a
            href={URL_POLITICA}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="cac-foco underline font-semibold"
            style={enlaceColor ? { color: enlaceColor } : undefined}
          >
            Política de Tratamiento de Datos
          </a>
          .
        </span>
      </label>

      <p className={`text-[11px] leading-relaxed mt-2 ${portal ? '' : 'text-gray-500'}`}
         style={portal ? { color: '#6B6257' } : undefined}>
        {AVISO_CORTO}
      </p>

      {error && (
        <p id={errId} role="alert" className="text-[12px] font-semibold mt-2"
           style={{ color: portal ? '#B4443A' : undefined }}>
          <span className={portal ? '' : 'text-red-600'}>{error}</span>
        </p>
      )}
    </div>
  )
}
