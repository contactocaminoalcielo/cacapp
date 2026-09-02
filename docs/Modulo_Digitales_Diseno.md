# Módulo "Digitales" — Diseño (2026-07-08)

> **ESTADO 2026-07-08: DESPLEGADO EN PRODUCCIÓN** (commit e6afa6c).
> Migración 035 aplicada, backend recreado en el VPS, frontend por Actions.
> Fases 1 y 2 implementadas; la publicación automática de Instagram queda
> **inactiva hasta configurar** `IG_USER_ID` + `IG_ACCESS_TOKEN` en
> `/opt/orbit-backend/.env` (checklist en la sección 4). Mientras tanto la UI
> lo indica y el enlace de Instagram se registra a mano, como antes.
> Plantillas editables por SQL en `config_operativa` módulo `DIGITALES`
> (`mensaje_cliente`, `caption_instagram`).

> Evolución del módulo Memoriales → **Digitales**: reúne las tres piezas digitales
> publicables de un servicio (Memorial, Video conmemorativo, Short), controla sus
> enlaces, gestiona la publicación (Instagram automático / YouTube manual) y el
> envío al cliente por WhatsApp.

## 1. Realidad actual (verificada en prod 2026-07-08)

| Pieza | Recordatorio en DB | Servicios con la pieza | Se produce en | Se publica en |
|---|---|---|---|---|
| Memorial | `Memorial digital` | 362 | **Orbit** (Remotion, orbit-backend) | Instagram |
| Video conmemorativo | `Video conmemorativo` | 79 | Canva (manual) | YouTube |
| Short | `Short YouTube` | 79 | Canva (manual) | YouTube (Shorts) |

- La tabla `memoriales` (migración 025) solo cubre el memorial: pipeline
  `GENERANDO → GENERADO → APROBADO → PUBLICADO`, con `instagram_url` pegado a mano.
- `servicio_recordatorios` ya tiene las filas de las 3 piezas por plan, con estados
  `PENDIENTE / EN_PROCESO / LISTO / ENTREGADO / NA`.
- El certificado de entrega (`lib/certificadoEntrega.js`) ya separa
  `categoria='digital'` como "enviados digitalmente".
- Hoy el envío al cliente es artesanal: botón "copiar enlaces" y WhatsApp a mano.
- No hay registro de **qué se envió, a quién ni cuándo**.

## 2. Objetivo del módulo

1. **Una sola vista por servicio** con sus piezas digitales esperadas y el estado de cada una.
2. **Publicación automática en Instagram** del memorial (Meta Graph API) con
   extracción automática del permalink.
3. **YouTube manual por ahora**: video/short se hacen en Canva → se publican a mano
   → se pega el enlace en Orbit (con validación y normalización).
4. **Envío al cliente controlado**: mensaje WhatsApp con los enlaces, registrado
   (quién/cuándo/qué enlaces), y que al enviarse marque los
   `servicio_recordatorios` digitales como `ENTREGADO` (cierra el ciclo con
   Producción y el certificado de entrega).

## 3. Modelo de datos (migración 035)

### 3.1 `memoriales` → `piezas_digitales` (rename + extensión)

Renombrar conserva historial y evita mover archivos. Cambios:

```sql
ALTER TABLE public.memoriales RENAME TO piezas_digitales;
ALTER TABLE public.piezas_digitales
  ADD COLUMN tipo text NOT NULL DEFAULT 'MEMORIAL'
    CHECK (tipo IN ('MEMORIAL','VIDEO','SHORT')),
  ADD COLUMN plataforma text
    CHECK (plataforma IN ('INSTAGRAM','YOUTUBE')),   -- derivada del tipo al insertar
  ADD COLUMN url_publica text,                        -- permalink IG o URL YouTube
  ADD COLUMN publicacion_media_id text,               -- id del media en la Graph API
  ADD COLUMN publicado_auto boolean NOT NULL DEFAULT false;
-- UNIQUE(servicio_id) → UNIQUE(servicio_id, tipo)
-- backfill: tipo='MEMORIAL', plataforma='INSTAGRAM', url_publica=instagram_url
```

