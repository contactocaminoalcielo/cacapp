// Configuración de rutas y permisos por rol
// isTecnico: true → ve TecnicoApp (vista móvil de campo)
// routes: Set de rutas del AppShell permitidas (solo aplica si isTecnico es false)

// ADMIN y COORDINADOR comparten exactamente la misma configuración:
// el coordinador tiene los mismos permisos que el admin (sigue llamándose
// COORDINADOR). Cualquier ruta nueva que se agregue aquí aplica a ambos.
const ACCESO_TOTAL = {
  isTecnico:  false,
  redirectTo: '/',
  routes: new Set([
    '/', '/kanban', '/registro', '/calendario', '/cuarto-frio',
    '/tenjo', '/produccion', '/imagenes', '/gestion', '/nps',
    '/presequiales', '/reportes', '/configuracion', '/lotes-grupales', '/recibos', '/finanzas', '/certificados',
    '/eutanasias', '/digitales',
  ]),
}

export const ROLE_CONFIG = {
  ADMIN:       ACCESO_TOTAL,
  COORDINADOR: ACCESO_TOTAL,
  TECNICO: {
    isTecnico:  true,
    redirectTo: '/tecnico',
    routes:     new Set([]),
  },
  MENSAJERO: {
    isTecnico:  true,
    redirectTo: '/tecnico',
    routes:     new Set([]),
  },
  PRODUCTOR: {
    isTecnico:  false,
    redirectTo: '/',
    routes:     new Set(['/', '/kanban', '/calendario', '/produccion', '/imagenes', '/nps']),
  },
  OPERARIO: {
    isTecnico:  false,
    redirectTo: '/tenjo',
    routes:     new Set(['/tenjo']),
  },
}

// Config cerrada para roles desconocidos: sin acceso a nada (fail-closed).
// Antes caía a COORDINADOR, lo que daba acceso operativo a un rol no reconocido.
const SIN_ACCESO = { isTecnico: false, redirectTo: '/', routes: new Set() }

export function getRoleConfig(rol) {
  return ROLE_CONFIG[rol] ?? SIN_ACCESO
}

// True solo si el rol está explícitamente configurado
export function esRolValido(rol) {
  return rol != null && Object.prototype.hasOwnProperty.call(ROLE_CONFIG, rol)
}

// Filtra los grupos del sidebar según el rol del usuario
export function filterNavGroups(groups, rol) {
  const { routes } = getRoleConfig(rol)
  return groups
    .map(g => ({ ...g, items: g.items.filter(item => routes.has(item.path)) }))
    .filter(g => g.items.length > 0)
}
