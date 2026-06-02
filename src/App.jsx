import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgesProvider } from '@/contexts/BadgesContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { getRoleConfig } from '@/lib/roles'
import AppShell from '@/components/layout/AppShell'
import { pageVariants, PAGE_TRANSITION } from '@/lib/motion'

const TecnicoApp       = lazy(() => import('@/pages/TecnicoApp'))
const Login            = lazy(() => import('@/pages/Login'))
const FotosCliente     = lazy(() => import('@/pages/FotosCliente'))
const SolicitudCliente = lazy(() => import('@/pages/SolicitudCliente'))

const Dashboard          = lazy(() => import('@/pages/Dashboard'))
const Kanban             = lazy(() => import('@/pages/Kanban'))
const Registro           = lazy(() => import('@/pages/Registro'))
const Calendario         = lazy(() => import('@/pages/Calendario'))
const CuartoFrio         = lazy(() => import('@/pages/CuartoFrio'))
const Tenjo              = lazy(() => import('@/pages/Tenjo'))
const Produccion         = lazy(() => import('@/pages/Produccion'))
const SeguimientoImagenes = lazy(() => import('@/pages/SeguimientoImagenes'))
const Gestion            = lazy(() => import('@/pages/Gestion'))
const Nps                = lazy(() => import('@/pages/Nps'))
const Reportes           = lazy(() => import('@/pages/Reportes'))
const Presequiales       = lazy(() => import('@/pages/Presequiales'))
const Configuracion      = lazy(() => import('@/pages/Configuracion'))
const LotesGrupales      = lazy(() => import('@/pages/LotesGrupales'))
const Recibos            = lazy(() => import('@/pages/Recibos'))
const Finanzas           = lazy(() => import('@/pages/Finanzas'))
const Certificados       = lazy(() => import('@/pages/Certificados'))

function FullScreenLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen gap-3 text-gray-400"
      style={{ background: '#F8F9FA' }}>
      <div className="spinner" />
      <span className="text-sm font-medium">Cargando...</span>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
      <div className="spinner" />
      <span className="text-sm font-medium">Cargando...</span>
    </div>
  )
}

// Rutas del app shell — solo se renderizan si el rol las tiene permitidas
function AppRoutes({ rol }) {
  const { routes, redirectTo } = getRoleConfig(rol)
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
            {routes.has('/')             && <Route path="/"             element={<Dashboard />} />}
            {routes.has('/kanban')       && <Route path="/kanban"       element={<Kanban />} />}
            {routes.has('/registro')     && <Route path="/registro"     element={<Registro />} />}
            {routes.has('/calendario')   && <Route path="/calendario"   element={<Calendario />} />}
            {routes.has('/cuarto-frio')  && <Route path="/cuarto-frio"  element={<CuartoFrio />} />}
            {routes.has('/tenjo')        && <Route path="/tenjo"        element={<Tenjo />} />}
            {routes.has('/produccion')   && <Route path="/produccion"   element={<Produccion />} />}
            {routes.has('/imagenes')     && <Route path="/imagenes"     element={<SeguimientoImagenes />} />}
            {routes.has('/gestion')      && <Route path="/gestion"      element={<Gestion />} />}
            {routes.has('/nps')          && <Route path="/nps"          element={<Nps />} />}
            {routes.has('/reportes')     && <Route path="/reportes"     element={<Reportes />} />}
            {routes.has('/presequiales') && <Route path="/presequiales" element={<Presequiales />} />}
            {routes.has('/configuracion')   && <Route path="/configuracion"   element={<Configuracion />} />}
            {routes.has('/lotes-grupales') && <Route path="/lotes-grupales" element={<LotesGrupales />} />}
            {routes.has('/recibos')        && <Route path="/recibos"        element={<Recibos />} />}
            {routes.has('/finanzas')       && <Route path="/finanzas"       element={<Finanzas />} />}
            {routes.has('/certificados')   && <Route path="/certificados"   element={<Certificados />} />}
            <Route path="*" element={<Navigate to={redirectTo} replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

function InnerApp() {
  const { session, personalData, loading, logout, debug } = useAuth()
  const location = useLocation()

  // Rutas públicas — no requieren autenticación
  if (location.pathname === '/solicitud') {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <SolicitudCliente />
      </Suspense>
    )
  }

  // /fotos        → pantalla de entrada (cliente digita el código)
  // /fotos/CODIGO → carga directa desde link de WhatsApp
  if (location.pathname === '/fotos' || location.pathname.startsWith('/fotos/')) {
    const codigo = location.pathname.startsWith('/fotos/')
      ? location.pathname.replace('/fotos/', '')
      : ''
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <FotosCliente codigo={codigo} />
      </Suspense>
    )
  }

  if (loading) return <FullScreenLoader />

  // No autenticado → Login
  if (!session) {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <Login />
      </Suspense>
    )
  }

  // Autenticado pero aún cargando personal
  if (personalData === undefined) return <FullScreenLoader />

  // Autenticado pero sin registro en personal
  if (personalData === null) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0B1D4F' }}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <h2 className="font-bold text-gray-900 mb-2">Usuario sin perfil</h2>
        <p className="text-sm text-gray-500 mb-4">Tu correo no tiene un registro en <strong>personal</strong>. Contacta al administrador.</p>
        {debug && <p className="text-[10px] text-gray-400 break-all mb-3 bg-gray-50 p-2 rounded">{debug}</p>}
        <button onClick={logout} className="text-sm font-medium text-red-500">Cerrar sesión</button>
      </div>
    </div>
  )

  const config = getRoleConfig(personalData.rol)

  // Técnico / Mensajero → TecnicoApp (vista móvil de campo)
  if (config.isTecnico) {
    return (
      <Suspense fallback={
        <div style={{ minHeight: '100vh', background: '#0B1D4F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ borderColor: '#C4A87A', borderTopColor: 'transparent' }} />
        </div>
      }>
        <TecnicoApp />
      </Suspense>
    )
  }

  // Coordinador / Admin / Productor / Operario → AppShell con módulos permitidos
  return (
    <BadgesProvider>
      <AppShell>
        <AppRoutes rol={personalData.rol} />
      </AppShell>
    </BadgesProvider>
  )
}

export default function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ConfirmProvider>
        <AuthProvider>
          <InnerApp />
        </AuthProvider>
      </ConfirmProvider>
    </HashRouter>
  )
}
