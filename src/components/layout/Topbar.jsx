import { useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerNoLeidas, marcarLeida, marcarTodasLeidas } from '@/lib/notificaciones'

const PAGE_META = {
  '/':             { title: 'Dashboard',              sub: 'Resumen operacional' },
  '/kanban':       { title: 'Tablero de servicios',   sub: 'Seguimiento en tiempo real' },
  '/registro':     { title: 'Nuevo servicio',         sub: 'Registro paso a paso' },
  '/eutanasias':   { title: 'Eutanasia compasiva',    sub: 'Servicio, agenda, veterinario y cierre' },
  '/calendario':   { title: 'Calendario',             sub: 'Fechas límite por servicio' },
  '/cuarto-frio':  { title: 'Cuarto frío',            sub: 'Control de ingreso y ubicación' },
  '/tenjo':        { title: 'Planta Tenjo',           sub: 'Traslados y procesos individuales' },
  '/produccion':   { title: 'Producción',             sub: 'Cola de recordatorios' },
  '/inventario':   { title: 'Inventario',           sub: 'Insumos, kardex y costo de cada material' },
  '/imagenes':     { title: 'Imágenes',               sub: 'Solicitudes y recepción de fotos' },
  '/gestion':      { title: 'Gestión',                sub: 'Clientes, mascotas, aliados y personal' },
  '/nps':          { title: 'NPS & Postventa',        sub: 'Seguimiento post-entrega' },
  '/digitales':    { title: 'Digitales',              sub: 'Memorial, video y short — publicación y envío al cliente' },
  '/ofertas':      { title: 'Ofertas',                sub: 'Anuncios que ve el cliente en el portal de fotos' },
  '/whatsapp':     { title: 'Bandeja de WhatsApp',    sub: 'Una bandeja por línea — lo que dijo el agente y lo que respondes tú' },
  '/agentes':      { title: 'Agentes IA',             sub: 'Una línea, un agente: su contexto, sus reglas y su voz' },
  '/costos-ia':    { title: 'Costos de la IA',        sub: 'Lo que se ha gastado de verdad, por proveedor y por canal' },
  '/plantillas-whatsapp': { title: 'Plantillas de WhatsApp', sub: 'Mensajes aprobados por Meta — los únicos que salen fuera de las 24 horas' },
  '/reportes':     { title: 'Reportes',               sub: 'Análisis operacional y financiero' },
  '/presequiales': { title: 'Pre-Exequiales', sub: 'Anuales y vitalicias · contratos y renovaciones' },
  '/configuracion':  { title: 'Configuración',        sub: 'Planes, recordatorios y catálogos' },
  '/lotes-grupales': { title: 'Lotes Grupales',       sub: 'Cremación y compostaje grupal' },
  '/finanzas':       { title: 'Finanzas',             sub: 'Cartera, comisiones y pagos' },
}

const TIPO_ICON = {
  TECNICO_INICIO_RUTA:   '🚗',
  TECNICO_LLEGADA:       '📍',
  TECNICO_DECLINA:       '❌',
  REASIGNACION_TECNICO:  '🔄',
  REASIGNACION_REMOVIDO: '📋',
  CENIZAS_LISTAS:        '⚱️',
  COMPOSTAJE_LISTO:      '🌿',
}

export default function Topbar({ actions }) {
  const { pathname } = useLocation()
  const { personalData } = useAuth()
  const { title, sub } = PAGE_META[pathname] ?? PAGE_META['/']

  const [notifs, setNotifs]     = useState([])
  const [abierto, setAbierto]   = useState(false)
  const dropRef                 = useRef(null)

  const dateStr = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // Cargar notificaciones cada 30s
  useEffect(() => {
    if (!personalData?.id) return
    const cargar = () => obtenerNoLeidas(personalData.id).then(setNotifs)
    cargar()
    const iv = setInterval(cargar, 30_000)
    return () => clearInterval(iv)
  }, [personalData?.id])

  // Cerrar al hacer click fuera
  useEffect(() => {
    const fn = e => { if (dropRef.current && !dropRef.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  async function onClickNotif(n) {
    await marcarLeida(n.id)
    setNotifs(prev => prev.filter(x => x.id !== n.id))
  }

  async function leerTodas() {
    if (!personalData?.id) return
    await marcarTodasLeidas(personalData.id)
    setNotifs([])
  }

  return (
    <header
      className="bar-glass sticky top-14 z-30 flex items-center px-4 sm:px-6 gap-4"
      style={{ height: 56 }}
    >
      <div className="flex flex-col justify-center">
        <span className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</span>
        {sub && <span className="text-[11px] text-gray-400 leading-tight font-medium">{sub}</span>}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {actions}
        <span className="text-[11px] text-gray-400 font-medium hidden lg:block capitalize">{dateStr}</span>

        {/* Campana de notificaciones */}
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setAbierto(o => !o)}
            className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Bell size={18} className="text-gray-500" />
            {notifs.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: '#C03030', color: '#fff' }}>
                {notifs.length > 9 ? '9+' : notifs.length}
              </span>
            )}
          </button>

          {abierto && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-lg border overflow-hidden z-50"
              style={{ borderColor: 'rgba(30,80,40,0.1)' }}>

              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                <span className="text-[13px] font-bold text-gray-900">Notificaciones</span>
                {notifs.length > 0 && (
                  <button onClick={leerTodas} className="text-[11px] text-[#1A5CD8] font-semibold hover:underline">
                    Marcar todas leídas
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-gray-400">Sin notificaciones nuevas</div>
                ) : (
                  notifs.map(n => {
                    const mascota = n.servicios?.mascotas?.nombre
                    return (
                      <button key={n.id}
                        onClick={() => onClickNotif(n)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b flex items-start gap-3 transition-colors"
                        style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                        <span className="text-base flex-shrink-0 mt-0.5">{TIPO_ICON[n.tipo] || '🔔'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-gray-900 leading-tight">{n.titulo}</p>
                          {n.mensaje && <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{n.mensaje}</p>}
                          {mascota && <p className="text-[10px] text-[#1A5CD8] font-semibold mt-1">🐾 {mascota}</p>}
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(n.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