- Estados: los actuales + **`PENDIENTE`** (pieza esperada, aún sin nada — estado
  inicial de VIDEO/SHORT) y **`PUBLICANDO`** (contenedor IG creado, esperando
  confirmación de Meta).
- Para VIDEO/SHORT los campos de render (`formato`, `ajuste_foto`, `archivo_path`,
  `intentos`) quedan NULL; su ciclo es `PENDIENTE → PUBLICADO` (pegar enlace).
- `instagram_url` se conserva una migración como columna legada y luego se elimina
  (el backend pasa a leer/escribir `url_publica`).
- Mapping pieza→recordatorio en `config_operativa` módulo `DIGITALES`
  (`recordatorio_memorial_id`, `recordatorio_video_id`, `recordatorio_short_id`)
  para derivar qué piezas espera cada servicio desde `servicio_recordatorios`
  (`estado <> 'NA' AND origen <> 'REMOVIDO'`).

### 3.2 `digitales_envios` (nueva)

Registro de cada envío al cliente:

```sql
CREATE TABLE public.digitales_envios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id  uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  canal        text NOT NULL DEFAULT 'WHATSAPP_MANUAL'
                 CHECK (canal IN ('WHATSAPP_MANUAL','ZOLUTIUM')),
  telefono     text,
  enlaces      jsonb NOT NULL,        -- [{tipo, url}]
  mensaje      text,
  enviado_por  uuid REFERENCES public.personal(id),
  enviado_en   timestamptz NOT NULL DEFAULT now()
);
```

Ambas tablas: mismo patrón que 025 — RLS habilitado sin policies, acceso solo vía
orbit-backend (rol postgres). GRANTs revocados a anon/authenticated.

### 3.3 Efecto sobre `servicio_recordatorios`

Al registrar un envío, el backend marca `estado='ENTREGADO'` en las filas de los
recordatorios digitales incluidos en ese envío. Así Producción, el
ModalPreparaEntrega y el certificado reflejan la realidad sin pasos extra.

## 4. Publicación automática en Instagram (memorial)

**Método: Meta Graph API — Content Publishing (Reels).** Es la única vía
soportada: la API ya no publica video de feed, solo `media_type=REELS`
(y STORIES). Consecuencia de diseño: **la pieza que se auto-publica debe ser la
vertical 1080x1920**; el formato 4:5 queda para publicación manual si se quiere
en el feed.

Flujo en orbit-backend (nuevo `src/digitales-ig.js` + job):

1. `APROBADO` + acción "Publicar en Instagram" → estado `PUBLICANDO`.
2. `POST /{ig_user_id}/media` con `media_type=REELS`,
   `video_url=<enlace firmado del mp4>` (el actual, TTL 6 h, sirve porque Meta lo
   descarga en minutos), `caption` desde plantilla en config
   (ej.: `"En memoria de {mascota} 🕊️ #caminoalcielo"`).
3. Poll `GET /{container_id}?fields=status_code` hasta `FINISHED` (o `ERROR`).
4. `POST /{ig_user_id}/media_publish` → `media_id`.
5. `GET /{media_id}?fields=permalink` → guarda `url_publica`, `publicado_auto=true`,
   estado `PUBLICADO`. En error → estado `ERROR` con detalle, reintento manual.

El poll lo hace el job existente de cron del VPS (o un setInterval del proceso,
como el poll de render actual). Fallback siempre disponible: pegar la URL a mano
(igual que hoy) → `publicado_auto=false`.

**Prerrequisitos que solo David puede hacer (una vez):**
- [ ] Cuenta de Instagram en modo **profesional** (Business/Creator).
- [ ] Vincularla a una página de Facebook.
- [ ] Crear app en developers.facebook.com (tipo Business). En modo desarrollo
      basta para publicar en cuentas propias (rol admin/tester en la app) —
      **no requiere App Review**.
