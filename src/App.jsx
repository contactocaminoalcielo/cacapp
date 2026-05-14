import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgesProvider } from '@/contexts/BadgesContext'
import AppShell from '@/components/layout/AppShell'
import { pageVariants, PAGE_TRANSITION } from '@/lib/motion'

const TecnicoApp = lazy(() => import('@/pages/TecnicoApp'))

const Dashboard         = lazy(() => import('@/pages/Dashboard'))
const Kanban            = lazy(() => import('@/pages/Kanban'))
const Registro          = lazy(() => import('@/pages/Registro'))
const Calendario        = lazy(() => import('@/pages/Calendario'))
const CuartoFrio        = lazy(() => import('@/pages/CuartoFrio'))
const Tenjo             = lazy(() => import('@/pages/Tenjo'))
const Produccion        = lazy(() => import('@/pages/Produccion'))
const SeguimientoImagenes = lazy(() => import('@/pages/SeguimientoImagenes'))
const Gestion           = lazy(() => import('@/pages/Gestion'))
const Nps               = lazy(() => import('@/pages/Nps'))
const Reportes          = lazy(() => import('@/pages/Reportes'))
const Presequiales      = lazy(() => import('@/pages/Presequiales'))
const Configuracion     = lazy(() => import('@/pages/Configuracion'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-ink3">
      <div className="spinner" />
      <span className="text-sm font-medium">Cargando...</span>
    </div>
  )
}

function AppRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={PAGE_TRANSITION}
        className="flex flex-col flex-1 min-w-0"
      >
        <Suspense fallback={<PageLoader />}>
          <Routes location={location}>
            <Route path="/"             element={<Dashboard />} />
            <Route path="/kanban"       element={<Kanban />} />
            <Route path="/registro"     element={<Registro />} />
            <Route path="/calendario"   element={<Calendario />} />
            <Route path="/cuarto-frio"  element={<CuartoFrio />} />
            <Route path="/tenjo"        element={<Tenjo />} />
            <Route path="/produccion"   element={<Produccion />} />
            <Route path="/imagenes"     element={<SeguimientoImagenes />} />
            <Route path="/gestion"      element={<Gestion />} />
            <Route path="/nps"          element={<Nps />} />
            <Route path="/reportes"     element={<Reportes />} />
            <Route path="/presequiales" element={<Presequiales />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="*"             element={<Dashboard />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

function InnerApp() {
  const location = useLocation()

  if (location.pathname === '/tecnico') {
    return (
      <Suspense fallback={
        <div style={{ minHeight: '100vh', background: '#263218', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ borderColor: '#C4A87A', borderTopColor: 'transparent' }} />
        </div>
      }>
        <TecnicoApp />
      </Suspense>
    )
  }

  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  )
}

export default function App() {
  return (
    <BadgesProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <InnerApp />
      </HashRouter>
    </BadgesProvider>
  )
}
