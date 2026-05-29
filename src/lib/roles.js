// Configuración de rutas y permisos por rol
// isTecnico: true → ve TecnicoApp (vista móvil de campo)
// routes: Set de rutas del AppShell permitidas (solo aplica si isTecnico es false)

export const ROLE_CONFIG = {
  ADMIN: {
    isTecnico:  false,
    redirectTo: '/',
    routes: new Set([
      '/', '/kanban', '/registro', '/calendario', '/cuarto-frio',
      '/tenjo', '/produccion', '/imagenes', '/gestion', '/nps',
      '/presequiales', '/reportes', '/configuracion', '/lotes-grupales', '/recibos', '/finanzas',
    ]),
  },
  COORDINADOR: {
    isTecnico:  false,
    redirectTo: '/',
    routes: new Set([
      '/', '/kanban', '/registro', '/calendario', '/cuarto-frio',
      '/tenjo', '/produccion', '/imagenes', '/gestion', '/nps',
      '/presequiales', '/reportes', '/lotes-grupales', '/recibos', '/finanzas',
    ]),
  },
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
    redirectTo: '/cuarto-frio',
    routes:     new Set(['/cuarto-frio', '/tenjo']),
  },
}

export function getRoleConfig(rol) {
  return ROLE_CONFIG[rol] ?? ROLE_CONFIG.COORDINADOR
}

// Filtra los grupos del sidebar según el rol del usuario
export function filterNavGroups(groups, rol) {
  const { routes } = getRoleConfig(rol)
  return groups
    .map(g => ({ ...g, items: g.items.filter(item => routes.has(item.path)) }))
    .filter(g => g.items.length > 0)
}