- [ ] Generar token de larga duración (60 días) con
      `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
      `business_management` → variable de entorno del backend.
- Cron mensual en el backend refresca el token antes de vencer (si falla,
  alerta en el módulo).

Límite de la API: 25 publicaciones/día por cuenta — sobra para la operación.

## 5. YouTube (video y short) — manual por ahora, y por qué

Se queda manual deliberadamente:
1. Las piezas se hacen en **Canva** — Orbit no tiene el archivo, no hay nada que subir.
2. La YouTube Data API bloquea en "privado" los videos subidos por apps no
   auditadas por Google (auditoría de compliance) — burocracia desproporcionada.

En Orbit: campo "Pegar enlace de YouTube" por pieza, con validación/normalización
(`youtube.com/watch?v=`, `youtu.be/`, `/shorts/`) → guarda `url_publica`, estado
`PUBLICADO`. Si algún día los videos salen de Orbit (Remotion), se reevalúa la
subida automática.

## 6. Envío al cliente

- **Fase 1 — wa.me (voz del coordinador):** botón "Enviar por WhatsApp" cuando el
  servicio tiene todas sus piezas esperadas en `PUBLICADO`. Abre wa.me con mensaje
  precompuesto (plantilla en config, con nombre de mascota y enlaces) y registra el
  envío en `digitales_envios` + marca `ENTREGADO`. Coherente con la regla de
  canales: wa.me para lo que "dice" el coordinador.
- **Fase 3 — Zolutium (IMPLEMENTADA 2026-07-09, migración 040):** botón **"Enviar"**
  en la pestaña Para enviar. El backend (`POST /digitales/:servicioId/enviar-zolutium`)
  envía la plantilla HSM aprobada vía `enviarPlantillaGenerica` (mismo contrato real
  de Zolutium/GHL que solicitud de imágenes) y persiste la evidencia
  (`message_id`, `contact_id`, `estado`, `plantilla`) en `digitales_envios` + marca
  `ENTREGADO`, en una sola operación. Dos plantillas aprobadas:
  - `envio_digitales_individual` (es_MX) — servicios que llevan los 3 digitales
    (standard, exclusivos, premium, compets, plata, oro, diamante):
    `{{1}}` video · `{{2}}` short · `{{3}}` memorial.
  - `envio_digitales` (es) — solo memorial (básicos y ecogrupales): `{{1}}` memorial.

  La plantilla se elige por las **piezas que el servicio lleva** (esperadas por
  `recordatorios_tipo` + piezas creadas), no por lista de planes. Combinación mixta
  (p. ej. le quitaron el short) → **no hay envío automático**, solo manual (decisión
  David 2026-07-09). Config en `config_operativa` DIGITALES: `usar_plantilla`,
  `plantilla_completos`, `plantilla_memorial` (jsonb `{nombre, idioma, categoria}`).
  Un envío automático exitoso por servicio (anti doble clic); los intentos con
  `estado='ERROR'` no marcan ENTREGADO y el servicio sigue en "Para enviar" con el
  error visible y opción de reintentar.

  **Límite de Meta y verificación post-envío (fix 2026-07-14, commit 12090b3):**
  Meta limita a **1024 caracteres** el texto de la plantilla + parámetros del
  cuerpo. Las URLs de Instagram copiadas con "copiar enlace" traen
  `?utm_source=...&igsh=...` (~50 chars extra) y con la plantilla `envio_digitales`
  (cuerpo ~950 chars) desbordaban el límite → Meta rechazaba con `#132005` **de
  forma asíncrona**: GHL responde 201 + `messageId` y el `status: failed` solo
  aparece ~3 s después en `GET /conversations/messages/{id}`. 29 de 37 envíos
  fallaron así en silencio (quedaban ENVIADO + ENTREGADO sin llegar al cliente).
  Mitigación en `orbit-backend/src/digitales.js`:
  - `limpiarUrlInstagram()` canoniza reel/p/tv a `https://www.instagram.com/reel/<id>/`
    (~43 chars) al registrar el enlace (`publicarManual`) y al armar los
    `bodyParams` (`enviarZolutium`).
  - Tras el envío, el backend espera 5 s y consulta el estado real con
    `consultarEstadoMensajeGHL()` (`whatsapp.js`); si Meta rechazó, el envío se
    persiste como `ERROR` con el motivo y NO marca ENTREGADO.

  ⚠️ La plantilla `envio_digitales` quedó con ~17 chars de margen (cuerpo 970 +
  URL del reel = 1007/1024): si se alarga su texto en Meta, vuelve a desbordar.
  Validar longitud antes de editarla.

  **Enlaces fijos y evidencia (migración 055, 2026-07-16):** el módulo solo
  conoce MEMORIAL/VIDEO/SHORT, pero `envio_digitales` **entrega tres
  recordatorios más con enlace fijo escrito en su propio cuerpo**: Audio de
  despedida, Herramientas de superación de duelo y Tarjeta de oración (los
  enlaces viven en Meta, no en Orbit — decisión David 2026-07-16). Eso causaba
  dos síntomas con la misma raíz:
  - *La evidencia mentía*: `digitales_envios.mensaje` guardaba el resumen que
    arma `construirMensajeCliente` con las piezas de `piezas_digitales`, o sea
    solo `• Memorial: <url>`. El cliente **sí** recibía la plantilla completa
    (comprobado: la ventana de 24 h estaba cerrada y el mensaje quedó
    `delivered`, cosa que Meta solo hace con plantilla), pero en Orbit y en
    Zolutium se leía como si se hubiera enviado solo el memorial.
  - *Los fijos nunca se marcaban `ENTREGADO`*: ~80 servicios por recordatorio
    quedaron `PENDIENTE` en Producción y en el certificado de entrega pese a
    estar entregados.

  El jsonb de cada plantilla en `config_operativa` ahora la describe:
  - `texto` — espejo del cuerpo aprobado con `{{n}}`; es lo que se guarda como
    evidencia (resuelto con los `bodyParams`). Sin él se cae al resumen viejo.
  - `cubre` — ids de recordatorio de enlace fijo que la plantilla entrega; el
    backend los marca `ENTREGADO` junto al memorial. El memorial NO va aquí: es
    `{{1}}`, variable, y ya se marca por `recordatorios_tipo`.

  **Cuerpo de `envio_digitales_individual` (migración 139, pendiente de Meta):**
  la 040 la dejó sin `texto`, así que para los servicios con los 3 digitales la
  evidencia y la vista previa siguen mostrando el resumen de enlaces. La 139
  trae el cuerpo espejado y su `cubre` (audio, herramientas, tarjeta de
  oración), y **solo debe aplicarse cuando ese mismo texto esté aprobado en
  Meta, carácter por carácter**. Presupuesto: 807 chars crudos → 920 resueltos
  (936 en unidades UTF-16) de los 1024, con los enlaces de Drive sin
  `?usp=sharing`. Sin backfill: no se sabe qué decía el cuerpo anterior.

  ⚠️ **`texto` y `cubre` no se pueden derivar**: la API de GHL no expone el
  cuerpo de la plantilla (401 en `/businesses/templates`). Si se edita la
  plantilla en Meta, hay que editarlos aquí a la par o la evidencia vuelve a
  divergir. `envio_digitales_individual` aún no los tiene → conserva el
  comportamiento viejo hasta que se cargue su texto.

  Nota: `Día de amor y milagrino` lo llevan ECO_GRUPAL/BASICO/BRONCE pero la
  plantilla no lo menciona → queda fuera de `cubre` y sigue `PENDIENTE` a
  propósito (David 2026-07-16).
  **Envío automático apagado y vista previa de la plantilla (2026-08-31,
  migración 138):** la 135 había encendido el job `jobEnviosDigitales`, que
  barría los servicios con todas sus piezas publicadas y mandaba la plantilla
  solo: apenas se publicaba la última pieza salía el WhatsApp sin que nadie
  viera qué se estaba mandando. Se apagó (`envio_automatico_activo = false`);
  el job queda en el código y respeta la bandera — al reencenderlo hay que
  mover también `envio_automatico_desde` o se dispara de golpe todo lo
  acumulado.

  Además, el módulo nunca mostraba la plantilla: el `<textarea>` de "Para
  enviar" es el mensaje del envío MANUAL (el resumen `• Memorial: <url>`), no
  el cuerpo aprobado en Meta. Ahora `enviarAutomatico` está partido en
  `prepararEnvioAutomatico` (lecturas, validaciones, elección de plantilla y
  `bodyParams`) + el envío, y `GET /digitales/:servicioId/preview-envio` sirve
  esa misma preparación sin enviar nada: la tarjeta muestra el cuerpo exacto
  con los enlaces resueltos, qué es cada `{{n}}` y los caracteres contra el
  límite de 1024. Si la plantilla no tiene `texto` espejado, la vista previa lo
  dice en vez de hacer pasar el resumen por la plantilla (es el caso de
  `envio_digitales_individual`).

