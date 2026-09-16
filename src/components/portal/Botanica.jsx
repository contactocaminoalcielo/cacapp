// Vocabulario visual de los PORTALES PÚBLICOS (los que abre una familia, no
// Orbit): papel cálido, verde de invernadero e ilustraciones botánicas dibujadas
// a mano. Vive aparte porque lo comparten el portal de la planta y el de fotos —
// si cada uno tuviera su copia, se separarían al primer retoque.
//
// **Sin iconos de librería.** Cada especie tiene su dibujo, elegido por el
// nombre del catálogo. Un ícono genérico repetido vuelve intercambiables cosas
// que la familia tiene que poder distinguir.
//
// Contrastes medidos sobre el papel (#FBF7F0): TINTA 13:1, APAGADO 5.4:1,
// HONDO 7.7:1. VERDE da 6.3:1 con blanco y por eso es el de los botones; un
// verde más claro se queda en 3.7:1 y no pasa.

export const PAPEL   = '#FBF7F0'
export const PAPEL2  = '#F1F0E6'
export const TINTA   = '#2A2620'
export const APAGADO = '#6B6257'
export const HONDO   = '#2F5D45'
export const VERDE   = '#2F6B49'
export const VIVO    = '#4E9B6E'
export const BORDE   = '#E3DDCE'
export const ORO     = '#B07D08'

// ─── Ilustraciones botánicas ─────────────────────────────────────────────────
// Se eligen por el nombre de la especie. Cualquier planta que David agregue al
// catálogo cae en el dibujo genérico, que sigue siendo una rama de verdad y no
// un ícono de librería.

/**
 * Fronda de helecho: plumosa, angosta y alta. Muchas pinnas finas inclinadas
 * hacia arriba — la silueta tiene que leerse como PLUMA desde 40px.
 */
function Helecho({ vivo }) {
  const pinnas = Array.from({ length: 14 }, (_, i) => {
    const y = 71 - i * 4.5
    const largo = 15.5 * Math.sin(Math.PI * (0.18 + 0.78 * (1 - i / 14)))
    return { y, largo, key: i }
  })
  const claro = vivo ? VIVO : '#CBC5B5'
  const oscuro = vivo ? HONDO : '#B4AC9B'
  return (
    <g>
      <path d="M32 74 C 31.2 54, 31.2 28, 32 8" fill="none"
        stroke={oscuro} strokeWidth="1.7" strokeLinecap="round" />
      {pinnas.map(({ y, largo, key }) => (
        <g key={key}>
          <path d={`M31.4 ${y} Q ${31.4 - largo * 0.62} ${y - 1.6}, ${31.4 - largo} ${y - 6.4}
                    Q ${31.4 - largo * 0.34} ${y - 2.6}, 31.4 ${y} Z`} fill={claro} />
          <path d={`M32.6 ${y} Q ${32.6 + largo * 0.62} ${y - 1.6}, ${32.6 + largo} ${y - 6.4}
                    Q ${32.6 + largo * 0.34} ${y - 2.6}, 32.6 ${y} Z`} fill={oscuro} opacity="0.88" />
        </g>
      ))}
    </g>
  )
}

/**
 * Pescadito (cactus espina de pescado): NADA de plumas. Un tallo plano, ancho y
 * carnoso, con pocos dientes grandes en zigzag. La silueta angular es lo único
 * que lo separa del helecho de un vistazo, y separarlos es justo lo que la
 * familia tiene que poder hacer.
 */
function Pescadito({ vivo }) {
  const n = 5, arriba = 15, abajo = 72
  const paso = (abajo - arriba) / n
  const ancho = i => 24 - i * 2.6

  let d = `M32 ${abajo} `
  for (let i = 0; i < n; i++) {          // sube dentando por la izquierda
    const y = abajo - i * paso
    d += `L ${32 - ancho(i)} ${y - paso * 0.78} L 30.5 ${y - paso} `
  }
  d += `L 32 ${arriba} `
  for (let i = n - 1; i >= 0; i--) {     // baja dentando por la derecha
    const y = abajo - i * paso
    d += `L ${32 + ancho(i)} ${y - paso * 0.24} L 33.5 ${y} `
  }
  d += 'Z'

  return (
    <g>
      <path d={d} fill={vivo ? VIVO : '#CBC5B5'} />
      {/* Nervadura central: la "espina" que le da el nombre */}
      <path d={`M32 ${abajo} L 32 ${arriba}`} fill="none"
        stroke={vivo ? HONDO : '#9E9584'} strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
    </g>
  )
}

