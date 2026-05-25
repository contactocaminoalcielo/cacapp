import { useLocation } from 'react-router-dom'

const PAGE_META = {
  '/':             { title: 'Dashboard',              sub: 'Resumen operacional' },
  '/kanban':       { title: 'Tablero de servicios',   sub: 'Seguimiento en tiempo real' },
  '/registro':     { title: 'Nuevo servicio',         sub: 'Registro paso a paso' },
  '/calendario':   { title: 'Calendario',             sub: 'Fechas límite por servicio' },
  '/cuarto-frio':  { title: 'Cuarto frío',            sub: 'Control de ingreso y ubicación' },
  '/tenjo':        { title: 'Planta Tenjo',           sub: 'Traslados y procesos individuales' },
  '/produccion':   { title: 'Producción',             sub: 'Cola de recordatorios' },
  '/imagenes':     { title: 'Imágenes',               sub: 'Solicitudes y recepción de fotos' },
  '/gestion':      { title: 'Gestión',                sub: 'Clientes, mascotas, aliados y personal' },
  '/nps':          { title: 'NPS & Postventa',        sub: 'Seguimiento post-entrega' },
  '/reportes':     { title: 'Reportes',               sub: 'Análisis operacional y financiero' },
  '/presequiales': { title: 'Planes presequiales',    sub: 'Afiliaciones anticipadas' },
  '/configuracion':{ title: 'Configuración',          sub: 'Planes, recordatorios y catálogos' },
}

export default function Topbar({ actions }) {
  const { pathname } = useLocation()
  const { title, sub } = PAGE_META[pathname] ?? PAGE_META['/']

  const dateStr = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <header
      className="sticky top-14 z-40 bg-white flex items-center px-4 sm:px-6 gap-4"
      style={{
        height: 56,
        borderBottom: '1px solid #F0F2F0',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex flex-col justify-center">
        <span className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</span>
        {sub && (
          <span className="text-[11px] text-gray-400 leading-tight font-medium">{sub}</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {actions}
        <span className="text-[11px] text-gray-400 font-medium hidden lg:block capitalize">
          {dateStr}
        </span>
      </div>
    </header>
  )
}
