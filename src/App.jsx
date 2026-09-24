import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgesProvider } from '@/contexts/BadgesContext'
import { ChatWaProvider } from '@/contexts/ChatWaContext'
import ChatFlotante from '@/components/ChatFlotante'
import EsperasCoordinacion from '@/components/EsperasCoordinacion'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { getRoleConfig, esRolValido } from '@/lib/roles'
import AppShell from '@/components/layout/AppShell'
import AvisoNuevaVersion, { AutoActualizaPublico } from '@/components/AvisoNuevaVersion'
import { pageVariants, PAGE_TRANSITION } from '@/lib/motion'

const TecnicoApp       = lazy(() => import('@/pages/TecnicoApp'))
const Login            = lazy(() => import('@/pages/Login'))
const FotosCliente     = lazy(() => import('@/pages/FotosCliente'))
const PlantaCliente    = lazy(() => import('@/pages/PlantaCliente'))
const VisitaCliente    = lazy(() => import('@/pages/VisitaCliente'))
const SolicitudCliente = lazy(() => import('@/pages/SolicitudCliente'))
const SolicitudAliado  = lazy(() => import('@/pages/SolicitudAliado'))
const Privacidad       = lazy(() => import('@/pages/Privacidad'))

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
const Pqr                = lazy(() => import('@/pages/Pqr'))
const Reportes           = lazy(() => import('@/pages/Reportes'))
const Presequiales       = lazy(() => import('@/pages/Presequiales'))
const Configuracion      = lazy(() => import('@/pages/Configuracion'))
const LotesGrupales      = lazy(() => import('@/pages/LotesGrupales'))
const Recibos            = lazy(() => import('@/pages/Recibos'))
const Finanzas           = lazy(() => import('@/pages/Finanzas'))
const Inventario         = lazy(() => import('@/pages/Inventario'))
const Certificados       = lazy(() => import('@/pages/Certificados'))
const Eutanasias         = lazy(() => import('@/pages/Eutanasias'))
const Digitales          = lazy(() => import('@/pages/Digitales'))
const Ofertas            = lazy(() => import('@/pages/Ofertas'))
const ComprasRecordatorios = lazy(() => import('@/pages/ComprasRecordatorios'))
const Whatsapp           = lazy(() => import('@/pages/Whatsapp'))
const AgenteWhatsapp     = lazy(() => import('@/pages/AgenteWhatsapp'))
const AgentesIA          = lazy(() => import('@/pages/AgentesIA'))
const CostosIA           = lazy(() => import('@/pages/CostosIA'))
const Automatizaciones   = lazy(() => import('@/pages/Automatizaciones'))
const PlantillasWhatsapp = lazy(() => import('@/pages/PlantillasWhatsapp'))

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
            {routes.has('/pqr')          && <Route path="/pqr"          element={<Pqr />} />}
            {routes.has('/reportes')     && <Route path="/reportes"     element={<Reportes />} />}
            {routes.has('/presequiales') && <Route path="/presequiales" element={<Presequiales />} />}
            {routes.has('/configuracion')   && <Route path="/configuracion"   element={<Configuracion />} />}
            {routes.has('/lotes-grupales') && <Route path="/lotes-grupales" element={<LotesGrupales />} />}
            {routes.has('/recibos')        && <Route path="/recibos"        element={<Recibos />} />}
            {routes.has('/finanzas')       && <Route path="/finanzas"       element={<Finanzas />} />}
            {routes.has('/inventario')     && <Route path="/inventario"     element={<Inventario />} />}
            {routes.has('/certificados')   && <Route path="/certificados"   element={<Certificados />} />}
            {routes.has('/eutanasias')     && <Route path="/eutanasias"     element={<Eutanasias />} />}
            {routes.has('/digitales')      && <Route path="/digitales"      element={<Digitales />} />}
            {routes.has('/ofertas')        && <Route path="/ofertas"        element={<Ofertas />} />}
            {routes.has('/compras-recordatorios') && <Route path="/compras-recordatorios" element={<ComprasRecordatorios />} />}
            {routes.has('/whatsapp')       && <Route path="/whatsapp"       element={<Whatsapp />} />}
            {/* ── Agentes IA ── */}
            {routes.has('/agentes') && <Route path="/agentes" element={<AgentesIA />} />}
            {routes.has('/agentes') && <Route path="/agentes/:clave" element={<AgenteWhatsapp />} />}
            {routes.has('/costos-ia') && <Route path="/costos-ia" element={<CostosIA />} />}
            {routes.has('/automatizaciones') && <Route path="/automatizaciones" element={<Automatizaciones />} />}
            {/* Los enlaces viejos siguen funcionando: hay marcadores del navegador
                y enlaces pegados en chats apuntando a estas rutas. Redirigir es
                gratis; un 404 en una pantalla que existía ayer, no. */}
            {routes.has('/agentes') && <Route path="/agente-whatsapp" element={<Navigate to="/agentes/VETERINARIAS" replace />} />}
            {routes.has('/agentes') && <Route path="/materiales-whatsapp" element={<Navigate to="/agentes/VETERINARIAS" replace />} />}
            {routes.has('/agentes') && <Route path="/interactivos-whatsapp" element={<Navigate to="/agentes/VETERINARIAS" replace />} />}
            {routes.has('/plantillas-whatsapp') && <Route path="/plantillas-whatsapp" element={<PlantillasWhatsapp />} />}
            {/* Ruta anterior del módulo (marcadores guardados) */}
            {routes.has('/digitales')      && <Route path="/memoriales"     element={<Navigate to="/digitales" replace />} />}
            <Route path="*" element={<Navigate to={redirectTo} replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

// Rutas públicas: las abre un cliente o una veterinaria, sin sesión. Se nombran
// UNA vez porque el chrome interno tiene que respetarlas — el aviso de "hay una
// versión nueva de Orbit" se le estaba mostrando a familias en duelo dentro del
// portal de la planta y del de fotos, con un botón que no significa nada para
// ellas.
const RUTAS_PUBLICAS = ['/solicitud', '/aliado', '/fotos', '/planta', '/visita', '/privacidad']
const esRutaPublica = p => RUTAS_PUBLICAS.some(r => p === r || p.startsWith(r + '/'))

/**
 * El AVISO de versión nueva, solo donde hay alguien de la casa para atenderlo.
 *
 * En los portales no desaparece la actualización: desaparece el botón. Allí
 * entra sola (`AutoActualizaPublico`) mientras la persona no haya tocado nada.
 * Devolver `null` a secas dejaba el portal clavado en el build viejo mientras
 * hubiera otra pestaña de Orbit abierta, sin un solo error.
 */
function AvisoSoloInterno() {
  const { pathname } = useLocation()
  if (esRutaPublica(pathname)) return <AutoActualizaPublico />
  return <AvisoNuevaVersion />
}

function InnerApp() {
  const { session, personalData, loading, logout, debug, authError, retryAuth } = useAuth()
  const location = useLocation()

  // Rutas públicas — no requieren autenticación

  // /privacidad → Política de Tratamiento de Datos. La enlazan las casillas de
  // autorización de TODOS los formularios, así que se resuelve antes que nada y
  // sin sesión: se abre desde un portal, desde el Orbit interno y desde fuera.
  if (location.pathname === '/privacidad') {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <Privacidad />
      </Suspense>
    )
  }

  if (location.pathname === '/solicitud') {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <SolicitudCliente />
      </Suspense>
    )
  }

  // /aliado        → portal de aliados (Flujo B: afiliación de vet nueva)
  // /aliado?c=TOKEN → portal de aliados (Flujo A: aliado validado pide servicio)
  if (location.pathname === '/aliado') {
    const token = new URLSearchParams(location.search).get('c') || ''
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <SolicitudAliado token={token} />
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

  // /planta        → pantalla de entrada (el cliente digita el código)
  // /planta/CODIGO → elección de planta desde el link de WhatsApp. Es el MISMO
  //                  código del portal de fotos: el cliente ya lo tiene.
  if (location.pathname === '/planta' || location.pathname.startsWith('/planta/')) {
    const codigo = location.pathname.startsWith('/planta/')
      ? location.pathname.replace('/planta/', '')
      : ''
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <PlantaCliente codigo={codigo} />
      </Suspense>
    )
  }

  // /visita        → pantalla de entrada (el cliente digita el código)
  // /visita/CODIGO → visita a la planta desde el aviso de mitad de compostaje.
  //                  Mismo código del portal de fotos: el cliente ya lo tiene.
  if (location.pathname === '/visita' || location.pathname.startsWith('/visita/')) {
    const codigo = location.pathname.startsWith('/visita/')
      ? location.pathname.replace('/visita/', '')
      : ''
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <VisitaCliente codigo={codigo} />
      </Suspense>
    )
  }

  if (authError) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950">
      <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
        <h2 className="font-bold mb-2">No pudimos conectar</h2>
        <p role="alert" className="text-sm text-gray-600 mb-4">{authError}</p>
        <button onClick={retryAuth} className="rounded-lg bg-blue-700 px-5 py-3 text-white">Reintentar</button>
      </div>
    </div>
  )
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

  // Rol no reconocido → fail-closed (no asumir COORDINADOR)
  if (!esRolValido(personalData.rol)) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0B1D4F' }}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <h2 className="font-bold text-gray-900 mb-2">Rol no configurado</h2>
        <p className="text-sm text-gray-500 mb-4">Tu usuario no tiene un rol válido asignado. Contacta al administrador.</p>
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
    <ChatWaProvider>
      <BadgesProvider>
        <AppShell>
          <AppRoutes rol={personalData.rol} />
        </AppShell>
        {/* Fuera del AppShell: la ventanita flota sobre cualquier pantalla, y
            avisa aunque estés en Kanban o en Finanzas. */}
        <ChatFlotante />
        {/* Cuando el agente escala: franja arriba y, si urge o pasan 10 min
            sin respuesta, pantalla gris. SOLO se pinta en el Tablero (/kanban),
            pero vive aquí porque usa el ChatWaContext. Ver EsperasCoordinacion.jsx. */}
        <EsperasCoordinacion />
      </BadgesProvider>
    </ChatWaProvider>
  )
}

export default function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ConfirmProvider>
        <AuthProvider>
          <InnerApp />
          <AvisoSoloInterno />
        </AuthProvider>
      </ConfirmProvider>
    </HashRouter>
  )
}
