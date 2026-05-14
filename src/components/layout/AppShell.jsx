import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './Sidebar'

export default function AppShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-[#F8F9FA]">
      {/* Mobile overlay — animated */}
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

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-[240px]">
        {/* Mobile topbar with hamburger */}
        <div
          className="sticky top-0 z-30 lg:hidden flex items-center gap-3 bg-white px-4 h-14"
          style={{ borderBottom: '1px solid #F0F2F0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
        >
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="3.5"  width="16" height="1.5" rx="0.75" fill="#374151"/>
              <rect x="1" y="8.25" width="16" height="1.5" rx="0.75" fill="#374151"/>
              <rect x="1" y="13"   width="16" height="1.5" rx="0.75" fill="#374151"/>
            </svg>
          </motion.button>
          <span className="text-[13px] font-semibold text-gray-900">Camino al Cielo</span>
        </div>

        {children}
      </div>
    </div>
  )
}
