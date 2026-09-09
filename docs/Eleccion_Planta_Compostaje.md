# Elección de planta al cumplirse el compostaje

Cuando una mascota termina su proceso en el cubículo, se le avisa a la familia por
WhatsApp y se le manda un enlace para que elija la especie de planta y, si quiere,
compre extras. Migración **149**.

## Cuándo se dispara

`lotes_tenjo_items.fecha_compostaje_inicio` (el día que la mascota **entró al
cubículo**) **+ `meses_compostaje`** — los 2, 2.5 o 3 meses que fijó el operario
para ese cubículo. Es la misma regla que ya usa la pestaña Control para decir
"compostaje listo" (`calcularListoProceso` en `src/lib/tenjo.js`), así que la
fecha que ve el operario y la que dispara el aviso son la misma.

Con 2 meses fijos para todos, a los de 2.5 y 3 se les avisaría antes de tiempo.

Postgres y el JS coinciden en el medio mes: `2.5 * INTERVAL '1 month'` sobre el
15-jul da 30-sep, igual que `sumarMeses` (2 meses + 15 días). Verificado en prod.

## Las tres tablas

| Tabla | Qué guarda |
|---|---|
| `plantas` | Catálogo. `elegible` = aparece entre las opciones a escoger; `adicional` = se vende con su precio. Una misma planta puede ser las dos cosas. |
| `planta_elecciones` | Una fila por servicio: el aviso, su envío y lo que respondió la familia. `UNIQUE(servicio_id)` es el candado anti-duplicado del job. |
| `planta_adicionales` | Lo que compró. `UNIQUE(eleccion_id, planta_id)` es el candado anti doble cobro. |

**La especie es catálogo, no código.** Hoy son Helecho y Pescadito; cuando cambien,
se editan en Configuración → Plantas y el portal cambia solo.

## El precio nunca viene del navegador

Regla heredada de Ofertas (migración 078). El portal manda
`{planta_id, adicionales:[{planta_id, cantidad}]}`; el monto sale de `plantas`
dentro de la misma transacción que suma al servicio, en `guardarEleccionPlanta`.

Al cobrar un extra se hace exactamente lo que hace Ofertas:

- `valor_total` += el extra.
- `valor_adicionales` solo si **no es NULL** (NULL = ese servicio no lleva desglose;
  ponerle el monto suelto mentiría sobre los adicionales previos).
- **`estado_pago` se recalcula siempre.** Un servicio COMPLETO al que se le suma un
  extra baja a PARCIAL; si no, el saldo desaparece de la cartera de Finanzas.
- Novedad en la ficha (con `valor_antes`/`valor_despues` para la traza) y alerta
  operativa para que el cobro no se olvide en la entrega.

## El aviso

Sale por la línea de familias (Valeria, +57 315 989 1247) con una plantilla
aprobada en Meta, dos variables: `{{1}}` nombre de la mascota, `{{2}}` enlace.

**Sin plantilla sembrada el job NO envía**: deja los avisos en `PENDIENTE`, lo
registra en el log y avisa a coordinación una sola vez (cuando aparecen casos
nuevos, no todos los días). Nunca marca ENVIADO algo que no salió.

Se siembra en Configuración → Plantas escribiendo el nombre exacto de la
plantilla; eso escribe `config_operativa` (`modulo='PLANTAS'`, `clave='plantilla'`).

## El enlace

`https://orbit.orbitacac.com/#/planta/CODIGO`, y el CÓDIGO es el **mismo
`servicios.codigo_fotos`** del portal de fotos: el cliente ya lo tiene y no hay
que inventarle otro secreto. Si el servicio nunca pasó por el portal de fotos, el
job lo genera con `fn_gen_codigo_fotos()`.

El enlace vive `dias_ventana_portal` días (120 por defecto) desde el envío.

## Qué se puede cambiar y qué no

- **La especie se elige una sola vez.** Cambiarla después de que la planta ya se
  preparó sería una promesa que la planta no puede cumplir; si la familia se
  equivocó, que nos escriba. El portal se lo dice con esas palabras.
- **Los extras sí se pueden seguir agregando** mientras el enlace viva. Cada
  compra nueva genera su propia alerta (la clave de dedupe lleva las plantas
  compradas), o el dinero nuevo pasaría desapercibido bajo la alerta ya abierta.

## Piezas

| Archivo | Qué hace |
|---|---|
| `migrations/149_plantas_eleccion_cliente.sql` | Tablas, vista `v_plantas_pendientes`, RLS, GRANTs a `orbit_backend`, semilla y config |
| `orbit-backend/src/plantas.js` | Portal (GET/POST), envío del aviso, reglas de cobro |
| `orbit-backend/src/jobs/plantas.js` | Job diario: prepara los cumplidos y manda la plantilla |
| `orbit-backend/deploy/crontab.txt` | `07:15` — `/jobs/eleccion-planta` |
| `src/pages/PlantaCliente.jsx` | Portal público `/#/planta/CODIGO` |
| `src/lib/plantas.js` | Cliente del portal + CRUD del catálogo |
| `src/components/configuracion/TabPlantas.jsx` | Configuración → Plantas: catálogo, aviso y tablero |
| `src/components/servicio/FichaServicio.jsx` | Sección "Planta del compostaje" en la tarjeta |

