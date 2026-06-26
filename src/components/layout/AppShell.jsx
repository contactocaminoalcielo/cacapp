import { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LogOut, User, PanelLeft, PanelLeftClose } from 'lucide-react'
import Sidebar from './Sidebar'
import { useAuth } from '@/contexts/AuthContext'

function ProfileMenu({ personalData, logout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  const nombre = personalData
    ? `${personalData.nombre ?? ''} ${personalData.apellido ?? ''}`.trim()
    : ''
  const initials = nombre
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const rol = personalData?.rol ?? ''
  const email = personalData?.email ?? ''

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 select-none"
        style={{ backgroundColor: '#C4A87A', color: '#1A2E1E' }}
        title={nombre}
      >
        {initials || <User size={14} />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            className="absolute right-0 top-11 w-56 bg-white rounded-2xl shadow-xl overflow-hidden z-50"
            style={{ border: '1px solid #EBEBEB' }}
          >
            {/* Info usuario */}
            <div className="px-4 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                style={{ backgroundColor: '#C4A87A', color: '#1A2E1E' }}
              >
                {initials || <User size={14} />}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 truncate">{nombre}</div>
                {email && <div className="text-[11px] text-gray-400 truncate">{email}</div>}
                {rol && (
                  <div
                    className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: '#F0F7EC', color: '#1A5CD8' }}
                  >
                    {rol}
                  </div>
                )}
              </div>
            </div>

            {/* Cerrar sesión */}
            <button
              onClick={() => { setOpen(false); logout() }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium transition-colors"
              style={{ color: '#DC2626' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FEF2F2'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <LogOut size={14} />
              Cerrar sesión
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function AppShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Colapsar el menú lateral en desktop (se recuerda entre sesiones).
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('orbit_sidebar_collapsed') === '1' } catch { return false }
  })
  const { personalData, logout } = useAuth()

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('orbit_sidebar_collapsed', next ? '1' : '0') } catch (_) {}
      return next
    })
  }

  return (
    <div className="flex min-h-screen bg-[#F8F9FA]">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} />

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-h-screen overflow-x-hidden transition-[margin] duration-300 ${collapsed ? 'lg:ml-0' : 'lg:ml-[240px]'}`}>
        {/* Topbar — siempre visible */}
        <div
          className="sticky top-0 z-50 flex items-center gap-3 bg-white px-4 h-14"
          style={{ borderBottom: '1px solid #F0F2F0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
        >
          {/* Hamburger solo en móvil */}
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="3.5"  width="16" height="1.5" rx="0.75" fill="#374151"/>
              <rect x="1" y="8.25" width="16" height="1.5" rx="0.75" fill="#374151"/>
              <rect x="1" y="13"   width="16" height="1.5" rx="0.75" fill="#374151"/>
            </svg>
          </motion.button>

          {/* Ocultar / mostrar menú — solo en desktop */}
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
            onClick={toggleCollapsed}
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </motion.button>

          {/* Título */}
          <span className="text-[13px] font-semibold text-gray-900 flex-1 truncate">
            Camino al Cielo
          </span>

          {/* Avatar / perfil — siempre visible */}
          {personalData && (
            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={logout}
                title="Cerrar sesión"
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: '#9CA3AF' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#FEF2F2'; e.currentTarget.style.color = '#DC2626' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#9CA3AF' }}
              >
                <LogOut size={16} />
              </motion.button>
              <ProfileMenu personalData={personalData} logout={logout} />
            </div>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}
