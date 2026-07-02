# Memorial Camino al Cielo — Diagnóstico de automatización (Canva API) + Fase 0

**Fecha:** 2026-07-02 · **Estado:** diagnóstico + preparación Fase 0. **NO implementado.**

Objetivo: automatizar en ORBIT la generación del "Memorial Camino al Cielo" —hoy hecho a mano en
Canva reemplazando foto + nombre de la mascota sobre una plantilla animada, exportando y publicando
en Instagram— para los servicios que lo requieren (principalmente **Básico** y **Eco-grupal**).

---

## Hallazgo que define todo

La automatización completa (inyectar nombre + foto en una **plantilla animada** y **exportar** la
pieza sin intervención) depende de dos APIs de Canva: **Autofill** y **Brand Templates**. Ambas
están **bloqueadas detrás de Canva Enterprise**, no de Canva Equipos (Teams).

> *"As the integration developer, you must be a member of a Canva Enterprise organization to include
> the Brand template and Autofill APIs… Each user of your autofill integration must also be a member
> of a Canva Enterprise organization."* — Canva Connect API docs.

No basta con que la cuenta desarrolladora sea Enterprise: **cada usuario** en cuyo nombre corra el
autofill debe ser Enterprise. **Con Canva Equipos no se puede usar.**

---

## A. Diagnóstico de viabilidad con Canva Equipos

| Capacidad | ¿En Canva **Equipos**? |
|---|---|
| Brand Templates por API | ❌ Solo Enterprise |
| Campos autofillables (Autofill API) | ❌ Solo Enterprise |
| Reemplazar nombre + imagen automáticamente | ❌ (depende de Autofill) |
| Exportar la pieza **animada** (MP4/GIF) por API | ✅ Sí (Export API no requiere Enterprise) |
| Subir la foto como asset (Asset Upload API) | ✅ Sí |
| Crear/duplicar diseños genéricos por API | ⚠️ Parcial (no rellena una plantilla con datos) |

**Conclusión:** la pieza clave (autofill de nombre + foto en la plantilla animada) **no es posible**
en Equipos. Lo demás (exportar, subir assets) sí, pero sin autofill no cumple el objetivo.

## B. Qué SÍ se puede con Canva Equipos

- Subir la foto de la mascota como asset (Asset Upload API).
- Exportar un diseño existente a **MP4 (480p–4K) o GIF** por API — **la animación se preserva**.
- OAuth 2.0 (Connect API) para uso privado del equipo (integración sin publicar al Marketplace).
- Deep-links / navegación asistida para abrir la plantilla lista y que un humano haga el swap
  (semi-automatización; casi lo mismo que hoy).

## C. Limitaciones y bloqueos técnicos

- **Autofill:** requiere Enterprise (bloqueante total del objetivo).
- **Brand Templates por API:** requiere Enterprise. Canva migró el formato de IDs de brand template
  en sept-2025 (los viejos caducan) → punto de mantenimiento futuro.
- **Export de animación:** ✅ funciona (MP4/GIF), pero es un **job asíncrono** (crear job → polling →
  descargar). Hay que manejar estados y reintentos.
- **Rate limits export:** 750/5min y 5.000/24h por integración; 500/24h por usuario → sobra para
  nuestro volumen (~220 piezas/mes, ver Fase 0).
- **Auth:** OAuth 2.0 con refresh tokens "en nombre de un usuario"; un backend headless debe
  custodiar y refrescar tokens.
- **Uso privado del equipo:** OK (integración privada).
- **Publicación en Instagram:** la API de Canva **no publica en Instagram** de forma programática
  fiable. Se mantiene manual, o aparte con Meta Graph API (Instagram Content Publishing, cuenta
  Business) en una fase opcional posterior.

## D. ¿Necesitamos Canva Enterprise?

**Sí, si se quiere la automatización completa dentro de Canva.** El autofill de plantilla animada es
exclusivo de Enterprise, para el desarrollador **y para cada usuario**. Canva Enterprise se cotiza
por organización (precio no público; salto de costo grande frente a Equipos). No hay atajo técnico
legítimo que evite ese requisito.

## E. Recomendación técnica final

**No adoptar Canva como motor de automatización del memorial.** Motivos:

1. **Costo/beneficio:** pagar Enterprise para automatizar una sola pieza recurrente es desproporcionado.
2. **Estrategia:** la directriz es no ampliar dependencias externas y llevar lo nuevo a backend propio
   en Contabo. Enterprise va en contra (SaaS caro + gatekeeping de IDs/scopes por-usuario).

**Recomendación:** generar el memorial animado con un **motor de plantillas propio o un servicio de
render templado por API** (Remotion self-hosted, o Creatomate/Bannerbear/Placid). Todos toman
plantilla + variables (nombre, foto) y devuelven MP4/GIF por API, **sin Enterprise ni gatekeeping
por-usuario**, y encajan con "backend propio en Contabo". La plantilla animada de Canva se **recrea
una vez** en ese motor.

- **Cero desarrollo de render:** Creatomate/Bannerbear (SaaS, plantilla visual + API JSON) — arranque rápido, costo bajo/medio.
- **Control total y coherente con arquitectura objetivo:** **Remotion** (plantilla en React, render con FFmpeg en el VPS) — más trabajo inicial, cero costo por pieza, todo en casa.

