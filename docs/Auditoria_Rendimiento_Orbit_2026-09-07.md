# Auditoría de rendimiento de Orbit

Fecha: 7 de septiembre de 2026. Mediciones de producción aproximadamente entre 15:13 y 15:23, hora de Bogotá. Código local: commit `409a6e5`, con archivos ajenos sin seguimiento preservados.

## Dictamen

**Hay causas verificables en el software que explican una parte importante de la lentitud: consultas de fondo duplicadas, reconstrucción de vistas costosas, descargas masivas para mostrar resúmenes, consultas HTTP que fallan y recargas completas ante cambios pequeños.** Estas cargas se multiplican por usuario y por pestaña.

El servidor comparte la operación, PostgreSQL, Supabase, transcripción de audio y generación de videos. Esto añade competencia por CPU y variabilidad, pero esta revisión **no demuestra que falte capacidad de forma sostenida**. La memoria disponible y el espacio libre no justifican comprar RAM o disco como primera medida.

Recomendación: corregir primero errores y demanda innecesaria, medir durante horario operativo y separar los trabajos multimedia si coinciden con los picos. No recomiendo una reescritura, cambiar de proveedor o comprar una GPU basándose únicamente en lo observado.

## Qué se revisó y qué no se puede certificar

Se inspeccionaron arquitectura y rutas, patrones de acceso de los módulos, contextos globales, acceso a Supabase y API, consultas y migraciones relacionadas, autenticación, procesamiento multimedia, configuración de contenedores y despliegue. Se consultó producción mediante SSH: recursos, estadísticas agregadas de PostgreSQL, índices, planes de lectura, formas de solicitudes fallidas y muestras de logs sin datos de clientes. Se ejecutó el build local completo.

La cobertura funcional por módulo se detalla más abajo. Es una auditoría transversal de rendimiento, **no una certificación de cada flujo de negocio**: no se hicieron escrituras, envíos, cobros, pruebas destructivas ni pruebas de carga en producción. No se midieron sesiones autenticadas en los dispositivos de los usuarios, latencia móvil, LCP/INP ni tiempos p95 de navegación. Los análisis SQL con rol administrador no reproducen exactamente el costo de RLS/PostgREST para cada rol.

No se modificó código funcional ni configuración del servidor. Este documento es el entregable de la revisión.

## Evidencia de producción

| Medición | Resultado | Interpretación correcta |
|---|---:|---|
| CPU asignada | 6 procesadores lógicos | Compartidos por todos los contenedores |
| RAM | 11.956 MiB total; 6.566 MiB disponible | No había presión de memoria en la muestra |
| Disco raíz | 204 GB usados; 185 GB libres; 53 % | No estaba lleno; no mide latencia del disco |
| Carga del sistema | 16,18 / 14,52 / 14,65 | Señal de trabajo en cola; por sí sola no demuestra CPU insuficiente |
| `vmstat`, cinco intervalos de un segundo | CPU ociosa 54–93 %; espera de disco 0–4 %; steal 0 % | No hay evidencia de saturación sostenida en esta muestra corta; hay variabilidad |
| PostgreSQL, tamaño base | 9.056 MB | Volumen moderado; gran parte son adjuntos |
| Servicios desde 09-jun-2026 | 1.173 | El límite de 1.000 filas ya importa |
| Memoria PostgreSQL | `shared_buffers=128 MiB`; `effective_cache_size=128 MiB`; `work_mem=4 MiB` | Configuración conservadora que merece ajuste controlado |
| Conexiones PostgreSQL | máximo 100; muestra con 32 idle y 2 active | No se observó agotamiento global de conexiones |
| Backend | pool máximo 5; sin timeout explícito en su configuración | Riesgo de cola local aunque PostgreSQL tenga conexiones disponibles |
| Salud backend por loopback | HTTP 200 en 34 ms | El backend podía responder una lectura simple; no representa abrir un módulo |
| Bandeja actual, tres lecturas secuenciales | 1.596 / 987 / 498 ms; 400 filas; 336.137 bytes JSON | La consulta acotada sigue siendo costosa y variable; no es un p95 |
| Conteo de alertas, `EXPLAIN ANALYZE` | 231,6 ms; 14.647 accesos a buffers compartidos; 315 resultados contados | Un badge aparentemente pequeño ejecuta bastante trabajo |