- El envío manual wa.me sigue disponible como alternativa (y único camino en
  combinaciones mixtas). También se permite envío parcial manual y reenvío
  (queda otro registro en el historial).

## 7. UI — página `/digitales` (reemplaza `/memoriales`)

Sidebar: "Digitales" (icono Clapperboard/Sparkles). Tabs:

1. **Pipeline** — tarjetas por servicio (agrupa sus piezas). Por pieza:
   - Memorial: lo actual (generar, encuadre, preview, aprobar) + botón
     **"Publicar en Instagram"** (auto) y fallback pegar enlace.
   - Video / Short: estado + campo pegar enlace YouTube.
2. **Para enviar** — servicios con todo publicado y sin envío registrado:
   teléfono del cliente, preview del mensaje, botón WhatsApp, copiar enlaces.
3. **Enviados** — historial de `digitales_envios` (quién, cuándo, enlaces, reenviar).
4. **Candidatos** — lo actual (por generar memorial).

Roles: los mismos del módulo actual (ADMIN/COORDINADOR; PRODUCTOR si hoy lo ve).

## 8. Orden de implementación

| Fase | Contenido | Dependencias externas | Despliegue |
|---|---|---|---|
| **1** | Migración 035 (rename + `tipo` + `digitales_envios`), endpoints `/digitales` en orbit-backend, página `/digitales` (pipeline + enlaces YT manuales + envío wa.me + registro + `ENTREGADO`) | Ninguna | migración VPS + backend tar+SSH + `git push` frontend |
| **2** | Publicación automática IG: `digitales-ig.js`, estado `PUBLICANDO`, permalink automático, refresh de token | Checklist Meta de David (sección 4) | backend + env vars en VPS |
| **3** ✅ 2026-07-09 | Envío automático Zolutium (botón "Enviar", 2 plantillas aprobadas, evidencia en `digitales_envios`) | Plantillas `envio_digitales_individual` (es_MX) y `envio_digitales` (es) aprobadas ✅ | migración 040 VPS + backend tar+SSH + `git push` frontend |

## 9. Decisiones abiertas (para David)

1. **Formato del memorial auto-publicado**: la API solo publica Reels (9:16).
   ¿Pasamos el formato por defecto a 1080x1920, o generamos ambas y el 4:5 queda
   para publicación manual en feed cuando se quiera?
2. **Caption de Instagram**: texto/hashtags de la plantilla (editable en config).
3. ¿El "Video conmemorativo" y el "Short" van siempre a YouTube, o el short a
   veces también a Instagram? (afecta la validación del enlace).
4. Plantilla del mensaje de WhatsApp al cliente (tono, orden de los enlaces).
