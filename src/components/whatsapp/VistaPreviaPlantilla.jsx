// Cómo se ve una plantilla en el teléfono de quien la recibe.
//
// Vivía dentro de PlantillasWhatsapp.jsx. Se sacó aquí cuando la bandeja pasó a
// poder enviar plantillas: son dos pantallas que muestran lo MISMO, y tener dos
// copias del render es cómo una acaba enseñando un mensaje que la otra manda de
// otra forma — que en una previa es justo lo que no puede pasar, porque es lo
// único que se mira antes de apretar Enviar.
import { componente, conValores, tarjetasDe, CABECERAS } from '@/lib/plantillasWa'
import { TextoWhatsapp } from '@/components/whatsapp/FormatoTextoWhatsapp'
import { Link2, Reply, Phone, Copy, Image as ImageIcon, FileText, Film, MapPin } from 'lucide-react'

const ICONO_CAB = { IMAGE: ImageIcon, VIDEO: Film, DOCUMENT: FileText, LOCATION: MapPin }

/**
 * `valores` va por HUECO, sin el destino (`{ mascota: 'Toby', '1': 'Toby' }`):
 * el título y el cuerpo pueden nombrar el mismo dato. Lo que no tenga valor se
 * queda como `{{hueco}}`, que es la señal de que va a llegar en blanco.
 */
export default function VistaPreviaPlantilla({ p, valores = {} }) {
  const cab = componente(p, 'HEADER')
  const cuerpo = componente(p, 'BODY')?.text || ''
  const pie = componente(p, 'FOOTER')?.text
  const botones = componente(p, 'BUTTONS')?.buttons || []
  const Icono = ICONO_CAB[cab?.format]
  const cards = tarjetasDe(p)

  return (
    <div className="rounded-xl bg-[#E7F3E9] p-2.5 space-y-1.5">
      <div className="bg-white rounded-lg rounded-tl-sm p-2.5 shadow-sm space-y-1">
        {cab?.format === 'TEXT' && cab.text && (
          <p className="text-[12.5px] font-bold text-gray-800">{conValores(cab.text, valores)}</p>
        )}
        {Icono && (
          <div className="h-16 rounded-md bg-gray-100 flex flex-col items-center justify-center gap-1 text-gray-400">
            <Icono className="w-5 h-5" />
            <span className="text-[10px]">
              {CABECERAS.find(c => c.valor === cab.format)?.label || cab.format}
            </span>
          </div>
        )}
        <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-snug">
          {cuerpo ? <TextoWhatsapp texto={conValores(cuerpo, valores)} /> : <span className="italic text-gray-400">(sin texto)</span>}
        </p>
        {pie && <p className="text-[10.5px] text-gray-400">{pie}</p>}
      </div>
      {botones.map((b, i) => (
        <div key={i} className="bg-white rounded-lg py-1.5 text-center text-[12px] font-semibold text-[#0a7cff] shadow-sm">
          {b.type === 'URL' ? <Link2 className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'QUICK_REPLY' ? <Reply className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'PHONE_NUMBER' ? <Phone className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'COPY_CODE' ? <Copy className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
          {b.text || (b.type === 'COPY_CODE' ? 'Copiar código' : '')}
        </div>
      ))}
      {cards.length > 0 && (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1" aria-label="Tarjetas del carrusel">
          {cards.map((card, i) => {
            const comps = card.components || []
            const header = comps.find(c => c.type === 'HEADER')
            const body = comps.find(c => c.type === 'BODY')
            const cardButtons = comps.find(c => c.type === 'BUTTONS')?.buttons || []
            const MediaIcon = header?.format === 'VIDEO' ? Film : ImageIcon
            return (
              <article key={i} className="w-52 shrink-0 snap-start overflow-hidden rounded-xl border border-white/70 bg-white shadow-sm">
                <div className="grid h-24 place-items-center bg-gray-100 text-gray-400">
                  <MediaIcon className="w-5 h-5" />
                </div>
                <p className="min-h-14 p-2.5 text-[11.5px] leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {body?.text ? <TextoWhatsapp texto={conValores(body.text, valores)} /> : <span className="italic text-gray-400">Sin texto</span>}
                </p>
                {cardButtons.map((b, j) => (
                  <div key={j} className="border-t border-gray-100 px-2 py-1.5 text-center text-[11px] font-semibold text-[#0a7cff]">
                    {b.type === 'URL' ? <Link2 className="inline w-3 h-3 mr-1" /> : <Reply className="inline w-3 h-3 mr-1" />}
                    {b.text}
                  </div>
                ))}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