Las lecturas de CPU de `docker stats` fueron instantáneas y llegaron a superar un núcleo en PostgreSQL y Studio. No se deben sumar como prueba de consumo sostenido: la muestra posterior de `vmstat` mostró tiempo ocioso considerable.

### Tráfico observado

Últimas 20.000 líneas de acceso, entre **14:13:24 y 15:16:38**: aproximadamente 316 solicitudes/minuto incluyendo tráfico de infraestructura, assets y terceros; no equivale a 316 acciones humanas.

| Ruta o familia | Solicitudes |
|---|---:|
| `servicio_recordatorios` | 2.622 |
| `notificaciones` | 2.578 |
| `/api/whatsapp/conversaciones` y subrutas agrupadas | 2.357 |
| `novedades_servicio` | 2.318 |
| `nps_seguimiento` | 1.670 |
| `v_alertas` | 1.668 |
| `solicitudes_imagenes` | 1.667 |

Estados en esa ventana: 127 respuestas **414**, seis **500**, 139 **400**, 62 **401**, además de respuestas correctas. No todos los 400/401 son defectos de Orbit: también aparece tráfico ajeno o inválido.

En una muestra posterior de 12.000 líneas se aislaron 76 errores 414 de `servicio_recordatorios`, 90 errores 400 de `cuadres_tecnico` y dos errores 500 de `v_alertas`. Las ventanas se solapan y sus conteos **no se suman**.

### Estadísticas históricas SQL

`pg_stat_statements` fue reiniciado el **5-jun-2026**. Estas medias son históricas, no tiempos del último minuto ni percentiles del usuario:

| Familia | Llamadas de la primera muestra | Media histórica |
|---|---:|---:|
| Bandeja antigua sin el límite actual | 110.154 | 1.070,9 ms |
| Otra variante de bandeja, activa durante la revisión | 9.340 | 741,0 ms |
| Consulta de `v_alertas` con corte operativo | 154.813 | 370,4 ms |
| Consulta de `v_kanban` con corte | 16.197 | 227,4 ms |
| RPC de servicios sin cuadrar | 34.338 | 123,2 ms |

Entre las dos muestras, la variante activa de bandeja añadió 81 llamadas y 37.735 ms acumulados: aproximadamente **466 ms por llamada nueva**. La variante antigua permaneció en 110.154 llamadas. Esto respalda que el arreglo reciente ya redujo el trabajo, pero no eliminó su costo.

## Hallazgos y correcciones prioritarias

### 1. WhatsApp genera trabajo repetido desde toda la aplicación — alta prioridad

Evidencia: `src/contexts/ChatWaContext.jsx:15,157,205`, `src/contexts/BadgesContext.jsx:33,40`, `src/pages/Whatsapp.jsx:36,94,156`.

El contexto global consulta cada diez segundos, el badge vuelve a pedir la misma lista cada minuto y la pantalla WhatsApp mantiene su propio sondeo cada diez segundos. La pantalla sí consulta visibilidad; el contexto global conserva vigilancia para las notificaciones. No debe desactivarse sin preservar esa función.

Una pestaña de coordinación fuera de WhatsApp produce nominalmente **7 listas/minuto**; dentro de WhatsApp, **13 listas/minuto**, sin contar el hilo, búsquedas ni el chat flotante. Con el JSON medido son aproximadamente 2,35 o 4,37 MB/minuto de JSON sin comprimir por pestaña. No son bytes medidos en la red: compresión y filtros pueden cambiar esa cifra.

Corregir: una fuente de datos compartida para bandeja y badges; endpoint pequeño de novedades/no leídos; una sola solicitud en vuelo; backoff ante error; renovación incremental por cursor. Coordinar pestañas para no multiplicar la vigilancia. La búsqueda cambia la consulta con cada tecla: agregar debounce y cancelar respuestas obsoletas.

El backend ya contiene el límite de 400 conversaciones/90 días y está desplegado. No presentar ese cambio como pendiente. Aun así, la respuesta actual tardó 498–1.596 ms en tres lecturas internas. El límite se aplica antes del filtrado visual por línea en varios consumidores y `sin_leer_total` se calcula sobre las filas retornadas: separar totales completos de página y paginar por línea para no ocultar conversaciones.

