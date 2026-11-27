# Módulo VENTAS POSTERIORES (oferta posterior al servicio)

**Ruta interna:** `/ventas-posteriores` · **Página:** `src/pages/VentasPosteriores.jsx`
**Portal de la familia:** `/#/oferta/CODIGO[/recordatorios|planes|cedulas]` · `src/pages/OfertaCliente.jsx`
**Roles:** ADMIN / COORDINADOR (todo). PRODUCTOR recibe el aviso y ve la compra en Producción.
**Migración:** `migrations/210_oferta_posterior_ventas.sql`
**Backend:** `orbit-backend/src/oferta-posterior.js` (automatización) · `oferta-portal.js` (portal) ·
`ventas-posteriores.js` (oportunidades) · `oferta-posterior-reglas.js` (reglas puras, con pruebas)
**Origen:** REPORTE ORBIT 2026-11-17 (y 27-nov: compró vs. solo interés) · **Estado:** en producción desde el 18-nov.

## Qué es

Unos dos meses después del fallecimiento —y nunca pegado al duelo inicial— Orbit le escribe a la
familia por WhatsApp un mensaje con cuatro botones. Cada botón la lleva a un portal propio:

| Botón (texto exacto en Meta) | A dónde lleva | Descuento (configurable) |
|---|---|---|
| `Recordatorios adicionales` | Catálogo con foto de lo que NO venía en su servicio | 30 % |
| `Planes preexequiales` | Planes para sus otras mascoticas + formulario | 50 % |
| `Cedulas para mascotas` | Cédulas con QR para sus mascoticas vivas | 50 % |
| `No deseo informacion` | La marca para no recibir más ofertas | — |

Es **independiente de las condolencias** (migr. 209) y sale después de ellas.

> 🪤 Los botones van **sin emoji y sin tilde**, y miden ≤ 25 caracteres: Meta rechaza la plantilla
> si no (error 2388060, ya pasó con la encuesta). `Recordatorios adicionales` mide justo 25.

## Cuándo sale y a quién no

`fecha_programada = GREATEST(fallecimiento + 60, condolencia + 30, entrega + 15)`. Solo servicios
**ENTREGADOS** (por `servicios.estado`, no por los ítems — misma trampa de la 209). Job a las
**14:00, lunes a viernes**, sin festivos (lejos de la encuesta de las 10:00 y la condolencia de las 11:00).

No se le ofrece a (el motivo queda escrito en la fila):

- quien **pidió no recibir información** (`oferta_exclusiones`) — nunca se salta;
- quien calificó **Malo** la encuesta post-entrega (`excluir_calificacion_mala`);
- quien tiene una **QUEJA o RECLAMO** en ese servicio (`excluir_con_queja`);
- plan **Desamparado**, sin WhatsApp, servicio cancelado;
- la condolencia que coordinación **excluyó a mano** (si no era momento de un mensaje de cariño,
  menos de una oferta);
- la **segunda mascotica** de una familia que ya recibió la oferta (`dias_entre_ofertas`, 180).

Las reglas se miran **tres veces**: al preparar, antes de cada corrida y justo antes de enviar.
Preparar hace 20 días no autoriza a enviar hoy. Coordinación puede **volver a incluir** una
excluida (queda `forzada`: ya no la sacan las reglas de calificación/queja; la de «no deseo
información» sí).

🔒 `PQRS` no tiene estado «abierta» en Orbit (la tabla solo registra): por eso la regla es
«tiene una queja o reclamo en ese servicio», no «tiene una PQRS abierta».

## El portal de la familia

Página pública sin sesión; la llave es el `codigo` de la oferta (32 hex). Vence a los
`dias_vigencia` (30) del envío.

- **El precio nunca viene del navegador**: el backend lo recalcula con el descuento al crear.
- **El código da acceso a comprar, no a leer**: el portal no devuelve teléfono, cédula ni
  dirección de la ficha (un enlace reenviado no filtra datos).
- **Recordatorios**: productos con «Mostrar en catálogo público», que no sean cédula y que **no
  vinieran ya** en su servicio. La compra es de la mascotica del servicio.
- **Cédulas**: productos del catálogo cuyo nombre contiene «cédula». Es para una mascotica
  **viva**: se registra en la ficha de la familia. Lleva **QR** (ver abajo).
