# Automatizaciones — qué manda Orbit solo

Ruta `/automatizaciones` (menú ADMIN; roles COORDINADOR/ADMIN). Un tablero con una tarjeta
por cada flujo que Orbit envía sin que nadie lo toque, y desde el 2026-09-18 la lista
contacto por contacto de cada uno con el acuse real de Meta y el botón de relanzar.

## Los flujos (catálogo `FLUJOS` en `orbit-backend/src/automatizaciones.js`)

| clave | qué manda | tabla que lo registra | interruptor (`config_operativa`) |
|---|---|---|---|
| `imagenes` | 2º y 3er contacto de solicitud de imágenes | `solicitud_imagenes_contactos` (`numero >= 2`) | `SOLICITUDES_IMAGENES.seguimiento_activo` |
| `aviso_vet` | hora del técnico a la clínica aliada | `recogidas.aviso_vet_*` | `AVISO_VET_RECOGIDA.activo` |
| `aviso_cliente` | hora a la familia por wa.me (lo manda una persona) | `recogidas.aviso_cliente_*` | — |
| `plantas` | enlace para elegir planta al cumplirse el compostaje | `planta_elecciones` | `PLANTAS.activo` |
| `mitad_compostaje` | «va con normalidad» + invitación a visitar | `avisos_mitad_compostaje` | `MITAD_COMPOSTAJE.activo` |
| `digitales` | enlaces de las piezas digitales | `digitales_envios` | `DIGITALES.envio_automatico_activo` |
| `grupales` | certificado del proceso grupal | `reportes_grupales_envios` | — |

Agregar un flujo = una fila en `FLUJOS` (conteos) y una en `FUENTES` (lista de contactos).

## Endpoints (`orbit-backend/src/index.js`)

| método y ruta | qué hace |
|---|---|
| `GET /automatizaciones/resumen` | conteos por flujo (hoy / 7 / 30 días / histórico / errores / pendientes), interruptor y plantilla |
| `POST /automatizaciones/:clave/activo` `{activo}` | enciende o apaga (lista blanca `INTERRUPTORES`) |
| `GET /automatizaciones/:clave/envios?estado=&q=&dias=` | lista de contactos con acuse cruzado; `estado` ∈ todos · llego · enviado · sin_acuse · error · pendiente; `dias` 0 = todo |
| `POST /automatizaciones/:clave/envios/:id/relanzar` | vuelve a enviar ese contacto con la función de envío de su flujo |

Todo se cuenta y filtra en SQL: las tablas pasan de mil filas y PostgREST corta en 1000
sin avisar. La lista devuelve máximo 400 filas; los conteos de las pestañas son de toda
la ventana.

## «Le llegó» no es «se envió»

Cada flujo guarda el id del mensaje de Meta (wamid) y `whatsapp_mensajes` recibe los
acuses del webhook (`sent → delivered → read`, o `failed`). El módulo
`automatizaciones-envios.js` cruza ambos: un registro ENVIADO cuyo acuse dice `failed`
se muestra como **No llegó** y se puede relanzar. Si no hay wamid (envío por GHL, registro
manual, wa.me) el acuse queda vacío y se muestra «sin acuse».

## Reglas del relanzamiento

- Reutiliza la función de envío del flujo (`forzarContacto`, `avisarVetRecogida`,
  `enviarAvisoPlanta`, `enviarAvisoMitad`, `enviarAutomatico`, `enviarReporte` con
  `reenvio:true` y motivo fijo). Nunca manda por su cuenta.
- Solo destraba el candado del flujo cuando un fallo lo dejó cerrado: un ENVIANDO
  huérfano de más de una hora pasa a ERROR; un ENVIADO con acuse `failed` pasa a ERROR
  (o suelta la reclama del aviso a la vet).
- **Nunca relanza lo que sí llegó** (`delivered` / `read`): responde 409 «Ya le llegó».
  Para eso cada módulo tiene su reenvío con motivo.
- El botón «Relanzar N» de la pestaña manda de a 20, uno tras otro, y marca en la fila
  el motivo de cada fallo.
- El aviso a la vet respeta su interruptor (apagado → no relanza). Los demás no lo miran.

## Frontend

`src/pages/Automatizaciones.jsx` (tarjetas e interruptores) y
`src/components/automatizaciones/PanelEnvios.jsx` (la lista, se despliega con
«Ver contactos» dentro de la tarjeta).
