// CRM comercial de veterinarias. Es parte de Orbit (misma sesión, mismos
// datos) pero se ve como un sistema aparte: su propio menú, su propio color.
// Se entra desde el menú de Orbit; el rol COMERCIAL aterriza aquí directo.
import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard, CalendarClock, Building2, Target, LifeBuoy, MessageCircle, Award,
  FolderOpen, ClipboardList, Settings, ArrowLeft, LogOut, Menu, X, Bell, MapPin, Megaphone,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { CrmProvider, useCrm } from '@/components/crm/CrmContext'
import { Cargando } from '@/components/crm/ui'
import { permisoNotifs, pedirPermisoNotifs, notifsSoportadas } from '@/lib/deviceNotifications'

const Inicio        = lazy(() => import('./Inicio'))
const Agenda        = lazy(() => import('./Agenda'))
const Cartera       = lazy(() => import('./Cartera'))
const FichaVet      = lazy(() => import('./FichaVeterinaria'))
const Prospectos    = lazy(() => import('./Prospectos'))
const FichaProsp    = lazy(() => import('./FichaProspecto'))
const Tickets       = lazy(() => import('./Tickets'))
const Bandeja       = lazy(() => import('./Bandeja'))
const Hitos         = lazy(() => import('./Hitos'))
const Recursos      = lazy(() => import('./Recursos'))
const Servicios     = lazy(() => import('./Servicios'))
const Ajustes       = lazy(() => import('./Ajustes'))
const Visitas       = lazy(() => import('./Visitas'))
const Campanas      = lazy(() => import('./Campanas'))

const MENU = [
  { to: '/crm',              label: 'Inicio',          icon: LayoutDashboard, end: true },
  { to: '/crm/agenda',       label: 'Agenda',          icon: CalendarClock, badge: 'agenda' },
  { to: '/crm/visitas',      label: 'Visitas',         icon: MapPin },
  { to: '/crm/campanas',     label: 'Campañas',        icon: Megaphone },
  { to: '/crm/veterinarias', label: 'Veterinarias',    icon: Building2 },
  { to: '/crm/prospectos',   label: 'Prospectos',      icon: Target },
  { to: '/crm/tickets',      label: 'Tickets / PQRS',  icon: LifeBuoy, badge: 'tickets' },
  { to: '/crm/bandeja',      label: 'WhatsApp vets',   icon: MessageCircle },
  { to: '/crm/hitos',        label: 'Hitos y gracias', icon: Award, badge: 'hitos' },
  { to: '/crm/recursos',     label: 'Recursos y plantillas', icon: FolderOpen },
  { to: '/crm/servicios',    label: 'Servicios (consulta)', icon: ClipboardList },
  { to: '/crm/ajustes',      label: 'Ajustes',         icon: Settings },
]

const FONDO = 'linear-gradient(180deg, #06302E 0%, #0A1F3D 100%)'
const ORO = '#F5C842'

function Menu_({ onNavegar }) {
  const { alertas } = useCrm()
  const { personalData, logout } = useAuth()
  const vencidos = (alertas.seguimientos || []).filter(s => new Date(s.programado_para) <= new Date()).length
  const badges = { agenda: vencidos, tickets: alertas.tickets_vencidos || 0, hitos: alertas.hitos_por_enviar || 0 }
  const esComercial = personalData?.rol === 'COMERCIAL'

  return (
    <nav aria-label="Menú del CRM" className="h-full flex flex-col text-white" style={{ background: FONDO }}>
      <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
        <img src="/orbit-logo.png" alt="" className="w-10 h-10 rounded-xl bg-white p-1" />
        <div className="min-w-0">
          <div className="text-[14px] font-bold tracking-wide">ORBIT <span style={{ color: ORO }}>Comercial</span></div>
          <div className="text-[10px] text-white/50">CRM de veterinarias aliadas</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {MENU.map(it => {
          const Icono = it.icon
          const n = it.badge ? badges[it.badge] : 0
          return (
            <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavegar}
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium no-underline transition
                ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:text-white hover:bg-white/6'}`}
              style={({ isActive }) => isActive ? { background: 'rgba(20,184,166,0.22)', boxShadow: 'inset 3px 0 0 ' + ORO } : undefined}>
              <Icono size={15} className="flex-shrink-0" />
              <span className="flex-1 truncate">{it.label}</span>
              {n > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums"
                  style={{ background: ORO, color: '#0B1D4F' }}>{n}</span>
              )}
            </NavLink>
          )
        })}
      </div>
      <div className="border-t border-white/10 p-2.5 space-y-0.5">
        <Link to={esComercial ? '/gestion' : '/'} onClick={onNavegar}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-medium text-white/70 hover:text-white hover:bg-white/6 no-underline">
          <ArrowLeft size={14} /> {esComercial ? 'Consultar Gestión en Orbit' : 'Volver a Orbit'}
        </Link>
        <button onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-medium text-white/70 hover:text-white hover:bg-white/6">
          <LogOut size={14} /> Cerrar sesión
        </button>
        {personalData && (
          <div className="px-3 pt-1 text-[11px] text-white/45 truncate">
            {`${personalData.nombre || ''} ${personalData.apellido || ''}`.trim()} · {String(personalData.rol || '').toLowerCase()}
          </div>
        )}
      </div>
    </nav>
  )
}

