import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  LayoutDashboard, LayoutGrid, PlusCircle, Calendar,
  Snowflake, Leaf, Layers, Camera, Package2,
  Users, Star, Heart, BarChart3, Settings, X, LogOut, Receipt, Wallet, Award, HeartPulse, Film, Tag,
  MessageCircle, Bot, FileText, SquareStack, Paperclip } from 'lucide-react'
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
      { path: '/whatsapp',     label: 'WhatsApp',         icon: MessageCircle, badge: 'whatsapp' },
      { path: '/agente-whatsapp', label: 'Agente WA',     icon: Bot },
      { path: '/plantillas-whatsapp', label: 'Plantillas WA', icon: FileText },
      { path: '/interactivos-whatsapp', label: 'Botones y menús', icon: SquareStack },
      { path: '/materiales-whatsapp', label: 'Materiales WA', icon: Paperclip },
      { path: '/gestion',      label: 'Gestión',         icon: Users },
      { path: '/nps',          label: 'NPS & Postventa',  icon: Star,  badge: 'nps' },
      { path: '/digitales',    label: 'Digitales',        icon: Film },
      { path: '/ofertas',      label: 'Ofertas',          icon: Tag },
      { path: '/presequiales', label: 'Pre-Exequiales',     icon: Heart },
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

const GOLD      = '#F5C842'
const TEXT_ON   = '#FFFFFF'
const TEXT_OFF  = 'rgba(255,255,255,0.72)'
const LABEL_CLR = 'rgba(255,255,255,0.42)'
const BORDER    = 'rgba(255,255,255,0.09)'

// Pastilla del ítem activo: se desplaza de un ítem a otro con `layoutId` en vez
// de aparecer y desaparecer. Es la única animación "grande" del menú.
const PILL_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }

// Entrada escalonada de los ítems (solo al montar el menú, una vez por sesión)
const navContainerVariants = { animate: { transition: { staggerChildren: 0.028, delayChildren: 0.04 } } }
const navItemVariants = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] } },
}

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
  const sinMovimiento = useReducedMotion()   // respeta "reducir movimiento" del sistema
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
      aria-label="Menú principal"
      className="sidebar-glass fixed top-0 left-0 bottom-0 z-50 flex flex-col w-[240px] overflow-hidden"
      initial={false}
      animate={{ x: visible ? 0 : -240 }}
      transition={SIDEBAR_SPRING}
    >
      {/* Aurora: dos manchas de luz de marca detrás del vidrio. Es lo que hace
          que el panel se lea como vidrio y no como un bloque azul plano. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
        background:
          'radial-gradient(120% 55% at 0% 0%,   rgba(26,92,216,0.42) 0%, transparent 62%),' +
          'radial-gradient(95% 45% at 100% 100%, rgba(245,200,66,0.13) 0%, transparent 65%)',
      }} />
      {/* Filo superior iluminado — el brillo del borde del vidrio */}
      <div aria-hidden className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)',
      }} />

      {/* Logo + cerrar */}
      <div className="relative flex items-center gap-3 px-4 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <motion.div
          className="flex-shrink-0"
          whileHover={sinMovimiento ? undefined : { scale: 1.06, rotate: -2 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        >
          <img
            src="/orbit-logo.png"
            alt="ORBIT"
            className="rounded-xl object-contain"
            style={{
              width: 44, height: 44, background: 'white', padding: 3,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.16), 0 8px 20px rgba(11,29,79,0.45)',
            }}
          />
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold leading-tight tracking-wide" style={{
            background: `linear-gradient(90deg, ${TEXT_ON} 30%, ${GOLD} 140%)`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>
            ORBIT
          </div>
          <div className="text-[10px] font-medium mt-0.5 truncate" style={{ color: LABEL_CLR }}>
            Gestión Inteligente de Servicios
          </div>
        </div>
        <motion.button
          whileTap={sinMovimiento ? undefined : { scale: 0.88 }}
          className="nav-link lg:hidden w-7 h-7 flex items-center justify-center rounded-lg"
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          <X size={16} />
        </motion.button>
      </div>

      {/* Navegación */}
      <motion.div
        className="nav-scroll relative flex-1 overflow-y-auto py-4 px-3 space-y-5"
        variants={sinMovimiento ? undefined : navContainerVariants}
        initial={sinMovimiento ? false : 'initial'}
        animate="animate"
      >
        {navGroups.map(group => (
          <div key={group.label}>
            {/* Etiqueta del grupo + hairline que rellena el ancho sobrante */}
            <div className="flex items-center gap-2 px-3 mb-1.5 select-none">
              <span className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: LABEL_CLR }}>
                {group.label}
              </span>
              <span aria-hidden className="flex-1 h-px" style={{
                background: 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)',
              }} />
            </div>

            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon  = item.icon
                const count = item.badge ? badges[item.badge] : 0
                return (
                  <motion.div key={item.path} variants={sinMovimiento ? undefined : navItemVariants}>
                    <NavLink
                      to={item.path}
                      end={item.end}
                      onClick={onClose}
                      className="nav-link relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium no-underline"
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <motion.span
                              aria-hidden
                              layoutId={sinMovimiento ? undefined : 'nav-activo'}
                              transition={PILL_SPRING}
                              className="absolute inset-0 rounded-xl overflow-hidden"
                              style={{
                                background: 'linear-gradient(90deg, rgba(26,92,216,0.60) 0%, rgba(26,92,216,0.14) 100%)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
                              }}
                            >
                              {/* Riel dorado: marca dónde está parado sin depender solo del color de fondo */}
                              <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{
                                background: GOLD, boxShadow: `0 0 10px ${GOLD}99`,
                              }} />
                            </motion.span>
                          )}
                          <Icon size={15} className="nav-icon relative flex-shrink-0" />
                          <span className="relative flex-1 truncate" style={{ fontWeight: isActive ? 600 : 500 }}>
                            {item.label}
                          </span>
                          {count > 0 && (
                            <motion.span
                              key={count}
                              initial={sinMovimiento ? false : { scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                              className="relative text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums leading-none"
                              style={{ backgroundColor: GOLD, color: '#0B1D4F', boxShadow: `0 0 12px ${GOLD}55` }}
                            >
                              {count}
                            </motion.span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </motion.div>
                )
              })}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Usuario + salir */}
      <div className="relative" style={{ borderTop: `1px solid ${BORDER}` }}>
        {personalData && (
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl" style={{
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`,
            }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #1A5CD8, #0B1D4F)',
                  color: TEXT_ON, boxShadow: '0 0 0 1px rgba(255,255,255,0.18)',
                }}
              >
                {nombreCorto.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white truncate">{nombreCorto}</div>
                <div className="text-[10px] truncate" style={{ color: LABEL_CLR }}>{rol}</div>
              </div>
              <motion.button
                whileTap={sinMovimiento ? undefined : { scale: 0.88 }}
                onClick={handleLogout}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
                style={{ color: TEXT_OFF }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(220,38,38,0.18)'; e.currentTarget.style.color = '#FCA5A5' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = TEXT_OFF }}
              >
                <LogOut size={14} />
              </motion.button>
            </div>
          </div>
        )}
        <div className="px-5 py-2.5">
          <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.22)' }}>
            ORBIT v2.0 · © 2026
          </div>
        </div>
      </div>
    </motion.nav>
  )
}