## Despliegue — HECHO el 2026-09-09

1. **Migración 149 aplicada** en prod por SSH→psql. Antes se ensayó sobre una copia
   sin `BEGIN;`/`COMMIT;` (el archivo trae los suyos y anularían el ROLLBACK) y se
   verificó **después** del rollback que no había quedado nada.
2. **Backend** por `scp` + `docker compose up -d --build`. Verificado el código vivo
   en `/app/src/` y `/portal/planta/:codigo` respondiendo.
3. **Frontend** por `git push` → Actions. Verificado contra el `sw.js` publicado.
4. **Cron** instalado en `/etc/cron.d/orbit-backend` (`15 7 * * *`, hora Bogotá), con
   respaldo del archivo anterior en `/root/`. Probado con `?dry=1`.
5. **Plantilla `eleccion_planta_cliente`** creada en la WABA de familias
   (`1048633974692786`), id `2640610176457260`, categoría UTILITY (Meta **no** la
   reclasificó) y **APROBADA** el mismo 9-sep. Su nombre está sembrado en
   `config_operativa`, así que el envío automático queda armado.

### Prueba end-to-end en producción (y limpieza)

Con una fila temporal sobre un servicio real (JOSHUA, cubículo ROJO-M-01) se
comprobó el camino completo, incluido el del dinero:

| Comprobación | Resultado |
|---|---|
| El portal abre y muestra mascota, cubículo y las dos opciones | ✅ |
| Elegir Helecho + 2 extras de $40.000 | ✅ `valor_total` 471.750 → 551.750 |
| `valor_adicionales` | 0 → 80.000 |
| **`estado_pago` COMPLETO → PARCIAL** (si no, el saldo desaparece de la cartera) | ✅ |
| Novedad con `valor_antes`/`valor_despues` y motivo ADICIONAL | ✅ |
| Alerta operativa `PLANTA_ELEGIDA` en ALTA | ✅ |
| Reenviar el mismo formulario **no** vuelve a cobrar | ✅ total intacto |
| Reenviar con otra especie **no** cambia la elegida | ✅ sigue Helecho |

Todo se revirtió después: servicio restaurado a 471.750 / COMPLETO, y sin
elecciones, extras, novedades ni alertas de prueba.

## Auditoría del 2026-09-09 — lo que se corrigió

Revisando lo construido, en el código y **abriendo el portal en producción**:

| Hallazgo | Por qué importaba |
|---|---|
| `fecha_cumplida` llegaba como `Date` de JS y no como texto | `String(fecha)+'T12:00:00'` daba fecha inválida ⇒ NaN ⇒ **la ventana del enlace no se cerraba nunca**, sin un solo error |
| Botones de cantidad de 32 px | Por debajo del mínimo táctil de 44 px |
| El tope de extras se aplicaba ANTES de descartar los ya comprados | Quien ya compró los primeros se quedaba sin ver los siguientes |
| El job podía escribirle a un servicio ya `ENTREGADO` | Pedirle elegir la planta a quien ya la recibió |
| Planta marcada solo como "opción" con precio | Nunca se cobraba, en silencio. Ahora el catálogo lo rechaza al guardar |
| El enlace vencido a mitad del formulario | Dejaba al cliente reintentando contra una puerta cerrada |
| **Helecho y pescadito se veían casi iguales** | Solo se vio ABRIENDO la pantalla: separarlos es lo único que la familia debe poder hacer |
| **"Hay una versión nueva de Orbit"** dentro del portal | Colgaba de la raíz de `App`, así que salía también en el portal de fotos y en el de aliados **desde siempre** |
| Nombres en MAYÚSCULAS (`JOSHUA`, `ANDRES`) | Se lee como un grito en una pantalla de despedida |

## El diseño del portal

No se parece al resto de Orbit a propósito: papel cálido en vez del azul de la
marca, Playfair itálica para los titulares (ya venía cargada en `index.html`, no
pide una fuente más) y verde de invernadero.

**No usa iconos de librería.** Cada especie tiene su ilustración dibujada en SVG
—la pluma del helecho, el zigzag escalonado del pescadito, la matera de barro—
generada por el nombre del catálogo, con una rama genérica de respaldo. Un ícono
repetido en las dos tarjetas volvía intercambiable justo lo que hay que decidir.

Contrastes medidos sobre el papel: tinta 13:1, texto apagado 5.4:1, verde hondo
7.7:1, botón 6.3:1 con blanco. El estado elegido no depende solo del color (dice
"Elegida"), los controles miden 44 px, el foco de teclado va por `outline` —el
anillo de Tailwind se pinta con box-shadow y aquí lo usan las sombras— y se
respeta `prefers-reduced-motion`.

## Estado al 2026-09-09

- **En producción, encendido y con la plantilla APROBADA por Meta.** El envío
  automático queda armado: el 15-sep saldrán los primeros avisos solos.
- 65 mascotas en cubículo, **ninguna cumplida todavía**. Las cinco primeras
  (LUNA, WILLY, MAILO, OSIRIS, JOSHUA) cumplen el **15-sep-2026**, todas con
  WhatsApp válido. No hay backlog que pueda dispararse de golpe.
- Falta subir las fotos de Helecho y Pescadito (`imagen_url`): sin ellas el portal
  muestra un ícono en su lugar, que funciona pero luce pobre.
