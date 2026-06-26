import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, LayoutGrid, PlusCircle, Calendar,
  Snowflake, Leaf, Layers, Camera, Package2,
  Users, Star, Heart, BarChart3, Settings, X, LogOut, Receipt, Wallet, Award, HeartPulse,
} from 'lucide-react'
import { useBadges } from '@/contexts/BadgesContext'
import { useAuth } from '@/contexts/AuthContext'
import { filterNavGroups } from '@/lib/roles'
import { SIDEBAR_SPRING } from '@/lib/motion'

const ALL_NAV_GROUPS = [
  {
    label: 'OPERACIÓN',
    items: [
      { path: '/',           label: 'Dashboard',       icon: LayoutDashboard, end: true },
      { path: '/kanban',     label: 'Tablero',          icon: LayoutGrid,      badge: 'kanban' },
      { path: '/registro',   label: 'Nuevo servicio',   icon: PlusCircle },
      { path: '/eutanasias', label: 'Eutanasias',        icon: HeartPulse },
      { path: '/calendario', label: 'Calendario',       icon: Calendar },
    ],
  },
  {
    label: 'PRODUCCIÓN',
    items: [
      { path: '/cuarto-frio',    label: 'Cuarto frío',    icon: Snowflake },
      { path: '/lotes-grupales', label: 'Lotes grupales',  icon: Package2 },
      { path: '/tenjo',          label: 'Planta Tenjo',    icon: Leaf },
      { path: '/certificados',   label: 'Certificados',    icon: Award },
      { path: '/produccion',     label: 'Producción',     icon: Layers,  badge: 'produccion' },
      { path: '/imagenes',       label: 'Imágenes',       icon: Camera,  badge: 'imagenes' },
    ],
  },
  {
    label: 'CLIENTES',
    items: [
      { path: '/gestion',      label: 'Gestión',         icon: Users },
      { path: '/nps',          label: 'NPS & Postventa',  icon: Star,  badge: 'nps' },
      { path: '/presequiales', label: 'Presequiales',     icon: Heart },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { path: '/finanzas',      label: 'Finanzas',       icon: Wallet    },
      { path: '/reportes',      label: 'Reportes',       icon: BarChart3 },
      { path: '/recibos',       label: 'Recibos',        icon: Receipt   },
      { path: '/configuracion', label: 'Configuración',  icon: Settings  },
    ],
  },
]

const BG        = '#0B1D4F'
const ACTIVE_BG = 'rgba(255,255,255,0.12)'
const HOVER_BG  = 'rgba(255,255,255,0.06)'
const TEXT_ON   = '#FFFFFF'
const TEXT_OFF  = 'rgba(255,255,255,0.55)'
const LABEL_CLR = 'rgba(255,255,255,0.25)'
const BORDER    = 'rgba(255,255,255,0.08)'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const fn = e => setIsDesktop(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return isDesktop
}

export default function Sidebar({ isOpen, onClose, collapsed = false }) {
  const badges      = useBadges()
  const isDesktop   = useIsDesktop()
  const { personalData, logout } = useAuth()
  // Visible si: en desktop no está colapsado; en móvil si está abierto.
  const visible = isDesktop ? !collapsed : isOpen

  const rol        = personalData?.rol ?? 'Coordinador'
  const navGroups  = filterNavGroups(ALL_NAV_GROUPS, rol)
  const nombreCorto = personalData
    ? `${personalData.nombre ?? ''} ${personalData.apellido ?? ''}`.trim()
    : ''

  async function handleLogout() {
    onClose()
    await logout()
  }

  return (
    <motion.nav
      className="fixed top-0 left-0 bottom-0 z-50 flex flex-col w-[240px]"
      initial={false}
      animate={{ x: visible ? 0 : -240 }}
      transition={SIDEBAR_SPRING}
      style={{ backgroundColor: BG }}
    >
      {/* Logo + close */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <motion.div
          className="flex-shrink-0"
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          <img
            src="/orbit-logo.png"
            alt="ORBIT"
            className="rounded-xl object-contain"
            style={{ width: 44, height: 44, background: 'white', padding: 3 }}
          />
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-white leading-tight tracking-wide">
            ORBIT
          </div>
          <div className="text-[10px] font-medium mt-0.5 truncate" style={{ color: LABEL_CLR }}>
            Gestión Inteligente de Servicios
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.88 }}
          className="lg:hidden w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: TEXT_OFF }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = HOVER_BG }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          <X size={16} />
        </motion.button>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {navGroups.map(group => (
          <div key={group.label}>
            <div
              className="text-[9px] font-bold tracking-[0.15em] uppercase px-3 mb-1.5 select-none"
              style={{ color: LABEL_CLR }}
            >
              {group.label}
            </div>

            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon  = item.icon
                const count = item.badge ? badges[item.badge] : 0
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end}
                    onClick={onClose}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium no-underline transition-colors duration-100"
                    style={({ isActive }) => ({
                      backgroundColor: isActive ? ACTIVE_BG : 'transparent',
                      color:           isActive ? TEXT_ON   : TEXT_OFF,
                      fontWeight:      isActive ? 600       : 500,
                    })}
                    onMouseEnter={e => {
                      if (e.currentTarget.getAttribute('aria-current') !== 'page') {
                        e.currentTarget.style.backgroundColor = HOVER_BG
                        e.currentTarget.style.color = 'rgba(255,255,255,0.85)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (e.currentTarget.getAttribute('aria-current') !== 'page') {
                        e.currentTarget.style.backgroundColor = 'transparent'
                        e.currentTarget.style.color = TEXT_OFF
                      }
                    }}
                  >
                    <Icon size={15} className="flex-shrink-0" style={{ opacity: 0.72 }} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <motion.span
                        key={count}
                        initial={{ scale: 0.7, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums leading-none"
                        style={{ backgroundColor: '#F5C842', color: '#0B1D4F' }}
                      >
                        {count}
                      </motion.span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Usuario + Logout */}
      <div style={{ borderTop: `1px solid ${BORDER}` }}>
        {personalData && (
          <div className="px-4 py-3 flex items-center gap-3">
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
              style={{ backgroundColor: '#1A5CD8', color: '#FFFFFF' }}
            >
              {nombreCorto.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-white truncate">{nombreCorto}</div>
              <div className="text-[10px]" style={{ color: LABEL_CLR }}>{rol}</div>
            </div>
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={handleLogout}
              title="Cerrar sesión"
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
              style={{ color: TEXT_OFF }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,60,60,0.15)'; e.currentTarget.style.color = '#FCA5A5' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = TEXT_OFF }}
            >
              <LogOut size={14} />
            </motion.button>
          </div>
        )}
        <div className="px-5 pb-3">
          <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.15)' }}>
            ORBIT v2.0 · © 2026
          </div>
        </div>
      </div>
    </motion.nav>
  )
}