/** Rama genérica, para cualquier especie que se agregue al catálogo después. */
function Rama({ vivo }) {
  const hojas = Array.from({ length: 5 }, (_, i) => {
    const y = 66 - i * 12
    const lado = i % 2 === 0 ? -1 : 1
    const largo = 19 * (1 - i / 9)
    return { y, lado, largo, key: i }
  })
  return (
    <g>
      <path d="M32 74 C 30 52, 34 28, 32 11" fill="none"
        stroke={vivo ? HONDO : '#A9A292'} strokeWidth="2.2" strokeLinecap="round" />
      {hojas.map(({ y, lado, largo, key }) => (
        <path key={key}
          d={`M32 ${y} C ${32 + lado * largo * 0.4} ${y - 1}, ${32 + lado * largo} ${y - 5}, ${32 + lado * largo} ${y - 12} C ${32 + lado * largo * 0.45} ${y - 8}, ${32 + lado * largo * 0.15} ${y - 4}, 32 ${y} Z`}
          fill={vivo ? (key % 2 ? HONDO : VIVO) : (key % 2 ? '#BDB6A6' : '#CFCabb')} />
      ))}
    </g>
  )
}

/**
 * Matera / maceta. Los extras del catálogo no siempre son plantas —una matera,
 * una placa— y dibujarles una rama es decirle a la familia que le venden algo
 * que no es. Cuando el extra tenga foto propia (`imagen_url`) manda la foto.
 */
function Matera({ vivo }) {
  const barro  = vivo ? '#B5734A' : '#CFC7B7'
  const sombra = vivo ? '#8E5433' : '#B9B0A0'
  return (
    <g>
      <path d="M17 34 L 47 34 L 42 72 Q 41.6 75, 38.5 75 L 25.5 75 Q 22.4 75, 22 72 Z" fill={barro} />
      <path d="M32 34 L 47 34 L 42 72 Q 41.6 75, 38.5 75 L 32 75 Z" fill={sombra} opacity="0.45" />
      <rect x="14.5" y="28" width="35" height="8" rx="3.2" fill={sombra} />
      <path d="M27 48 Q 32 44, 37 48" fill="none" stroke={vivo ? '#F0DCC8' : '#E4DDCE'}
        strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
    </g>
  )
}

const DIBUJOS = [
  { prueba: /helech|fern/i,            Componente: Helecho },
  { prueba: /pescad|ric.?rac|fishbone/i, Componente: Pescadito },
  { prueba: /matera|maceta|vasija|porta/i, Componente: Matera },
]

/**
 * Ilustración de una especie. `vivo` la enciende (elegida); apagada queda en los
 * grises del papel, para que la elegida se distinga sin depender solo del color
 * — hay quien no separa el verde del gris.
 */
export function Ilustracion({ nombre, vivo = false, tam = 72 }) {
  const { Componente } = DIBUJOS.find(d => d.prueba.test(nombre || '')) || { Componente: Rama }
  return (
    <svg viewBox="0 0 64 84" width={tam} height={tam * 84 / 64} aria-hidden="true"
         style={{ display: 'block', overflow: 'visible' }}>
      {/* Tierra: un arco bajo la planta, para que no flote en el aire */}
      <ellipse cx="32" cy="76" rx="17" ry="3.6" fill={vivo ? '#DCD3BE' : '#E8E3D6'} />
      <Componente vivo={vivo} />
    </svg>
  )
}

// Foco de teclado en CSS propio y no con utilidades: el anillo de Tailwind se
// pinta con box-shadow y aquí el box-shadow ya lo usan las sombras de las
// tarjetas — uno pisaría al otro y quien navega con teclado se quedaría sin
// saber dónde está. Con `outline` no compiten, y escrito a mano no depende de
// cómo se comporte `outline-2` en esta versión de Tailwind.
//
// Se EXPORTA: quien lo pinta es el <style> del marco de PlantaCliente. Vivió
// suelto aquí y la página quedó en blanco para las familias — esto no es un
// detalle interno del archivo.
export const ESTILOS = `
  .cac-foco:focus-visible { outline: 2px solid ${HONDO}; outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) {
    .cac-suave { transition-duration: 0.01ms !important; }
  }
`