### 2. Kanban produce errores HTTP 414 comprobados — alta prioridad

Evidencia: `src/pages/Kanban.jsx:1279` (`autoCorregirDesdeKanban`). La forma de la consulta fallida coincide: `select=servicio_id,estado`, filtro `servicio_id` con longitud 7.696 y URL total 8.184 caracteres.

Esta función sigue usando una lista grande de identificadores sin dividirla, aunque otra parte de Kanban ya fue optimizada. El error se ignora porque se extrae únicamente `data`; la autocorrección no sucede y las siguientes cargas pueden volver a intentarlo.

Corregir mediante consulta agregada/operación de servidor con parámetros en el cuerpo y validación de permisos. Un parche con lotes puede resolver el 414, pero debe obtener todos los ítems: **una respuesta truncada nunca debe decidir que un servicio está listo**. No limitarse a ampliar el máximo de URL de nginx.

### 3. Finanzas sondea una columna que no existe — alta prioridad funcional

Evidencia: `src/pages/Finanzas.jsx:658–673`. El sondeo cada 12 segundos solicita `entrega_confirmada_monto`. Se verificó `information_schema.columns`: esa columna no existe; las otras siete solicitadas sí.

Esto coincide con el SELECT de los 400 observados para `cuadres_tecnico`. El código ignora el error y no refresca las confirmaciones. Puede sentirse como que el sistema no responde aunque sea una incompatibilidad entre interfaz y esquema.

Corregir el contrato de datos según el campo autoritativo del negocio, revisar migraciones y comprobar el flujo de confirmación. No crear una columna arbitraria solo para silenciar el error. Añadir manejo visible y registro del fallo.

### 4. Los badges reconstruyen vistas operativas complejas — alta prioridad

Evidencia: `src/contexts/BadgesContext.jsx:20–27`; vista real `v_alertas` sobre `v_kanban`. El plan medido incluye joins, agregación de ítems, ordenamientos y llamadas repetidas a `fn_dias_habiles_hasta`.

El servidor registró 1.668 solicitudes a alertas en aproximadamente una hora. El conteo necesita solo un número, pero obtiene ese número a través de una vista diseñada para tarjetas completas.

Corregir: endpoint/RPC específico para contadores; reutilización entre pantalla y menú; cálculo de días hábiles por fecha distinta, con calendario/festivos controlado; invalidación por eventos relevantes y cambio de día en Bogotá. Validar mismos resultados por rol y permisos.

Se probó una lectura simplificada directamente sobre `servicios`: devolvió también 315, redujo accesos a buffers a 5.244, pero tardó **252,3 ms**, frente a 231,6 ms de la primera medición. **No se comprobó mejora de latencia con esa simplificación**; hacen falta optimizar el cálculo y mediciones repetidas. No ofrecer una aceleración ficticia.

### 5. Se descarga demasiado historial para mostrar la pantalla — alta prioridad

Evidencia: `src/pages/Kanban.jsx:1134–1230`, `src/lib/supabase.js:59`, `src/pages/Gestion.jsx:409,539`, `src/pages/Recibos.jsx:212`, `src/pages/Calendario.jsx:35`.

La fecha de corte es fija: 9-jun-2026. Cada semana aumenta el conjunto descargado. Kanban primero lee la vista y luego otras tablas, incluidos ítems utilizados para filtros y badges. Gestión descarga todos los clientes y mascotas; Recibos pagina para traer el conjunto completo. `dbTodo` pagina secuencialmente: evita perder filas, pero no convierte un listado masivo en navegación eficiente.

Corregir: separar operación activa de historial; paginación y búsqueda en servidor; agregados pequeños para tarjetas; cargar detalle al abrirlo; cachear catálogos. No reducir el conjunto a costa de esconder servicios pendientes antiguos. La optimización reciente de Kanban ya redujo peticiones, pero quedan cargas voluminosas y fases encadenadas.

### 6. Tiempo real y sondeos provocan recargas completas — alta prioridad

Evidencia: Dashboard, Kanban, Producción, Cuarto Frío y Tenjo escuchan tablas completas; `src/lib/realtime.js` solo agrupa eventos durante 400 ms. No impide dos cargas en vuelo ni aplica cambios por registro.

