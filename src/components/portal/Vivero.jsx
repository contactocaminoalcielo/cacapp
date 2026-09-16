// ─────────────────────────────────────────────────────────────────────────────
// VIVERO — la piel del portal donde una familia elige la planta de su mascota.
//
// El portal nació con papel crema, Playfair itálica y un verde encima. Eso, en
// 2026, es exactamente el aspecto que produce cualquier generador: fondo crema
// + serif de alto contraste + acento cálido. David lo dijo con otras palabras
// ("se ve genérico de IA") y tenía razón. Esto es lo contrario de un tema
// genérico: sale del sitio real donde termina el proceso —un vivero de la
// sabana de Bogotá a primera hora— y de nada más.
//
// Qué se tomó de ahí:
//   · La LUZ, no el papel. El fondo es la bruma verde del amanecer con el sol
//     entrando de lado; se mueve, muy despacio, como se mueve esa luz.
//   · El VIDRIO del invernadero. Aquí la transparencia significa algo: se mira
//     la planta a través del vidrio. Por eso los paneles son vidrio y no
//     tarjetas blancas con sombra.
//   · La planta CRECE al abrir. Un solo gesto orquestado en toda la pantalla
//     —el resto está quieto— y es el gesto que cuenta lo que pasó: la mascota
//     vuelve en forma de planta.
//
// ⚠️ Esto contradice a propósito la regla de vidrio de Orbit
// ([[diseno_vidrio_orbit]]: "vidrio SOLO en el marco, nunca en el dato"). Esa
// regla protege pantallas densas de datos, donde la transparencia estorba la
// lectura. Aquí el "dato" son dos plantas y un formulario corto, y el vidrio es
// el material del tema. Los pisos de contraste NO se relajan: van medidos abajo.
//
// Vive aparte de Botanica.jsx a propósito: allí están las ILUSTRACIONES, que
// comparten los tres portales; aquí está la piel, que por ahora es solo de este.
import { useEffect } from 'react'

// ─── Paleta ──────────────────────────────────────────────────────────────────
// Contrastes medidos sobre el fondo real (bruma #EAF1E8), no a ojo:
//   TINTA 11.9:1 · SELVA 10.7:1 · MUSGO 6.1:1 (5.1:1 en el borde bajo del
//   degradado, que es donde peor se porta) · MIEL 5.7:1 sobre vidrio
//   BROTE da 5.1:1 con texto blanco encima → sirve para botones.
// 🪤 El oro viejo del precio (#B07D08) daba 3.7:1 sobre blanco y NO pasaba AA
// en 15px; MIEL es el mismo oro bajado hasta pasar.
export const BRUMA  = '#EAF1E8'   // fondo, arriba
export const SABANA = '#D3E2D7'   // fondo, abajo
export const CAMPO  = '#F7FBF7'   // dentro de un campo de formulario
export const TINTA  = '#1B3326'   // texto principal — verde casi negro, no gris
export const SELVA  = '#16382A'   // titulares
export const MUSGO  = '#44614F'   // texto secundario
export const BROTE  = '#2E7D51'   // acción (botones)
export const HOJA   = '#58A97A'   // seleccionado — señal, nunca texto
export const LINDE  = '#C3D6C8'   // bordes
export const MIEL   = '#8A5F06'   // precios

// ─── Tipografía ──────────────────────────────────────────────────────────────
// Fraunces (titulares) y Karla (texto) se cargan DESDE AQUÍ y no desde
// index.html: son de este portal, y meterlas en el index se las cobraría a
// Orbit entero, que no las usa. Fraunces es variable y trae los ejes SOFT y
// WONK —trazo blando y cursiva rota—, que es lo que le quita el aire de
// "serif de plantilla" sin caer en la itálica de antes.
const FUENTES = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..600,0..100,0..1&family=Karla:wght@400;500;600;700&display=swap'

/** Cuelga el <link> de fuentes una sola vez, aunque monten dos portales. */
export function useFuentesVivero() {
  useEffect(() => {
    if (document.getElementById('vv-fuentes')) return
    const l = document.createElement('link')
    l.id = 'vv-fuentes'
    l.rel = 'stylesheet'
    l.href = FUENTES
    document.head.appendChild(l)
  }, [])
}

