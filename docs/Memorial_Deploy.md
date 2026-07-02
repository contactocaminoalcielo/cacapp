# Memoriales — Guía de despliegue

Feature de automatización de memoriales (ver `docs/Memorial_Canva_Diagnostico.md`).
Motor: **Remotion self-host** en orbit-backend. Todo el código ya está en el repo.

## Estado
- [x] **Base de datos** — migración `025_memoriales.sql` **YA APLICADA en producción** (tabla
      `memoriales` + config `MEMORIAL` en `config_operativa`).
- [x] Backend (`orbit-backend/src/memorial.js` + endpoints en `index.js` + renderer en
      `orbit-backend/memorial/`).
- [x] Frontend (`src/pages/Memoriales.jsx` + ruta en `App.jsx` + `roles.js` + `Sidebar.jsx`).
- [ ] **Desplegar frontend** (git push).
- [ ] **Rebuild del contenedor backend en el VPS** (imagen nueva: Debian + Remotion + Chromium).

## 1. Frontend (automático)
```
git push origin main       # → GitHub Actions (~3 min) → orbit.orbitacac.com
```
Aparece el módulo **Memoriales** en el sidebar (grupo CLIENTES) para COORDINADOR/ADMIN.

## 2. Backend (manual, en el VPS) — el único paso de infra
El contenedor cambia de base `node-alpine` a `node-bookworm` con Chromium (lo exige Remotion).
En el VPS (`root@13.140.139.61`):
```
cd /opt/orbit-backend
git pull                       # traer el código nuevo (src/memorial.js, memorial/, Dockerfile, etc.)
docker compose build           # ~5-10 min: instala libs de Chromium + Remotion + baja el headless shell
docker compose up -d           # recrea el contenedor y crea el volumen memorial_data
docker compose logs -f orbit-backend   # verificar arranque
curl -s localhost:8787/health  # {ok:true}
```
- El volumen `memorial_data` guarda los MP4 y **persiste** entre reinicios/rebuilds.
- No hay secretos nuevos obligatorios. Opcionales en `.env`: `MEMORIAL_SIGN_SECRET`
  (default = `JWT_SECRET`), `MEMORIAL_CONCURRENCY` (default 2; **bajar a 1 si el VPS tiene poca RAM**).

## 3. Verificar end-to-end
1. En ORBIT → **Memoriales** → pestaña "Por generar": aparecen servicios con imagen recibida.
2. Clic **Generar** → el memorial pasa a "Generando…" y en ~30-60s a "Generado" (se ve el video).
3. **Aprobar** → **Descargar** el MP4 → publicar manual en Instagram → pegar el enlace → **Registrar**.

## Riesgos / a vigilar
- **Build de Chromium en Docker**: es lo único no probado fuera del VPS. Si el build o el primer
  render fallan por una librería del sistema faltante, agregarla al `apt-get install` del Dockerfile
  (revisar el error con `docker compose logs`). El render local (dev) ya quedó validado.
- **RAM**: cada render lanza Chromium headless (~1-2 GB pico con concurrency 2). Si el VPS es
  pequeño, `MEMORIAL_CONCURRENCY=1`.
- **nginx**: `/api` ya hace proxy al backend; los nuevos endpoints `/memoriales/*` y el streaming
  del archivo (`/memoriales/:id/archivo`, enlace firmado) pasan por ahí sin cambios.

## Arquitectura (resumen)
- Candidato = `servicios.fecha_imagenes_recibidas IS NOT NULL` + plan ∉ `MEMORIAL.planes_excluidos`
  (hoy `ANGEL`, `DESAMPARADO`) + sin memorial activo.
- Foto = primera `servicio_recordatorios.imagen_cliente_url` del servicio (bucket `fotos-clientes`).
- Render **asíncrono** en segundo plano: `generar` marca `GENERANDO` y responde; un proceso hijo
  `node memorial/render.mjs` renderiza y actualiza a `GENERADO`/`ERROR`. El front hace polling.
- Estados: `GENERANDO → GENERADO → APROBADO → PUBLICADO` (+ `ERROR`, `DESCARTADO`).
- Archivo servido por enlace **firmado** (HMAC, 6h) → funciona en `<video>` y descarga sin exponer el volumen.
- La melodía (aprobada por David) va embebida en la composición (`memorial/public/audio/memorial.mp3`).