En `src/pages/TecnicoApp.jsx:1912`, cada técnico combina sondeo de 30 segundos con eventos de servicios y entregas. Cada evento puede repetir una cadena de consultas de recogidas, neveras, recibos y cuadres. Auth también vuelve a cargar el perfil en eventos de sesión, lo que puede recrear dependencias.

Corregir: invalidación selectiva, unificar solicitudes en vuelo, separar catálogos de datos variables y refrescar los módulos afectados. Mantener avisos y asignaciones entre usuarios. Kanban y Producción además escriben estados desde la carga de pantalla: trasladar esa transición a una operación transaccional para evitar recarga → escritura → nuevo evento → nueva recarga.

### 7. Pool compartido de cinco conexiones y espera durante llamadas IA — prioridad media/alta

Evidencia: `orbit-backend/src/db.js:4`; `orbit-backend/src/grupales-ia.js:40–64` y otros asistentes adquieren una conexión, consultan y la liberan después de esperar a la IA. Algunas operaciones mantienen una conexión para locks de sesión.

Cinco peticiones lentas pueden ocupar el pool del backend aunque PostgreSQL tenga capacidad. No se midió `waitingCount` del proceso vivo, por lo que esto es un riesgo concreto del código, **no agotamiento demostrado durante la muestra**.

Corregir: liberar conexiones antes de esperar servicios externos cuando no hay transacción/lock que lo exija; medir tiempos de adquisición y cola; timeout explícito de adquisición y de consultas; preservar locks y atomicidad. Aumentar el pool solo después de corregir retenciones y comprobar capacidad total. El frontend API tampoco establece cancelación/timeout general. Distinguir error de DB de sesión inválida: `requireAuth` captura ambos como 401.

### 8. Multimedia comparte recursos con el sistema operativo — prioridad media

Whisper usa cuatro hilos de CPU; Remotion renderiza por software con concurrencia dos y vuelve a construir el bundle en cada render (`orbit-backend/memorial/render.mjs:21,53`). Los contenedores inspeccionados no tienen cuotas de CPU/memoria. Compiten con PostgreSQL y los servicios web.

Corregir: construir una vez los assets del renderer, cola con concurrencia controlada, métricas de espera y duración, límites de recursos y worker separado cuando haya correlación entre renders/audios y lentitud. En la primera muestra Whisper estaba casi ocioso: **no atribuirle toda la lentitud actual**. El sondeo de Digitales ya fue reducido a 20 segundos y pestaña visible en el código actual.

### 9. Ajustes de PostgreSQL y almacenamiento de adjuntos — prioridad media

La DB mide 9.056 MB. `whatsapp_media` ocupa 4.171 MB y `whatsapp_import_adjuntos` 4.117 MB: juntos aproximadamente **91,5 %** del tamaño de la base. Se observan operaciones históricas COPY de estas tablas entre las más costosas.

Corregir: evaluar sacar binarios del PostgreSQL a almacenamiento de objetos, conservar metadatos/controles de acceso y política de retención; revisar duplicación de importación sin borrar evidencia necesaria. No implica que deba comprarse más disco hoy.

Probar configuración de memoria bajo presupuesto conjunto con multimedia. `effective_cache_size` es una estimación para el planificador, no RAM reservada; subirlo no es una solución automática. No aumentar `work_mem` globalmente sin considerar multiplicación por consulta y conexiones. Los índices de normalización de teléfonos y de mensajes por línea **ya existen**: no recomendar crearlos otra vez.

### 10. Señales de demoras del sistema, pero evidencia insuficiente para culpar al proveedor

Realtime y Supavisor muestran avisos `long_schedule` de aproximadamente 136–647 ms en muestras recientes. Los textos contienen `timeout`, pero eso **no significa que cada uno sea una conexión fallida**. Hay también un error `ENOIDENTIFIER`, compatible con conexión sin identificador de tenant; falta identificar su emisor.

Los contadores acumulados de reinicio son elevados (9.133 y 12.438), pero `StartedAt` permanece en junio y aparecen saludables. No se demostró un bucle de reinicios actual. Investigar presión de planificación y costo de healthchecks frecuentes antes de cambiar proveedor.

### 11. Descarga inicial y actualizaciones — prioridad media/baja

Build de producción exitoso: 3.030 módulos transformados, compilación Vite 18,72 s. No confundir tiempo de build con tiempo de navegación.