// ─── Estilos ─────────────────────────────────────────────────────────────────
// Van como <style> dentro del portal (igual que ESTILOS en Botanica): esta
// pantalla se sirve sin sesión y no comparte hoja con el Orbit interno.
export const ESTILOS_VIVERO = `
  .vv-titular { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto;
                font-variation-settings: 'SOFT' 60, 'WONK' 1; letter-spacing: -0.015em;
                font-weight: 500; }
  .vv-firma   { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 90, 'WONK' 1; }
  .vv-cuerpo  { font-family: 'Karla', ui-sans-serif, system-ui, sans-serif; }

  /* El vidrio del invernadero. Blanco 0.72: por debajo de 0.66 el texto
     secundario (MUSGO) cae de 4.5:1 sobre el fondo oscuro del gradiente. */
  .vv-vidrio {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(14px) saturate(135%);
    -webkit-backdrop-filter: blur(14px) saturate(135%);
    border: 1px solid rgba(255,255,255,0.85);
    box-shadow: 0 18px 40px -28px rgba(18,48,33,0.55);
  }
  .vv-vidrio-hondo { background: rgba(255,255,255,0.84); }
  /* Sin backdrop-filter (navegador viejo, o Android de gama baja que lo apaga)
     el panel se vuelve sólido. Un panel translúcido SIN difuminar es texto
     sobre ruido. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .vv-vidrio, .vv-vidrio-hondo { background: #FBFDFA; }
  }

  .vv-foco:focus-visible { outline: 2px solid ${SELVA}; outline-offset: 3px; }

  /* ── El único gesto no pedido de la pantalla ──
     La planta crece desde el suelo al abrir. Una vez, a la entrada. */
  .vv-brota { animation: vv-brotar 1100ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
              transform-origin: 50% 100%; }
  @keyframes vv-brotar {
    from { clip-path: inset(100% 0 0 0); transform: scaleY(0.92); opacity: 0.4; }
    to   { clip-path: inset(0 0 0 0);    transform: scaleY(1);    opacity: 1; }
  }
  .vv-entra { animation: vv-asomar 620ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  @keyframes vv-asomar { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }

  /* La luz del amanecer cruzando el invernadero: 72 s por pasada. Si se nota,
     está mal hecha. */
  .vv-luz { animation: vv-derivar 72s ease-in-out infinite alternate; }
  @keyframes vv-derivar {
    from { transform: translate3d(-7%, -4%, 0) scale(1) }
    to   { transform: translate3d(9%, 7%, 0) scale(1.14) }
  }

  @media (prefers-reduced-motion: reduce) {
    .vv-suave { transition-duration: 0.01ms !important; }
    .vv-brota, .vv-entra, .vv-luz { animation: none !important; }
    .vv-brota { clip-path: none; opacity: 1; transform: none }
  }
`

// ─── Fondo ───────────────────────────────────────────────────────────────────
/**
 * Tres capas fijas detrás de todo: la bruma, la luz que deriva y el grano.
 *
 * El grano es un `feTurbulence` en un data URI al 3,5 %: es lo que impide que
 * el degradado se vea como un degradado de plantilla. Va como imagen y no como
 * filtro CSS — un filtro sobre toda la pantalla se recalcularía en cada scroll
 * y esto lo abre un celular de gama baja ([[feedback_mobile_image_oom]]).
 */
export function FondoVivero() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden"
      style={{ background: `linear-gradient(180deg, ${BRUMA} 0%, #E1ECE2 46%, ${SABANA} 100%)` }}>
      <div className="vv-luz absolute -inset-[20%]"
        style={{ background: 'radial-gradient(42% 32% at 32% 18%, rgba(255,246,219,0.92) 0%, rgba(255,246,219,0) 70%)' }} />
      <div className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 60% at 50% 120%, rgba(22,56,42,0.14) 0%, rgba(22,56,42,0) 60%)' }} />
      <div className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E")` }} />
    </div>
  )
}

/**
 * La planta creciendo desde el suelo.
 *
 * La ilustración ya trae su propia tierra, así que aquí NO va otra línea de
 * suelo: dos suelos bajo la misma planta se leen como un separador de sección.
 * `retraso` existe para escalonar si algún día crecen dos a la vez.
 */
export function Brota({ children, retraso = 0, alinear = 'center', className = '' }) {
  return (
    <div className={`flex flex-col ${className}`} style={{ alignItems: alinear }}>
      <div className="vv-brota" style={{ animationDelay: `${retraso}ms` }}>{children}</div>
    </div>
  )
}