- **Planes**: nivel × tipo con **precio en Configuración › Afiliaciones** (sin precio, no se
  ofrece). El texto, los beneficios y la imagen de cada plan los escribe coordinación en
  `/ventas-posteriores › Configuración`. Las condiciones salen del contrato vigente.
- Las fotos y el comprobante usan la misma carpeta temporal del catálogo público
  (`fotos-clientes/compra-web/<borrador>/`): no se abrió ninguna política de almacenamiento nueva.
- Toda escritura exige la casilla de datos (`autorizaciones_datos.origen = 'OFERTA_POSTERIOR'`).

Recordatorios y cédulas crean una **compra normal** del módulo Compras de recordatorios, con
`origen = 'OFERTA_POSTERIOR'` y `venta_posterior_id`. En Producción y en la compra se rotula
**«COMPRA ADICIONAL – RECORDATORIO»** (o «– CÉDULA»).

> 🪤 En el frontend, preguntar por `origen === 'CATALOGO_WEB'` deja a las compras de la oferta sin
> dirección de entrega ni comprobante a la vista. Usar `esPedidoDelCliente(origen)` de
> `src/lib/comprasRecordatorios.js`.

## Pre-exequiales: Orbit NO crea contratos

El formulario es una **solicitud**. Estados (los nueve del reporte + cierre):

`INTERESADO → FORMULARIO_INICIADO → FORMULARIO_COMPLETO → PENDIENTE_PAGO → PAGO_REPORTADO →
PAGO_VALIDADO → PENDIENTE_CONTRATO → CONTRATO_GENERADO → AFILIACION_ACTIVA` · `CERRADA_SIN_VENTA`

- La **familia** solo avanza, y como mucho hasta `PAGO_REPORTADO` (sube el comprobante).
- **Validar el pago** lo hace una persona en `/ventas-posteriores` → queda `PENDIENTE_CONTRATO`.
- Con el pago validado, «Crear el contrato en Pre-exequiales» abre `/presequiales` con el modal de
  nueva afiliación **ya diligenciado** (titular, mascotas, plan y descuento `OFERTA_POSTERIOR`).
  Coordinación revisa y pulsa «Afiliar» como siempre; al guardar, la venta queda en
  `AFILIACION_ACTIVA` con su número de contrato.
- **Sin pago validado no hay contrato ni afiliación activa**: lo impide el backend (409) **y** un
  CHECK de la base (`ventas_post_contrato_exige_pago`).
- El descuento **no se suma** a los otros de afiliación: se aplica el mayor (regla de la 077). Y
  abarata la afiliación, no la activación (la cláusula 5×/3× va sobre el precio de lista).
- El precio queda **congelado** en la solicitud (`valor_lista`, `descuento_pct`, `valor`): el
  contrato sale por lo que vio la familia aunque después cambie la configuración.

## El QR de la cédula

`orbit-backend/src/pdf-plantillas/cedula-mascota.js`. Se genera del **número del propietario** y
abre un WhatsApp hacia él con el mensaje «Hola, encontré a X y quiero ayudar a que vuelva a casa».
Aplica a **todas** las cédulas, no solo a las de la oferta. Sin celular válido (10 dígitos, empieza
por 3) la cédula sale **sin** QR — mejor que un QR a un número roto. Dependencia nueva del backend:
`qrcode` (cargada con `import()` dentro de un `try`: si faltara, la cédula se imprime igual).

## Modelo de datos (migr. 210)

| Tabla | Para qué |
|---|---|
| `ofertas_posteriores` | Una por servicio: programación, envío, respuesta, `codigo` del portal |
| `ventas_posteriores` | Una por oferta y categoría: estado, solicitud, precio congelado, pago |
| `venta_posterior_eventos` | Bitácora de cada venta (`por` NULL = la familia o el sistema) |
| `oferta_exclusiones` | «No contactar»: por cliente o por los últimos 10 dígitos del WhatsApp |

Además: `compras_recordatorios.venta_posterior_id`; los CHECK de `compras_recordatorios.origen`,
`autorizaciones_datos.origen` y `afiliacion_contratos.descuento_motivo` admiten el valor nuevo.

