import { Fragment } from 'react'
import { Bold, Code2, Italic, Strikethrough, Underline } from 'lucide-react'

const FORMATOS = [
  { clave: 'negrita', label: 'Negrita', Icono: Bold, abre: '*', cierra: '*' },
  { clave: 'cursiva', label: 'Cursiva', Icono: Italic, abre: '_', cierra: '_' },
  { clave: 'tachado', label: 'Tachado', Icono: Strikethrough, abre: '~', cierra: '~' },
  { clave: 'monoespaciado', label: 'Monoespaciado', Icono: Code2, abre: '```', cierra: '```' },
]

/**
 * Inserta las marcas que entiende WhatsApp alrededor del texto seleccionado.
 * Si no hay selección deja un ejemplo marcado y lo selecciona para que la
 * persona pueda reemplazarlo escribiendo, sin tener que buscar el cursor.
 */
export function FormatoTextoWhatsapp({ textareaRef, value = '', onChange }) {
  function aplicar({ abre, cierra }) {
    const el = textareaRef?.current
    const inicio = el?.selectionStart ?? value.length
    const fin = el?.selectionEnd ?? inicio
    const elegido = value.slice(inicio, fin) || 'texto importante'
    const siguiente = value.slice(0, inicio) + abre + elegido + cierra + value.slice(fin)
    onChange(siguiente)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(inicio + abre.length, inicio + abre.length + elegido.length)
    })
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Formato del texto para WhatsApp">
      {FORMATOS.map(formato => {
        const Icono = formato.Icono
        return (
          <button key={formato.clave} type="button" onMouseDown={e => e.preventDefault()}
                  onClick={() => aplicar(formato)} aria-label={`Aplicar ${formato.label.toLowerCase()}`}
                  title={`Aplicar ${formato.label.toLowerCase()} al texto seleccionado`}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#1A5CD8]/40 hover:bg-blue-50 hover:text-[#1A5CD8] focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30">
            <Icono className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{formato.label}</span>
          </button>
        )
      })}
      <span title="WhatsApp no admite texto subrayado"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-500">
        <Underline className="h-4 w-4" aria-hidden="true" />
        <span>Subrayado no disponible</span>
      </span>
      <span className="w-full text-[11px] leading-relaxed text-slate-500">
        Selecciona una frase y aplica el estilo. Orbit guardará el formato compatible con WhatsApp.
      </span>
    </div>
  )
}

/**
 * Vista previa segura: interpreta solo las cuatro marcas de WhatsApp. Las
 * variables {{...}} se protegen para que sus guiones bajos no parezcan cursiva.
 */
export function TextoWhatsapp({ texto = '' }) {
  const partes = String(texto).split(/(\{\{[^{}]+\}\}|```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
  return partes.map((parte, i) => {
    if (!parte) return null
    if (/^\{\{[^{}]+\}\}$/.test(parte)) return <Fragment key={i}>{parte}</Fragment>
    if (parte.startsWith('```') && parte.endsWith('```')) {
      return <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[0.95em]">{parte.slice(3, -3)}</code>
    }
    if (parte.startsWith('*') && parte.endsWith('*')) return <strong key={i}><TextoWhatsapp texto={parte.slice(1, -1)} /></strong>
    if (parte.startsWith('_') && parte.endsWith('_')) return <em key={i}><TextoWhatsapp texto={parte.slice(1, -1)} /></em>
    if (parte.startsWith('~') && parte.endsWith('~')) return <s key={i}><TextoWhatsapp texto={parte.slice(1, -1)} /></s>
    return <Fragment key={i}>{parte}</Fragment>
  })
}