## F. Flujo propuesto para ORBIT (independiente del motor)

1. **Detección:** servicio "requiere memorial" si su `planes.codigo` está en una **config editable**
   de planes con memorial (como `override_*_codigos` de la migración 006), no hardcode.
2. **Disparo:** cuando el servicio tiene foto disponible. La foto del cliente vive en el bucket
   **`fotos-clientes`** (subida en `FotosCliente.jsx`); el nombre está en `mascotas.nombre`.
3. **Generación:** el **orbit-backend** (no una Edge Function) toma `nombre` + URL de foto, llama al
   motor de render y obtiene el MP4/GIF.
4. **Guardado:** archivo final en almacenamiento propio de Contabo (transicional: bucket `memoriales`
   con `createSignedUrl`, como `reportes-grupales`/`evidencias`).
5. **Validación humana:** módulo "Memoriales" — el coordinador ve la pieza, aprueba o regenera.
6. **Registro de publicación:** tabla `memoriales` (`servicio_id`, `estado`, `archivo_url`,
   `instagram_url`, `publicado_por`, timestamps). **Hoy ORBIT no tiene ningún campo de
   Instagram/memorial** → se crea con migración versionada.

*(Publicación a Instagram manual; solo se pega el enlace en ORBIT. Auto-post = fase opcional futura
con Meta Graph API, no con Canva.)*

## G. Plan por fases

- **Fase 0 — Decisión (sin código):** confirmar planes con memorial; elegir motor de render; recrear
  la plantilla y validar fidelidad visual. *(Ver sección Fase 0 abajo.)*
- **Fase 1 — Modelo de datos:** migración `0xx_memoriales.sql` (tabla `memoriales` + config de planes). Sin UI.
- **Fase 2 — Generación backend:** endpoint en orbit-backend que recibe `servicio_id`, arma variables,
  renderiza y guarda. Probado con 1–2 servicios reales.
- **Fase 3 — Módulo ORBIT "Memoriales":** listado de candidatos + generar + previsualizar +
  aprobar/regenerar + campo enlace Instagram + estado.
- **Fase 4 (opcional):** disparo automático al tener foto + badge en el sidebar.
- **Fase 5 (opcional, futuro):** auto-publicación a Instagram vía Meta Graph API.

## H. Riesgos y plan alterno

- **Riesgo Canva:** aun pagando Enterprise, el requisito "cada usuario Enterprise" + migración de IDs
  te dejan expuesto. → El plan alterno ES la recomendación principal (motor propio).
- **Riesgo fidelidad visual:** plantilla recreada ≠ Canva. → Validar visualmente en Fase 0 antes de
  código; mantener Canva manual como respaldo mientras se calibra.
- **Riesgo Instagram:** auto-post frágil (cuenta Business + revisión Meta). → Publicación manual +
  registro de enlace; automatizar solo si aporta.
- **Plan mínimo viable sin motor nuevo:** semi-automatizar en Equipos — ORBIT pre-sube la foto como
  asset y abre un deep-link a la plantilla duplicada; el humano hace swap y exporta. Ahorra pasos sin
  pagar Enterprise, pero no elimina el trabajo manual.

---

# FASE 0 — Preparación (datos verificados en producción)

## 0.1 Planes con memorial — DECISIÓN CERRADA (David, 2026-07-02)

**El memorial lo llevan TODOS los planes EXCEPTO `ANGEL` (Plan Ángel) y `DESAMPARADO` (Desamparado).**

Regla de detección (por exclusión, no por inclusión):
```sql
planes.codigo NOT IN ('ANGEL','DESAMPARADO')
```
El diseño la implementa como **config editable** (`config` tipo `MEMORIAL / planes_excluidos`) para
poder ajustar la lista sin tocar código.

**Volumen verificado (VPS 2026-07-02): ≈ 286 memoriales/mes.** Holgado para cualquier motor.

## 0.2 Insumos que ORBIT ya tiene (confirmado en código)

| Dato | Origen |
|---|---|
| Nombre de la mascota | `mascotas.nombre` |
| Foto de la mascota | Bucket Storage **`fotos-clientes`** (subida en `src/pages/FotosCliente.jsx`, `getPublicUrl`) |
| Plan del servicio | `servicios.plan_id → planes.codigo` |
| Estado del servicio | `servicios.estado` |
| Cliente | vía `mascotas.cliente_id → clientes` |

**No existe** hoy: campo/tabla de memorial, enlace de Instagram, ni estado de publicación → se crean
en Fase 1. **No existe** módulo de "memoriales" ni de redes sociales (los matches de "instagram"/
"redes" en el código son solo `canal_entrada = REDES_SOCIALES`, sin relación).

## 0.1b Disparador — DECISIÓN CERRADA (David, 2026-07-02): "cuando la imagen ya está lista"

