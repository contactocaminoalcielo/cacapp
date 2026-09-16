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
// Misma paleta que los portales de fotos, planta y visita: es la misma familia
// mirando la misma marca.
import { SECCIONES, RESPONSABLE, VERSION, VIGENTE_DESDE } from '@/lib/privacidad'
import { ESTILOS, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, BORDE } from '@/components/portal/Botanica'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-09-16' → '16 de septiembre de 2026', sin cruzar por UTC. */
function fechaLarga(iso) {
  const d = new Date(`${iso}T12:00:00`)
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

export default function Privacidad() {
  return (
    <div className="min-h-screen" style={{ background: PAPEL, color: TINTA }}>
      <style>{ESTILOS}</style>

      <header className="px-4 pt-10 pb-6" style={{ background: PAPEL2, borderBottom: `1px solid ${BORDE}` }}>
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          <p className="text-[12px] font-bold tracking-wide uppercase" style={{ color: HONDO }}>
            {RESPONSABLE.comercial}
          </p>
          <h1 className="font-serif italic leading-tight mt-1" style={{ fontSize: 30, color: HONDO }}>
            Política de Tratamiento de Datos Personales
          </h1>
          <p className="text-[13px] mt-3" style={{ color: APAGADO }}>
            {RESPONSABLE.razon} · NIT {RESPONSABLE.nit}
          </p>
          <p className="text-[13px]" style={{ color: APAGADO }}>
            Versión {VERSION} · vigente desde el {fechaLarga(VIGENTE_DESDE)}
          </p>
        </div>
      </header>

      <main className="px-4 py-8">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          {SECCIONES.map((s, i) => (
            <section key={s.t} className={i === 0 ? '' : 'mt-8'}>
              <h2 className="font-serif italic leading-tight mb-3" style={{ fontSize: 22, color: HONDO }}>
                {s.t}
              </h2>
              {(s.p || []).map((t, j) => (
                <p key={j} className="text-[15px] leading-relaxed mb-3">{t}</p>
              ))}
              {s.l && (
                <ul className="mb-3 space-y-2">
                  {s.l.map((t, j) => (
                    <li key={j} className="text-[15px] leading-relaxed flex gap-2">
                      <span aria-hidden="true" style={{ color: HONDO }}>·</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(s.p2 || []).map((t, j) => (
                <p key={j} className="text-[15px] leading-relaxed mb-3">{t}</p>
              ))}
            </section>
          ))}

          <footer className="mt-10 pt-6 text-[13px]" style={{ borderTop: `1px solid ${BORDE}`, color: APAGADO }}>
            <p>
              {RESPONSABLE.razon} · NIT {RESPONSABLE.nit} · {RESPONSABLE.direccion}, {RESPONSABLE.ciudad}
            </p>
            <p className="mt-1">
              <a className="cac-foco underline" style={{ color: HONDO }} href={`mailto:${RESPONSABLE.email}`}>
                {RESPONSABLE.email}
              </a>
              {' · WhatsApp '}{RESPONSABLE.whatsapp}
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