Bundle principal: 402,25 kB / gzip 131,51 kB; Supabase: 197,32 / 50,53 kB; Técnico: 208,76 / 52,08 kB; Kanban: 158,25 / 39,72 kB. Son tamaños por archivo, no presupuestos completos de cada ruta. Ya hay carga diferida por página.

La PWA precachea 150 entradas y 5.391,58 KiB (≈5,27 MiB) sin comprimir, incluyendo módulos diferidos. Esto puede competir con datos en una primera instalación/actualización móvil. Evaluar precache del shell y cache bajo demanda. Confirmar compresión/cache en la ruta pública antes de atribuirle impacto. La animación de salida de página añade 0,2 s antes del montaje siguiente; es secundaria frente a consultas y errores.

El service worker espera aceptación de versión: tener el arreglo publicado no garantiza que todas las pestañas lo ejecuten. Verificar versión de frontend en usuarios afectados. No forzar recarga que pierda formularios.

### 12. Rendimiento e integridad se están mezclando

Dashboard, Kanban, Calendario y ciertos resúmenes financieros consultan sin paginación completa. Hay 1.173 servicios desde el corte y el cliente documenta máximo de 1.000 filas de PostgREST. El subconjunto exacto de cada consulta debe comprobarse, pero el riesgo ya es real: una pantalla rápida con datos incompletos tampoco sirve.

`dbTodo` retorna al alcanzar 50 páginas sin declarar truncamiento; `dbIn` limita identificadores por URL, pero no pagina resultados hijos. Los errores de Supabase no siempre lanzan y varios consumidores solo leen `data`. Además, `src/lib/servicios.js:103` asigna una variable `d` no definida en una rama de recategorizaciones y luego el catch retorna `{}`. Es un defecto estático adicional, no la explicación de lentitud global.

Corregir errores explícitos, paginación y agregados autoritativos. Validar totales, pendientes y estados antes/después de cualquier optimización.

## Cobertura por módulos

Esta matriz resume lectura de patrones y dependencias; donde no hay medición propia no declara que el módulo esté libre de defectos.

| Área | Resultado / foco de validación |
|---|---|
| Login, sesión, shell, menú y chat flotante | Perfil en eventos de sesión; polling global; sincronización entre pestañas |
| Dashboard | Vista completa para KPIs, alertas costosas, actualización por tabla, posible truncamiento |
| Kanban | Carga por fases, ítems masivos, 414 identificado, autocorrección desde lectura |
| Calendario | Lee `v_kanban` desde corte fijo; filtrar rango visible en servidor |
| Gestión: clientes, mascotas, aliados, personal, planes, historial | Descarga total de catálogos grandes; historial ya dispone de paginación; evitar contar/exportar todo repetidamente |
| Finanzas y cuadres | 400 identificado; enriquecimiento secuencial por lotes; resúmenes sin paginar; historial ya paginado |
| Recibos y PDF | Carga de todos los servicios; PDF diferido; medir creación/exportación en dispositivo |
| Técnico, mensajero y entregas | Poll + realtime; múltiples fases; badges de comprobantes/cuadres; validar móvil real |
| Producción | Join amplio, recarga global y escrituras automáticas al cargar; revisión de todos los ítems obligatoria |
| Cuarto frío, Tenjo y lotes grupales | Recargas por cambios de tablas, joins operativos, catálogos; asistentes usan pool compartido |
| Seguimiento de imágenes, fotos y portales | Revisar tamaño/compresión y cargas por detalle; existe compresión preventiva para Android |
| Registro, solicitudes públicas y portal aliado | Carga de catálogos y consultas dependientes; escritura de servicio requiere pruebas transaccionales aparte |
| Presequiales y ofertas | Listados con relaciones y operaciones por mascota; no aparecen como principal familia de costo medida |
| Inventario | API propia; comparte autenticación/pool; medir listado y movimientos con carga representativa |
| NPS y certificados | Joins/listados; contador NPS global se repite; certificados con filtros IN a revisar por volumen |
| WhatsApp, campañas y plantillas | Duplicación de sondeos, búsqueda, hilo repetido; campañas con intervalos propios; límites por línea |
| Agentes IA, configuración y costos IA | Dependencia de proveedor/colas; no mezclar tiempo de IA con tiempo de lectura operativa |
| Digitales, memoriales y voz | Contención potencial CPU, reconstrucción de bundle, lectura de estados; sondeo reciente ya mejorado |
| Infraestructura y despliegue | Configuración DB, precache, healthchecks, versiones abiertas y ausencia de presupuestos de rendimiento |

