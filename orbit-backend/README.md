# orbit-backend

Servicio backend propio de ORBIT en el VPS Contabo (Fase 2 del módulo Tenjo).
Materializa la arquitectura objetivo: lógica crítica, jobs y permisos fuera de
las capas de Supabase. Conecta **directo a PostgreSQL** (red `supabase_default`).

## Qué hace
- **Jobs por cron del VPS** (a diario; cada job decide si aplica según `config_operativa`):
  - `POST /jobs/generar-propuesta` — lun/mié/vie crea el lote PROPUESTO de la
    próxima jornada (mar/jue/sáb) con sus items clasificados y notifica coordinadores.
  - `POST /jobs/alertas` — motor diario: crea alertas persistentes con dedupe y
    auto-resuelve las que ya no aplican (incluye LOTE_SIN_CERRAR).
  - `POST /jobs/grupales` — Reportes Grupales (Fase 5): sincroniza reportes de
    lotes COMPLETADOS, marca vencidos (3er día hábil desde fecha_ingreso) y corre
    el motor de alertas con dedupe.
- **API** (migración gradual desde PostgREST):
  - `GET /health`
  - `GET /tenjo/candidatos` (JWT)
  - `POST /tenjo/generar-propuesta` (JWT + rol COORDINADOR/ADMIN)
  - Reportes Grupales (JWT + rol COORDINADOR/ADMIN): `POST /grupales/sincronizar`,
    `POST /grupales/reportes/:id/generar`, `POST /grupales/reportes/:id/enviar`,
    `POST /grupales/desvincular`; IA (JWT): `POST /grupales/ia/resumen`,
    `POST /grupales/ia/redactar`.
  - Requiere en `.env`: `GHL_TOKEN`, `GHL_LOCATION_ID` (Zolutium) y `CLAUDE_KEY` (IA).
- **Webhook de WhatsApp Cloud API** (línea de veterinarias, migración 086):
  - `GET  /webhook/whatsapp` — verificación de Meta (devuelve `hub.challenge`).
  - `POST /webhook/whatsapp` — eventos entrantes. Valida la firma HMAC del cuerpo
    crudo, responde 200 de inmediato y guarda en background. **Solo recibe: no
    responde mensajes ni toca ningún módulo de Orbit.**
  - `GET  /webhook/whatsapp/eventos` (JWT + COORDINADOR/ADMIN) — últimos eventos,
    para diagnosticar sin abrir la base de datos.
  - Requiere en `.env`: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
    `WHATSAPP_ALLOWED_PHONE_IDS`. Sin el tercero se descarta todo (fail-closed).
  - ⚠️ Lo que ya opera en **Zolutium sigue en Zolutium**: el filtro por
    `phone_number_id` descarta en silencio los números no listados. Pero un
    número de WhatsApp solo puede estar en UNA app de Meta a la vez — al migrar
    el de vets, deja de funcionar en Zolutium (no hay convivencia).
  - ⚠️ `src/whatsapp.js` (emisor Zolutium/GHL) y `src/whatsapp-cloud-webhook.js`
    (receptor Cloud API) son plataformas distintas. No mezclarlos.
- **Bandeja de conversaciones** (`src/whatsapp-cloud.js`, migración 087) — lo que
  consume la pantalla `/whatsapp` de Orbit. Todo con JWT + rol COORDINADOR/ADMIN:
  - `GET  /whatsapp/conversaciones` — lista con nombre resuelto contra
    aliados/clientes, no leídos y estado de la ventana de 24h.
  - `GET  /whatsapp/conversaciones/:contacto` — hilo completo.
  - `POST /whatsapp/conversaciones/:contacto/leido` — marcar leído.
  - `POST /whatsapp/conversaciones/:contacto/enviar` — responder texto libre.
    Requiere `WHATSAPP_ACCESS_TOKEN`. Valida la ventana de 24h ANTES de llamar a
    Meta y devuelve 409 con `ventana_cerrada:true` si ya se cerró.
  - Dos capas: `whatsapp_webhook_events` (crudo, append-only) alimenta
    `whatsapp_mensajes` + `whatsapp_contactos` (normalizado, es lo que se pinta).
    Si la capa 2 fallara, el crudo ya quedó y se puede reconstruir.
  - ⚠️ **Fuera de la ventana de 24h solo se puede escribir con plantilla aprobada**
    — todavía NO implementado. La UI bloquea la caja de texto y lo explica.

## Seguridad
- Jobs: header `x-job-token` (token en `.env`, solo conocido por el cron local).
- API: valida el JWT del auth actual (mismo `JWT_SECRET`) y resuelve el rol
  contra `personal`/`roles_personal` → el permiso vive en el backend, no en RLS.
- El puerto 8787 solo escucha en 127.0.0.1; nginx hace el proxy público.

## Despliegue (en el VPS)
```bash
cd /opt/orbit-backend
# .env: ver .env.example (PGPASSWORD y JWT_SECRET salen de /opt/supabase/docker/.env)
docker compose up -d --build
docker logs -f orbit-backend
```
⚠️ **`docker compose restart` NO relee el `.env`** — conserva el entorno del contenedor
anterior y los cambios de variables se ignoran en silencio. Tras editar `.env` siempre
`docker compose up -d --force-recreate`, y verificar con
`docker exec orbit-backend printenv NOMBRE_VARIABLE`.
Crontab: ver `deploy/crontab.txt`.

### Importar una línea desde Zolutium

La importación histórica nunca escribe directamente en la bandeja. Primero
captura en las tablas privadas de la migración 118 y puede reanudarse por días:

```bash
npm run zolutium:importar -- capturar --linea 573159891247 --dias 1
npm run zolutium:importar -- contactos --linea 573159891247
npm run zolutium:importar -- adjuntos --linea 573159891247
npm run zolutium:importar -- plantillas --linea 573159891247
npm run zolutium:importar -- estado --linea 573159891247
```

Después de migrar el número a Meta y conocer su `phone_number_id`, se publica:

```bash
npm run zolutium:importar -- publicar --linea 573159891247 --phone-number-id ID_DE_META
```

Los mensajes de otras líneas solo se leen transitoriamente para aplicar el
filtro `from/to`; nunca se guardan. La publicación es deduplicable y marca el
historial importado como leído sin afectar mensajes nuevos.

**Nginx — cómo se publica de verdad (verificado 2026-08-05):** el backend sale por
`https://orbit.orbitacac.com/api/…`, servido por el `location /api/` de
`/etc/nginx/sites-enabled/orbit` (`proxy_pass http://127.0.0.1:8787/` con barra final,
que quita el prefijo). **`api.orbitacac.com` no resuelve** — nunca se creó el DNS, así que
`deploy/nginx-api.conf` es config muerta aunque esté habilitada. Ver la cabecera de ese
archivo.

## Actualizar tras cambios de código
```bash
# desde el PC local
scp -i ~/.ssh/orbit_deploy -r orbit-backend/src orbit-backend/package.json root@13.140.139.61:/opt/orbit-backend/
ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 "cd /opt/orbit-backend && docker compose up -d --build"
```