🔒 Las cuatro tablas nuevas **no están abiertas a `authenticated`** (RLS sin políticas): la solicitud
trae cédula, dirección y teléfono. Todo se lee y escribe por orbit-backend, que exige rol.

Configuración: `config_operativa`, módulo `OFERTA_POSTERIOR` (20 claves). Se edita en
`/ventas-posteriores › Configuración`; el interruptor, en `/automatizaciones`.

## Qué manda cada cosa (un solo dueño)

| Qué | Dónde se cambia |
|---|---|
| Encender / apagar el envío | `/automatizaciones` (al encender, `arranque_desde` = hoy) |
| Descuentos, días, a quién no se le ofrece, texto e imagen de los planes | `/ventas-posteriores › Configuración` |
| Qué productos se ofrecen, su precio y su foto | Configuración › Recordatorios |
| Precio de cada plan | Configuración › Afiliaciones |
| Valor del envío y datos de pago | Los del catálogo público (los datos de pago se pueden pisar aquí) |


## Compró o solo miró (REPORTE ORBIT 27-nov)

Tocar un botón o abrir el enlace crea la oportunidad, pero **no es una venta**. Antes se
presentaba como tal: Diseño recibía «🔔 NUEVA OPORTUNIDAD» (33 avisos en 8 días, ninguna compra)
y en la lista contaba como «abierta», sin producto. Desde el 27-nov:

- **Interés no avisa a nadie.** Ni el botón de WhatsApp ni abrir el portal mandan notificación.
  Los avisos que quedan son de hechos: compra (🛒/🪪 COMPRA ADICIONAL, a Diseño), solicitud de
  plan y pago reportado (a coordinación).
- **La lista se parte en tres** (lo calcula el backend, `grupo` en `listarVentas`):
  **Compraron** (recordatorios/cédulas con compra viva; pre-exequial con la solicitud enviada) ·
  **Solo interés** · **Cerradas sin venta**. Se abre en «Compraron» y cada fila dice QUÉ compró
  (`compras_items`: «Huella 3D ×2»).
- **«Compra registrada» exige una compra con productos.** Ya no se puede marcar a mano con una
  nota (`puedePasarCoordinacion` → 409).
- **Venta cerrada por chat o teléfono**: en el detalle, «Registrar la compra» abre el formulario
  de Compras de recordatorios con la familia, la mascotica del servicio (o elegir una viva, si es
  cédula) y el precio con el descuento de la oferta ya puestos. `POST /compras-recordatorios` con
  `venta_posterior_id`: la compra nace `origen = 'OFERTA_POSTERIOR'` con `registrado_por`, en la
  MISMA transacción la oportunidad pasa a `COMPRA_REGISTRADA` (`ligarCompraAVenta`) y, tras el
  COMMIT, Diseño recibe el aviso. Entra sola al tablero de Producción con la marca 🎁.

## Botones de enlace, tablero y entrega (REPORTE 27-nov, 2ª parte)

- **El primer mensaje abre el enlace.** Plantilla NUEVA `oferta_posterior_enlaces` (MARKETING):
  mismo cuerpo, botones «Recuerdos y cedulas» y «Planes preexequiales» (ENLACE; Meta deja máximo
  **dos**) + «No deseo informacion» (respuesta rápida, mismo texto de siempre → sigue dando de
  baja por el webhook). El enlace no admite el `#` del portal: apunta a
  `/api/portal/oferta-ir/<recuerdos|planes>/{{1}}` (`{{1}}` = código) y `destinoDeEnlace` redirige
  a `/#/oferta/CODIGO/recuerdos` (inicio con recordatorios y cédulas) o `/planes`, anotando
  `respuesta`/`respondido_en` si estaban vacíos (los robots de vista previa no cuentan).
  Se crea con `crear-plantilla-oferta-posterior.mjs crear --enlaces`; al aprobarse,
  `estado --enlaces` siembra `OFERTA_POSTERIOR.plantilla` con `enlaces: true` y desde ahí sale
  esa. Los botones de la vieja que ya tienen las familias siguen funcionando. 🪤 El envío pasa el
  código en `buttonParams` y `mandarPlantilla` lo repite en CADA botón de enlace con hueco (Meta
  rechaza si falta en uno); por GHL no se puede (se lanza error).
