import { Star } from 'lucide-react'

/**
 * Mascotas que llegan de una veterinaria VIP.
 *
 * El VIP vive en `aliados.vip` (booleano) y llega a la interfaz con formas
 * distintas según de dónde salgan los datos: la vista `v_kanban` lo expone
 * aplanado como `aliado_vip`, y las páginas que consultan `servicios` lo traen
 * anidado en el join (`aliados.vip`). Un solo helper entiende las dos, para que
 * ningún módulo tenga que acordarse de cuál le toca — y para que el día que se
 * agregue un tercer origen se arregle en un solo lugar.
 */
export function esAliadoVip(x) {
  if (!x) return false
  if (typeof x === 'boolean') return x
  return x.aliado_vip === true      // fila de v_kanban (aplanada)
      || x.aliados?.vip === true    // servicio con join a aliados
      || x.aliado?.vip === true     // detalle que cargó el aliado aparte
}

/**
 * Oro del VIP. Vive aquí y no suelto en cada página: es una marca de negocio y
 * tiene que verse IGUAL en coordinación, producción y en cualquier ficha — si
 * cada módulo elige su propio dorado, deja de leerse como "esto es VIP" y pasa
 * a leerse como "esta pantalla es distinta".
 *
 * El fondo es deliberadamente suave: la tarjeta tiene que seguir siendo legible
 * y no competir con los avisos operativos (vencido, sin fotos), que son urgentes
 * y mandan sobre el color. El oro dice QUIÉN es; el rojo dice QUÉ pasa.
 */
export const VIP_ORO = {
  bg:       '#FDF8EC',
  borde:    '#E3C97B',
  texto:    '#8A6A16',
  estrella: '#D4A72C',
}

/**
 * Estrella de VIP. Se muestra SIEMPRE, incluso cuando un aviso operativo se
 * queda con el color de la tarjeta: perder la marca de VIP porque además el
 * servicio va tarde sería justo al revés de lo que se necesita.
 */
export function VipStar({ size = 13, className = '', title = 'Mascota de veterinaria VIP' }) {
  return (
    <Star
      size={size}
      title={title}
      aria-label={title}
      className={`flex-shrink-0 ${className}`}
      style={{ color: VIP_ORO.estrella, fill: VIP_ORO.estrella }}
    />
  )
}

/**
 * Chip con estrella + texto, para cabeceras de detalle donde hay sitio para
 * explicar la marca (en una tarjeta apretada basta con `VipStar`).
 */
export function VipBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}
      style={{ background: VIP_ORO.bg, color: VIP_ORO.texto, border: `1px solid ${VIP_ORO.borde}` }}
      title="Esta mascota llega de una veterinaria VIP">
      <VipStar size={11} />
      VIP
    </span>
  )
}
