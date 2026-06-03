# ARCHITECTURE.md — Arquitectura Orbit

## Stack definitivo (en producción)
- **Frontend:** React 18 + Vite 8 (`type: module`)
- **Estilos:** Tailwind CSS v4 con `@theme` en `src/index.css` — NO es v3, no existe `tailwind.config.js`
- **Router:** React Router v6 con `HashRouter`
- **Backend/DB:** Supabase (PostgreSQL) — proyecto `gfnvrmpcwchqdyozwygd`
- **Almacenamiento de imágenes:** Supabase Storage
- **Charts:** recharts v2
- **Icons:** lucide-react

## Decisiones tomadas
- **Offline:** No requerido. Acceso siempre con conexión.
- **WhatsApp:** wa.me directo para notificaciones a técnicos. Zolutium API pendiente de implementar para notificaciones automatizadas.
- **Facturación:** No integrada aún. Pendiente.
- **PDF:** jsPDF directo. NUNCA html2canvas con Tailwind v4 (oklch rompe html2canvas).
- **Acceso móvil técnicos:** TecnicoApp.jsx — interfaz responsive optimizada para móvil.

## Principios técnicos
- Arquitectura modular por páginas en `src/pages/`.
- Lógica de negocio en componentes de página, no en capa de servicios separada (decisión pragmática).
- Auditoría transversal: PENDIENTE de implementar (tabla `auditoria` no existe aún).
- Estados controlados por enums en DB con CHECK constraints.
- Integraciones desacopladas (WA, PDF, formulario público).

## Estructura de archivos
```
src/
  App.jsx                   ← Router, rutas lazy-loaded (incluye /solicitud pública)
  main.jsx
  index.css                 ← Tailwind v4 @theme + clases explícitas fallback
  lib/
    supabase.js             ← db = createClient(URL, KEY)
    utils.js                ← fmt, today, petEmoji, initials, needsAcomp, addDiasHabiles, cn
    constants.js            ← ESTADO_COLOR, ESTADO_LABEL, TIPO_LABEL
    ia.js                   ← helpers IA
  components/
    layout/
      AppShell.jsx, Sidebar.jsx, Topbar.jsx
    ui/
      button, badge, card, table, input, select, textarea,
      dialog, tabs, alert, avatar, horario-editor
  contexts/
    BadgesContext.jsx       ← Badges sidebar, poll 60s
  pages/
    Dashboard.jsx, Kanban.jsx, Registro.jsx
    Calendario.jsx, CuartoFrio.jsx, Tenjo.jsx, Produccion.jsx
    SeguimientoImagenes.jsx, Gestion.jsx, Nps.jsx, Reportes.jsx
    Finanzas.jsx, Recibos.jsx, Presequiales.jsx
    Configuracion.jsx, TecnicoApp.jsx
    SolicitudCliente.jsx    ← Ruta pública sin auth (/solicitud)
```

## Paleta de colores (NO cambiar)
- Sidebar bg: `#263218` | Primario: `#3D5A27` hover: `#263218`
- Fondo: `#F8F9FA` | Dorado: `#C4A87A`
- Texto principal: `#111827` | Secundario: `#374151` | Muted: `#9CA3AF`