- **Tablero de Producción:** las compras de la oferta posterior van en **rosado** con la cinta
  «🎁 RECORDATORIO ADICIONAL · CR-n» (las compras sin servicio siguen en morado). Botón
  **«🛒 Solo compras»** en las vistas Por servicio y Tabla: deja solo las compras CR.
- **Entrega desde la ficha:** el modal de la línea de compra en el tablero trae «Programar
  entrega» (abre la compra con el formulario de entrega) y «Certificado de entrega»; la ficha de
  la compra también lo trae. `GET /compras-recordatorios/:id/certificado-entrega` →
  `certificadoEntregaCompraPdf`: el MISMO certificado del servicio (número `CAC-CR-n`), con la
  entrega del mensajero si existe o, si no, lo que declaró la familia / su ficha, y el saldo de la
  compra como «por cobrar en la entrega».

## Burbuja del menú

El número junto a «Ventas posteriores» es **lo que espera una acción del equipo**. Lo calcula `contarPendientes()` en `orbit-backend/src/ventas-posteriores.js` y lo sirve `GET /ventas-posteriores-pendientes` (solo COORDINADOR/ADMIN); `BadgesContext` lo pide cada 60 s. No va en el RPC `orbit_contadores` porque estas tablas están cerradas al navegador.

- Pre-exequiales en `FORMULARIO_COMPLETO`, `PENDIENTE_PAGO`, `PAGO_REPORTADO`, `PAGO_VALIDADO`, `PENDIENTE_CONTRATO` o `CONTRATO_GENERADO`.
- Compras de recordatorios o cédulas (no cerradas) con su compra viva y `valor_pagado < total`.

No cuenta `INTERESADO` ni `FORMULARIO_INICIADO`: son interés, no tarea. Si falla, solo esa burbuja se queda quieta.
## Despliegue (en este orden)

1. Migración 210 por `!` (ver `memory/ops_aplicar_migraciones_vps.md`).
2. Backend: `scp` + `docker compose up -d --build` (trae la dependencia `qrcode`).
   ⚠️ Antes, mirar que no haya memoriales en `GENERANDO`.
3. Línea del cron en `/etc/cron.d/orbit-backend` (está en `orbit-backend/deploy/crontab.txt`).
4. Plantilla: `docker exec -w /app orbit-backend node scripts/crear-plantilla-oferta-posterior.mjs crear`
   y, cuando Meta apruebe, `… estado`.
5. `git push` del frontend.
6. Cargar contenido: fotos de productos, precios de planes, texto e imagen de cada plan.
7. Encender en `/automatizaciones`.

## Pruebas

- `node --test tests/oferta-posterior.test.mjs` — reglas puras (botones, descuentos, estados, QR,
  validación de la solicitud).
- `tests/integracion/oferta-posterior/prueba.mjs` — integración: las migraciones 209 y 210 tal
  cual + el backend REAL sobre un Postgres embebido en memoria (PGlite), con WhatsApp simulado.
  85 comprobaciones: programación, exclusiones, envío, botones, portal, compras, cédula,
  solicitud, «sin pago validado no hay contrato», listas. Cómo correrla, en su cabecera
  (PGlite no es dependencia del proyecto: se instala con `--no-save`).
  ⚠️ `schema.sql` es una copia MÍNIMA de las tablas reales: si una migración posterior las
  cambia, hay que reflejarlo ahí.
- El portal y la pantalla interna se recorrieron además en un navegador real contra ese mismo
  backend local (pedido, solicitud de plan, baja, validar pago, bloqueo del contrato).
- **No probado en navegador**: el modal de Pre-exequiales con la solicitud puesta (exige sesión
  real). Probarlo con la primera solicitud, o con una de prueba, antes de confiar en él.

## Pendiente / decisiones abiertas

- **Política de datos**: la política vigente (v1.1) no nombra entre sus finalidades las
  comunicaciones comerciales propias. Antes de encender conviene que la revise quien lleva el tema
  legal y, si hace falta, agregar la finalidad y subir la versión.
- **Agente de familias**: no se tocó. Si la familia contesta por escrito después de tocar un
  botón, la atiende el agente sin saber de la oferta. Revisar el tono con el primer tráfico real.
- La plantilla será **MARKETING** (más cara y sujeta al tope de marketing por usuario, error 131049).
