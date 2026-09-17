# Datos personales: política y autorizaciones

Orbit no tenía política de tratamiento de datos ni pedía autorización en ningún
formulario. Esto lo cierra: una política publicada, una casilla obligatoria en
cada punto donde se captan datos, y la prueba de cada autorización guardada.

Marco: **Ley 1581 de 2012** y **Decreto 1377 de 2013**, compilado en el
**Decreto 1074 de 2015** (Libro 2, Parte 2, Título 2, Capítulo 25).

## Responsable

**MARTEN´S INVERSIONES S.A.S**, NIT 901.792.844-5, que opera como *Camino al
Cielo*. Lo confirmó David el 16-sep-2026: en el repo conviven dos identidades
—los recibos y certificados salen a nombre de «Camino al Cielo» con NIT
901792845-5— y la que responde por los datos es la sociedad.

⚠️ La dirección de notificaciones que usa la política es la operativa de los
recibos (Calle 57 # 80-86, Los Monjes, Engativá). Si el domicilio social de la
sociedad es otro, hay que corregirlo en `src/lib/privacidad.js`.

## Dónde vive el texto

`src/lib/privacidad.js` es la **fuente única**: de ahí salen la página pública,
el aviso corto de las casillas y este documento. Tiene `VERSION` y
`VIGENTE_DESDE`.

**Si el texto cambia, hay que subir `VERSION`.** Cada autorización guarda la
versión aceptada; sin eso, una autorización deja de probar algo el día que el
texto cambie.

La página es la ruta pública `/privacidad`. Orbit corre con HashRouter, así que
la URL real es `https://orbit.orbitacac.com/#/privacidad` — sin el `#` el
servidor entrega el index y la persona termina en el login. Por eso el enlace
sale de `URL_POLITICA` y no se escribe a mano.

## Dónde está la casilla

| Formulario | Quién marca | origen | medio |
|---|---|---|---|
| `/solicitud` | la familia | `SOLICITUD_CLIENTE` | `PORTAL_WEB` |
| `/aliado` (flujo A) | la clínica, por un tercero | `SOLICITUD_ALIADO` | `DECLARADA_POR_ALIADO` |
| `/aliado` (flujo B) | la veterinaria, por sus datos | `AFILIACION_ALIADO` | `PORTAL_WEB` |
| `/fotos` | la familia | `PORTAL_FOTOS` | `PORTAL_WEB` |
| `/planta` | la familia | `PORTAL_PLANTA` | `PORTAL_WEB` |
| `/visita` | la familia | `PORTAL_VISITA` | `PORTAL_WEB` |
| `/registro` (interno) | quien registra, declarando | `REGISTRO_INTERNO` | `DECLARADA_POR_PERSONAL` |

La casilla **nace vacía siempre**. Marcarla por defecto no es autorización: es
un dato puesto por nosotros. Tampoco se guarda en el borrador de `localStorage`
de `/solicitud` ni de `/registro`, para que no aparezca marcada al volver.

Tres redacciones en `components/CasillaDatos.jsx`: `titular` (autoriza por lo
suyo), `tercero` (la clínica declara tener la autorización del dueño) e
`interno` (el equipo deja constancia de una autorización dada por teléfono o
WhatsApp, firmada con su usuario en `declarada_por`).

## Dónde queda la prueba

Tabla `public.autorizaciones_datos` (migración 161). **Solo se agrega**: nunca
UPDATE ni DELETE. Una revocación es otra fila con `accion='REVOCA'`.

Guarda quién autorizó (nombre, documento, teléfono y correo tal como se dieron,
no solo la llave), a qué servicio/cliente/solicitud/aliado corresponde, la
versión de la política, el medio, y —cuando pasa por el backend— la IP y el
navegador.

`anon` solo puede **INSERTAR**: el portal público escribe su propia constancia y
no puede leer las de nadie.

La versión de la política **la manda el frontend**, no la fija el backend. Es a
propósito: lo que hay que probar es qué texto vio la persona, y quien lo mostró
fue su navegador. Un cliente con el build viejo en caché manda la versión vieja,
que es exactamente lo que aceptó.

## Cómo se comporta si falla

- `/solicitud`: la constancia se guarda **antes** que la solicitud. Si no se
  puede probar la autorización, no nos quedamos con los datos.
- Portales de fotos, planta y visita: la constancia va **dentro de la misma
  transacción** que el resto. O quedan las dos cosas, o no queda ninguna.
- `/aliado`: no hay transacción en ese módulo, así que la constancia va antes
  del INSERT de la solicitud. Un fallo posterior deja una constancia huérfana,
  que es inofensiva.
- `/registro` interno: el servicio ya está creado cuando se registra la
  constancia. Si eso falla, **no se tumba el servicio**: se muestra el error
  para que alguien lo resuelve a mano.

El backend **rechaza con 422 `falta_autorizacion`** cualquier envío de los
portales sin la autorización. Por eso el orden de despliegue importa:
**migración → frontend → backend**. Al revés, una familia con el build viejo
queda bloqueada.

## Publicación de memoriales en redes: sin casilla, por decisión

Orbit publica los memoriales en Instagram (`digitales-ig.js`) y a mano en
YouTube. Esa foto la entrega la familia para que le hagamos su recordatorio, no
para publicarla, así que es una finalidad distinta.

**David decidió el 17-sep-2026 no poner una casilla**, para no agregarle un paso
a la publicación. En su lugar, la política declara la finalidad (versión 1.1) y
la regla es:

> A redes solo va **la mascota**. Si en la pieza aparece una persona, o se
> identifica al dueño, no se publica.

Con esa regla lo publicado deja de ser dato personal asociable a alguien por
quien lo ve, que es lo que sostiene la decisión. La política también dice que
basta pedirlo para que no se publique, o para retirarlo si ya está.

La regla vive **donde se toma la decisión**: una línea bajo el memorial APROBADO
en la pantalla de Digitales, que es el único momento en que alguien mira la pieza
antes de publicarla. En un documento no la leería nadie en ese instante.

⚠️ Si algún día se quiere publicar piezas con personas, ahí sí hace falta la
casilla opcional. La tabla ya está lista: `finalidades` es un arreglo, así que
sería otro elemento y no otra tabla.

## Seguridad de la tabla (migración 162)

La 161 dejó a `anon` con INSERT libre. Revisado el 17-sep-2026 y cerrado:

- **`anon` solo puede escribir lo del portal `/solicitud`**: `origen`
  `SOLICITUD_CLIENTE`, `medio` `PORTAL_WEB`, `accion` `AUTORIZA`, y **todos los
  ids en NULL**. Antes podía escribir una fila diciendo que un coordinador
  declaró la autorización, o colgarla del `servicio_id` de otra familia. Nadie
  gana nada con eso, pero envenena lo único que la tabla existe para sostener.
- **`authenticated` solo puede escribir el registro interno**
  (`REGISTRO_INTERNO` + `DECLARADA_POR_PERSONAL`), así que una sesión del equipo
  no puede fabricar una autorización que parezca marcada por la familia.
- **Topes de largo** en cada columna de texto y en `finalidades`. Sin ellos,
  cualquiera con la llave pública —que va en el bundle— podía dejar filas de
  megabytes. `src/lib/autorizaciones.js` recorta con los mismos topes para que
  un correo larguísimo no tumbe el formulario con un error de constraint.
- `anon` **no puede leer** nada: no tiene GRANT de SELECT.

Probado contra producción dentro de una transacción con ROLLBACK: el INSERT
legítimo del portal pasa, y los cuatro intentos —firmar como personal, colgarse
de un servicio ajeno, leer la tabla y meter 5.000 caracteres— quedan bloqueados.

### La IP: `x-forwarded-for` no servía

nginx la arma con `$proxy_add_x_forwarded_for`, que **añade** la IP real a lo
que el cliente haya mandado. El código tomaba el primer valor, o sea el que
escribe quien llama: cualquiera podía firmar su autorización con la IP que
quisiera. Ahora se usa `x-real-ip` —que nginx pone desde el socket— y del
`x-forwarded-for` solo el último valor.

Además se valida el formato. La columna es `inet`, así que una cabecera con
basura (`X-Forwarded-For: pwned`) reventaba el INSERT **y con él toda la
petición de la familia**: no era solo un dato sucio, era una caída.

⚠️ Las autorizaciones de `/solicitud` **no llevan IP**, a propósito: ese portal
escribe directo a la base como `anon` y una IP puesta por el navegador no prueba
nada. Si algún día se quiere esa prueba, hay que mover ese guardado al backend,
como los otros portales.

## La capa de nginx (17-sep-2026)

Esto NO está en el repo, vive en el VPS. Respaldos en `/root/respaldo_*.conf`.

- **`/etc/nginx/conf.d/00_cloudflare_realip.conf`** (nuevo): `set_real_ip_from`
  con los rangos de Cloudflare + `real_ip_header CF-Connecting-IP`. Sin esto,
  todo lo que Cloudflare proxea llegaba con la IP de Cloudflare: **los límites
  por IP contaban a todos los visitantes como uno solo**, y la IP que
  guardábamos como prueba no era la de nadie. Solo se cree la cabecera cuando la
  conexión viene de Cloudflare, así que quien golpee la IP del servidor directo
  no puede inventársela.
- **`orbit_autorizaciones`** (zona nueva, 20 POST/min por IP, ráfaga 10) sobre
  `location = /rest/v1/autorizaciones_datos`. Es la ruta que escribe `anon`
  desde `/solicitud` y también el registro interno, así que el tope deja
  trabajar a una persona —una autorización por servicio registrado— y corta un
  bucle.

Ya existían: `orbit_solicitudes` (2 POST/min en `/rest/v1/solicitudes_servicio`)
y `portal_pub` (30 POST/min en `/api/portal/`).

Probado en producción tras recargar: la app carga, el backend responde, una
autorización legítima del portal entra con 201, y a la petición número 12 de una
ráfaga nginx contesta 429.

## Lo que quedó pendiente

- **Registro Nacional de Bases de Datos (RNBD) de la SIC.** Verificar si la
  sociedad supera el umbral de activos que obliga a registrarse.
- **Canal formal de PQR de habeas data.** Hoy es el correo y el WhatsApp de la
  empresa; no hay bandeja aparte ni control de los plazos de los artículos 14 y
  15 dentro de Orbit.
- **Datos que ya están en la base sin autorización registrada.** Lo anterior a
  esta fecha no tiene constancia. El Decreto 1074 pide pedir autorización a los
  titulares ya cargados; eso es una campaña, no un cambio de código.