La señal ya existe en ORBIT: **`servicios.fecha_imagenes_recibidas IS NOT NULL`** (es el flag
`fotos_ok` que `Produccion.jsx` usa para desbloquear la producción de recordatorios; la foto vive en
el bucket `fotos-clientes`). El memorial se vuelve **candidato** cuando ese campo se llena.
→ *Confirmar en Fase 1 que la foto del cliente recibida es la misma que se usa para el memorial (lo
es en el flujo actual).*

## 0.3 Comparativa de motores de render (para decidir en Fase 0)

| Criterio | **Remotion (self-host Contabo)** | **Creatomate / Bannerbear (SaaS)** | **Canva Enterprise** |
|---|---|---|---|
| Autofill nombre+foto en plantilla animada | ✅ (código React) | ✅ (plantilla visual + API JSON) | ✅ |
| Export animado (MP4/GIF) por API | ✅ (FFmpeg) | ✅ | ✅ |
| Requiere plan caro / gatekeeping por-usuario | ❌ No | ❌ No (plan por volumen) | ⚠️ Sí (Enterprise + cada usuario) |
| Coherente con "backend propio Contabo" | ✅ Máximo | ⚠️ SaaS externo | ❌ SaaS externo |
| Costo por pieza | ~0 (infra propia) | bajo/medio por volumen | alto (licencia org) |
| Esfuerzo inicial | Alto (recrear plantilla en React + setup render) | Medio (recrear plantilla en su editor) | Bajo (ya tienen la plantilla) pero bloqueado por costo |
| Riesgo plataforma | Bajo (todo en casa) | Medio | Alto |

**Recomendación de motor — DECISIÓN (2026-07-02): Remotion self-host en Contabo.**

Razones, dado el volumen real (~286/mes) y el requisito de David ("recrearlo bien en ORBIT o una
plataforma gratuita"):
- **Gratis de verdad y sin tope:** Remotion es open-source (licencia gratuita para empresas pequeñas);
  el render corre con FFmpeg en el propio VPS → **$0 por pieza, sin límite de volumen ni marca de agua**.
  Los "free tier" de los SaaS (Bannerbear ~30–50/mes, Creatomate limitado/con marca) **no alcanzan**
  para 286/mes sin pagar.
- **Encaja con la arquitectura objetivo:** todo en Contabo + orbit-backend, cero SaaS externo nuevo.
- **Mismo stack del equipo:** la plantilla se define como componente **React** (ya usamos React 18),
  animada con la timeline de Remotion; se recrea **una sola vez** a partir de la plantilla de Canva.
- **Único costo:** esfuerzo inicial de recrear la animación en React (una vez). A cambio: control total
  de tipografías, colores de marca y del formato de salida (MP4 vertical 1080x1920 para Reels/Historias).

*Plan B si se quiere arrancar sin recrear en React:* un SaaS con free tier para una prueba de 10–20
piezas, aceptando marca de agua/límite; pero para producción a 286/mes hay que ir a Remotion o pagar
plan del SaaS. **Recomendado: Remotion directamente.**

## 0.4 Checklist para cerrar Fase 0

Decisiones ya cerradas por David (2026-07-02):
- [x] Planes con memorial: **todos excepto `ANGEL` y `DESAMPARADO`** (≈286/mes).
- [x] Motor: **Remotion self-host en Contabo** (gratis, sin tope, encaja con arquitectura).
- [x] Disparador: **`servicios.fecha_imagenes_recibidas` lleno** (imagen del cliente ya recibida).
- [x] Instagram: se **registra manual** (pegar enlace en ORBIT); auto-post = fase futura opcional.

Avance (2026-07-02):
- [x] **David compartió la plantilla actual** (video de Ginebra, 1080×1350). Analizada.
- [x] **POC de Remotion construido y RENDERIZADO** — recreación mejorada y animada. Fuente en
  `docs/memorial-poc/`, MP4 de muestra `Memorial_Ginebra_ORBIT.mp4`. **Motor validado end-to-end**
  (install → still → MP4 12s, sin Canva). Mejoras sobre el original: animación real (revelado
  escalonado, Ken Burns, partículas), arco tipo portal con marco dorado, tipografía serif premium
  (Playfair/Cormorant), viñeta y luz cálida, jerarquía "EN MEMORIA DE / nombre / fecha / frase".

Pendiente antes de Fase 1:
- [ ] David da visto bueno estético al MP4 (o pide ajustes de color/tipografía/frase/duración).
- [ ] Decidir formato(s) final(es): se hizo **1080×1350** (igual al actual); ¿añadir 1080×1920 para Reels/Historias?
- [ ] Confirmar que la foto de `fotos-clientes` es la que va en el memorial (ver 0.1b).

Cerrado esto, arranca **Fase 1** (mover POC a orbit-backend + migración `0xx_memoriales.sql` +
tabla `memoriales` + config de planes excluidos).

---

## Fuentes (Canva Connect API)

- Autofill guide — https://www.canva.dev/docs/connect/autofill-guide/
- Brand templates — https://www.canva.dev/docs/connect/api-reference/brand-templates/
- Create design autofill job — https://www.canva.dev/docs/connect/api-reference/autofills/create-design-autofill-job/
- Create design export job — https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/
- Data autofill (Help Center) — https://www.canva.com/help/data-autofill/