## Qué cambiar y qué comprar

| Decisión | Recomendación |
|---|---|
| Más RAM | No justificada por esta muestra; primero usar y presupuestar la disponible |
| Más disco | No urgente por capacidad; revisar crecimiento y duplicación de adjuntos |
| Redis | No necesario como primer arreglo; compartir solicitudes y resúmenes reduce carga sin otra plataforma |
| GPU | No justificada para acelerar toda la aplicación; evaluar solo si el volumen de transcripción/render y un benchmark lo ameritan |
| Segundo servidor | Opción razonable para workers multimedia si se confirma competencia con operación; dimensionar con cola y duración reales |
| CPU dedicada o plan superior | Evaluar si después de corregir demanda hay saturación sostenida y p95 malo en horario pico |
| Cambiar Contabo/Supabase/React | No hay evidencia suficiente para justificar migración o reescritura ahora |

No se cotizaron planes ni se conoce el costo contractual actual. La compra debe compararse con pruebas de carga representativas en staging y demanda máxima; dar un SKU o prometer una reducción porcentual ahora sería especulativo.

## Plan de ejecución propuesto

1. **Primera entrega: errores comprobados.** Corregir el 414 de autocorrección y el SELECT incompatible de Finanzas; registrar errores y ausencia de resultados. Verificar estados/totales y versiones de usuarios. Aceptación: cero 414 en ese flujo y cero 400 por columna inexistente.
2. **Segunda entrega: tráfico redundante.** Unificar bandeja/badges, endpoint resumido, una solicitud en vuelo y búsqueda con debounce; contadores de alertas especializados. Aceptación: una sola vigilancia por sesión coordinada, menores bytes/consultas y mismos avisos/no leídos por línea.
3. **Tercera entrega: carga por demanda.** Paginación real y agregados para Kanban/Gestión/Recibos/Finanzas; mover las transiciones automáticas a servidor. Aceptación: no perder servicios >1.000, no omitir ítems y reducir solicitudes antes de primer contenido útil.
4. **Cuarta entrega: backend e infraestructura.** Liberación temprana del pool, límites, métricas y experimentos de memoria/worker multimedia. Aceptación: cola del pool acotada y sin deterioro operativo durante un render/transcripción.

Cada entrega debe ir por separado y tener reversa. Las optimizaciones no deben alterar tarifas, saldos, comisiones, fechas prometidas, permisos ni decisiones de estado.

Medir durante varios días representativos: p50/p95 por ruta, solicitudes y bytes por navegación, usuarios/pestañas concurrentes, tiempo de SQL y pool, CPU/IO/steal, cola multimedia, errores y versión del frontend. Un objetivo inicial a validar con el negocio puede ser contenido operativo útil <2 s en p95 y lecturas interactivas <500 ms en p95, excluyendo generación de IA/video; **son objetivos propuestos, no resultados alcanzados**.

## Límites de las comprobaciones de red

Las pruebas HTTPS desde el propio VPS no dieron una medición pública válida: dos intentos devolvieron error HTTP alrededor de 31–32 s y el intento directo por loopback no validó la cadena TLS local. Esto puede depender de proxy/ruta y certificados de origen. No se usó para afirmar que el sitio tarde 30 segundos, que el certificado público esté mal o que DNS/CDN sea la causa. Hace falta medir la ruta pública desde los dispositivos afectados.

## Referencias técnicas

- [PostgreSQL: interpretación de pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html): tiempos y llamadas acumulados; no confundir medias con percentiles de experiencia.
- [node-postgres: API del pool](https://node-postgres.com/apis/pool): liberación de clientes, cola y timeout de adquisición.
- [Supabase: diagnóstico de rendimiento](https://supabase.com/docs/guides/database/debugging-performance): planes y costo de políticas/permisos.
- [Supabase: índices](https://supabase.com/docs/guides/database/postgres/indexes): confirmar uso con planes antes de añadir índices.

Los hallazgos sobre Orbit se basan en el repositorio y las mediciones descritas, no en esas recomendaciones generales.