function AvisoNotificaciones() {
  const [estado, setEstado] = useState(() => permisoNotifs())
  if (!notifsSoportadas() || estado !== 'default') return null
  return (
    <button onClick={async () => setEstado(await pedirPermisoNotifs())}
      className="hidden sm:inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1.5">
      <Bell size={13} /> Activar avisos de llamadas
    </button>
  )
}

function Barra({ onMenu }) {
  const { alertas } = useCrm()
  const vencidos = (alertas.seguimientos || []).filter(s => new Date(s.programado_para) <= new Date())
  return (
    <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100 h-14 flex items-center gap-3 px-4">
      <button className="lg:hidden w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center" onClick={onMenu} aria-label="Abrir menú">
        <Menu size={18} />
      </button>
      <div className="flex-1" />
      <AvisoNotificaciones />
      <Link to="/crm/agenda" className="relative w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
        title={vencidos.length ? `${vencidos.length} seguimiento(s) por hacer` : 'Agenda'}>
        <Bell size={17} />
        {vencidos.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[17px] h-[17px] px-1 flex items-center justify-center">
            {vencidos.length}
          </span>
        )}
      </Link>
    </div>
  )
}

function Contenido() {
  const [abierto, setAbierto] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setAbierto(false) }, [pathname])

  return (
    <div className="min-h-screen flex bg-[#F4F7F6]">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[236px] z-40"><Menu_ /></aside>
      {abierto && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-[260px] h-full relative">
            <Menu_ onNavegar={() => setAbierto(false)} />
            <button onClick={() => setAbierto(false)} className="absolute top-4 right-3 text-white/70" aria-label="Cerrar menú"><X size={18} /></button>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setAbierto(false)} />
        </div>
      )}
      <div className="flex-1 min-w-0 lg:ml-[236px] flex flex-col">
        <Barra onMenu={() => setAbierto(true)} />
        <main className="flex-1 p-4 sm:p-6 min-w-0">
          <Suspense fallback={<Cargando />}>
            <Routes>
              <Route index element={<Inicio />} />
              <Route path="agenda" element={<Agenda />} />
              <Route path="veterinarias" element={<Cartera />} />
              <Route path="veterinarias/:id" element={<FichaVet />} />
              <Route path="prospectos" element={<Prospectos />} />
              <Route path="prospectos/:id" element={<FichaProsp />} />
              <Route path="tickets" element={<Tickets />} />
              <Route path="tickets/:id" element={<Tickets />} />
              <Route path="bandeja" element={<Bandeja />} />
              <Route path="hitos" element={<Hitos />} />
              <Route path="recursos" element={<Recursos />} />
              <Route path="servicios" element={<Servicios />} />
              <Route path="visitas" element={<Visitas />} />
              <Route path="campanas" element={<Campanas />} />
              <Route path="ajustes" element={<Ajustes />} />
              <Route path="*" element={<Navigate to="/crm" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default function CrmApp() {
  return (
    <CrmProvider>
      <Contenido />
    </CrmProvider>
  )
}
