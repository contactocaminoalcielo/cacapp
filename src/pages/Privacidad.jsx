// Política de Tratamiento de Datos Personales — página pública (/privacidad).
//
// Es la que enlazan todas las casillas de autorización. Se abre SIN sesión y sin
// código: una familia tiene que poder leer qué autorizó aunque ya no tenga el
// enlace de su servicio, y un juez o la SIC tienen que poder verla sin pedirnos
// nada.
//
// El texto no vive aquí: vive en lib/privacidad.js, que es lo que también firma
// la versión guardada con cada autorización. Esta pantalla solo lo pinta.
//
// Va con el lenguaje de ORBIT (azul marino, Nunito, tarjetas blancas sobre
// #F4F7FF), no con la paleta de los portales de la familia: esto no es una
// pantalla de duelo, es el documento legal de la empresa.
import { SECCIONES, RESPONSABLE, VERSION, VIGENTE_DESDE } from '@/lib/privacidad'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-09-17' → '17 de septiembre de 2026', sin cruzar por UTC. */
function fechaLarga(iso) {
  const d = new Date(`${iso}T12:00:00`)
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

/** Ancla estable por título, para que el índice lateral no dependa del orden. */
const anclaDe = t => t
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')

export default function Privacidad() {
  return (
    <div className="min-h-screen bg-background">
      {/* Cabecera con la marca: el mismo azul del login y del menú */}
      <header
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg, #060E2B 0%, #0B1D4F 55%, #091428 100%)' }}
      >
        <div
          className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(26,92,216,0.22) 0%, transparent 65%)' }}
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="flex items-center gap-3 mb-6">
            <img
              src="/orbit-logo.png"
              alt=""
              className="rounded-xl"
              style={{ width: 40, height: 40, background: 'white', padding: 5 }}
            />
            <div className="leading-tight">
              <p className="text-white font-bold text-[15px]">Camino al Cielo</p>
              <p className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: '#7B93C4' }}>
                Funeraria para mascotas
              </p>
            </div>
          </div>

          <h1 className="text-white font-bold leading-tight text-[26px] sm:text-[32px]">
            Política de Tratamiento de Datos Personales
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span
              className="text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(26,92,216,0.22)', color: '#BFD4FF', border: '1px solid rgba(26,92,216,0.45)' }}
            >
              Versión {VERSION}
            </span>
            <span className="text-[12px]" style={{ color: '#7B93C4' }}>
              Vigente desde el {fechaLarga(VIGENTE_DESDE)}
            </span>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed" style={{ color: '#A9BEE4' }}>
            {RESPONSABLE.razon} · NIT {RESPONSABLE.nit}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Índice: el documento es largo y casi siempre se entra buscando una cosa */}
        <nav aria-label="Contenido" className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 mb-6">
          <p className="text-[11px] font-bold tracking-wide uppercase mb-3" style={{ color: '#7B93C4' }}>
            Contenido
          </p>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {SECCIONES.map((s, i) => (
              <li key={s.t} className="flex gap-2 text-[13px] leading-snug">
                <span className="tabular-nums font-bold" style={{ color: '#7B93C4' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <a
                  href={`#${anclaDe(s.t)}`}
                  className="font-semibold hover:underline"
                  style={{ color: '#1A5CD8' }}
                >
                  {s.t}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-4">
          {SECCIONES.map((s, i) => (
            <section
              key={s.t}
              id={anclaDe(s.t)}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 sm:p-6 scroll-mt-4"
            >
              <div className="flex items-baseline gap-3 mb-4">
                <span
                  className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md shrink-0"
                  style={{ background: '#EEF3FF', color: '#1A5CD8' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h2 className="font-bold text-[17px] leading-tight" style={{ color: '#0B1D4F' }}>
                  {s.t}
                </h2>
              </div>

              {(s.p || []).map((t, j) => (
                <p key={j} className="text-[14px] leading-relaxed text-gray-700 mb-3 last:mb-0">{t}</p>
              ))}

              {s.l && (
                <ul className="my-3 space-y-2">
                  {s.l.map((t, j) => (
                    <li key={j} className="flex gap-2.5 text-[14px] leading-relaxed text-gray-700">
                      <span
                        aria-hidden="true"
                        className="mt-[7px] shrink-0 rounded-full"
                        style={{ width: 5, height: 5, background: '#93C5FD' }}
                      />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}

              {(s.p2 || []).map((t, j) => (
                <p key={j} className="text-[14px] leading-relaxed text-gray-700 mb-3 last:mb-0">{t}</p>
              ))}
            </section>
          ))}
        </div>

        {/* Los datos de contacto, repetidos al cierre: es lo que alguien viene a buscar */}
        <footer className="mt-6 bg-white rounded-xl border border-gray-100 shadow-sm p-5 sm:p-6">
          <p className="text-[11px] font-bold tracking-wide uppercase mb-3" style={{ color: '#7B93C4' }}>
            Para ejercer sus derechos
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px] text-gray-700">
            <div>
              <p className="font-semibold" style={{ color: '#0B1D4F' }}>{RESPONSABLE.razon}</p>
              <p>NIT {RESPONSABLE.nit}</p>
              <p className="text-gray-500">Nombre comercial: {RESPONSABLE.comercial}</p>
            </div>
            <div>
              <p>{RESPONSABLE.direccion}</p>
              <p>{RESPONSABLE.ciudad}</p>
            </div>
            <div>
              <a href={`mailto:${RESPONSABLE.email}`} className="font-semibold hover:underline" style={{ color: '#1A5CD8' }}>
                {RESPONSABLE.email}
              </a>
            </div>
            <div>
              <p>WhatsApp {RESPONSABLE.whatsapp}</p>
              <p className="text-gray-500">{RESPONSABLE.web}</p>
            </div>
          </div>
          <p className="mt-4 pt-4 border-t border-gray-100 text-[11.5px] text-gray-400 leading-relaxed">
            Ley 1581 de 2012 · Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015 ·
            Versión {VERSION}, vigente desde el {fechaLarga(VIGENTE_DESDE)}.
          </p>
        </footer>
      </main>
    </div>
  )
}
