# CLAUDE.md — Camino al Cielo (Orbit) · Sistema de gestión interno

## ¿Qué es?
Sistema de información interno para **Camino al Cielo**, funeraria de mascotas en Bogotá. Gestiona toda la operación: recogida → cuarto frío → proceso (cremación/compostaje) → producción de recordatorios → entrega → NPS. Reemplazó Google Sheets.

## Stack real (en producción)
- **Frontend:** React 18 + Vite (`type: module`), React Router v6 con **HashRouter**, lazy-loading de páginas.
- **Estilos:** **Tailwind CSS v4** con `@theme` en `src/index.css` (NO v3, NO `tailwind.config.js`).
- **UI:** componentes propios en `src/components/ui/` + Radix (dialog, tabs, slot).
- **Charts:** recharts v2 · **Icons:** lucide-react · **Animación:** framer-motion.
- **PDF:** jsPDF directo. ⚠️ NUNCA html2canvas sobre Tailwind v4 (oklch lo rompe).
- **Backend:** **Supabase self-hosted en VPS Contabo** — API en `https://db.orbitacac.com`. (Ya NO es Supabase Cloud.)
- **Frontend en prod:** `https://orbit.orbitacac.com` (nginx). Deploy automático: `git push main` → GitHub Actions → ~3 min.

## Backend / Supabase
```js
import { db } from '@/lib/supabase'   // createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON)
```
- Helpers en `src/lib/supabase.js`: `dbGet`, `dbInsert`, `dbUpdate`, `callEdgeFunction(name, body)`.
- **RLS activo en 43/43 tablas** + las 8 vistas con `security_invoker`. No hay `dbAdmin`/service_role en el cliente.
- **Secretos server-side** (NO en el bundle): keys de Claude y GoHighLevel viven en Edge Functions
  `extraer-datos` (IA) y `send-whatsapp` (WhatsApp), en `supabase/functions/`. `admin-auth`
  crea/edita usuarios validando rol ADMIN.

## Estructura
```
src/
  App.jsx              ← HashRouter, rutas lazy, gating por rol (src/lib/roles.js)
  main.jsx, index.css  ← entry + Tailwind v4 @theme
  contexts/            ← AuthContext (sesión + rol), BadgesContext, ConfirmContext
  lib/                 ← supabase, utils, constants, roles, ia, whatsapp,
                         certificados, notificaciones, motion
  components/
    layout/            ← AppShell, Sidebar, Topbar
    ui/                ← button, card, dialog, table, select, ... (propios)
    CargaIA.jsx        ← extracción con IA (llama Edge Function extraer-datos)
  pages/*.jsx          ← Dashboard, Kanban, Registro, Calendario, CuartoFrio, Tenjo,
                         Produccion, SeguimientoImagenes, Gestion, Nps, Reportes,
                         Presequiales, Configuracion, LotesGrupales, Recibos, Finanzas,
                         Certificados, TecnicoApp, Login, FotosCliente, SolicitudCliente
```

## Roles (tabla `personal.rol_principal_id` → `roles_personal`)
`COORDINADOR(1)`, `TECNICO(2)`, `MENSAJERO(3)`, `PRODUCTOR(4)`, `OPERARIO(5)`, `ADMIN(6)`.
- TECNICO/MENSAJERO → `TecnicoApp` (vista móvil de campo).
- Resto → `AppShell` con módulos filtrados por `ROLE_CONFIG` en `src/lib/roles.js`.

## Estados de servicio (`servicios.estado`)
`INGRESADO → EN_RECOGIDA → EN_CUARTO_FRIO → EN_PROCESO → EN_PRODUCCION → LISTO → EN_ENTREGA → ENTREGADO | CANCELADO`

## ⚠️ Antes de tocar la DB
Los nombres de columnas/PKs y valores de enums tienen trampas reales que ya causaron bugs.
**Consultar las notas de memoria del proyecto** (`feedback_db_corrections`, `project_context`,
`security_rls_hardening`, `secrets_edge_functions`) antes de escribir cualquier query o policy.

## Reglas de desarrollo
1. Un cambio nunca vive solo: rastrear impacto transversal (tablas, vistas, otras páginas, flujo end-to-end).
2. Realtime activo: varias páginas se suscriben a cambios de Supabase — mantener sincronizado.
3. Al crear tablas o vistas con SQL raw: aplicar el patrón de RLS/GRANTs documentado en `supabase/security/`.

## ⛔ NADIE HACE `git push` — hay UNA sola sesión de despliegue
**Regla de David, 16-sep-2026.** Varias sesiones trabajan sobre ESTE MISMO árbol al mismo
tiempo. Cuando cada una empujaba lo suyo, `main` se movía debajo de las otras: pushes
rechazados, ramas divergidas, commits que se llevaban archivos ajenos a medio editar y
renombrados de otra sesión colados dentro de un commit que no era suyo. Todo eso ya pasó.

**Qué hace tu sesión:**
1. Trabaja y **commitea** lo tuyo. Commitear sí, siempre.
2. Commitea **solo tus archivos**, nombrándolos uno por uno:
   `git commit -m "..." -- ruta/uno ruta/dos`.
   ⚠️ Aun nombrando rutas, un renombrado que otra sesión dejó en el índice se cuela en tu
   commit. **Revisa con `git show --stat HEAD` después de commitear** y sácalo si aparece.
3. **NO hagas `git push`. NO hagas `git pull`, `rebase`, `reset --hard` ni `stash`**: el
   árbol tiene trabajo sin guardar de otras sesiones y lo destruyes.
4. Termina diciéndole a David **qué commiteaste y qué falta por subir**. Él lo sube desde
   la sesión de despliegue.

**Si te toca ser la sesión de despliegue**, antes de empujar revisa que no se vaya basura:
hoy conviven en la raíz bundles compilados (`Gestion.js`, `precios.js`, `precios_new.js`)
y un CSV con WhatsApp de clientes (`revision_87_*.csv`) — **eso no sube a GitHub**.

Los cambios de **base de datos** son aparte y no dependen de esto: van por SSH a Contabo
(`migrations/NNN_*.sql`), y una migración aplicada en producción **no queda desplegada**
hasta que su código llegue por push.
