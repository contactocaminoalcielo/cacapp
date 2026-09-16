# Fotos e ingreso de técnicos — 8 de septiembre de 2026

## Evidencia y límites

El usuario reportó dos técnicos con problemas de fotos, lentitud e ingreso. Se solicitaron nombres, hora, dispositivo y red; todavía no se han recibido. No se puede atribuir el incidente individual a una causa confirmada sin esos datos o una reproducción en el dispositivo.

A las 14:28 de Bogotá el servidor tenía load average 2,10 / 1,84 / 1,59 y 6.625 MiB disponibles. Docker stats no mostraba saturación sostenida en la muestra. El registro nginx del día hasta esa hora contenía 347 POST correctos de Storage y un POST 544 a las 07:17 desde Chrome/Windows; no corresponde a un técnico identificado. Los 858 GET 401 de Auth provenían de Uptime Kuma consultando /auth/v1/health. Los 73 POST de Auth registrados respondieron 200. Los intentos que se quedan en el teléfono o no llegan al servidor no aparecen allí.

## Defectos corregidos

- Recuperación inicial de sesión y consulta de perfil podían quedar sin respuesta; los errores de perfil se presentaban como usuario sin registro. Ahora hay espera acotada, recuperación visible y protección contra respuestas obsoletas de otra sesión. Las consultas se difieren fuera del callback Auth. Una renovación de token no reconstruye el perfil ya cargado.
- Login mostraba contraseña incorrecta ante cualquier fallo. Ahora distingue credenciales inválidas, demasiados intentos y errores de conexión.
- Las peticiones Supabase Auth/REST tienen abort a 30 segundos; Storage a 55 segundos, antes del timeout existente de 60 segundos de la interfaz. Se conserva la señal del llamador. Las Edge Functions de IA no reciben ese límite. El límite de fetch se aplica hasta recibir cabeceras; las esperas externas de sesión/perfil también se acotan a 35 segundos.
- IndexedDB podía bloquearse al abrir o durante una transacción y retenía conexiones abiertas. Ahora termina el intento local a los cinco segundos, aborta transacciones demoradas y cierra conexiones, incluyendo aperturas tardías. Sigue siendo best-effort; si falla no garantiza copia local, pero permite continuar el envío.
- La preparación de la imagen tiene límites de 15 segundos para el bitmap y 10 para canvas; conserva el original si falla y cierra bitmaps tardíos. No añade decodificación de resolución completa.
- FotoEvidencia marcaba como JPG incluso un PNG/WEBP original devuelto por el fallback. Ahora conserva MIME/extensión cuando envía el original. Impide subidas duplicadas dentro del componente y muestra preparación, conexión, envío, reintentos y guardado.

No se alteraron fórmulas, asignaciones, permisos de Storage ni reglas de recibos. Un timeout de una escritura no demuestra que el servidor no la haya recibido; no se añadieron reintentos generales a operaciones de negocio. La política previa de reintentos de fotos permanece.

## Validación y publicación

- Quince pruebas automatizadas aprobadas, incluyendo abort real de solicitud, señal de cancelación, compresión bloqueada, liberación de bitmap tardío e IndexedDB bloqueado.
- Build de producción aprobado.
- Chromium aislado, sin solicitudes reales externas: error de perfil 503, recuperación con Reintentar, ocho rutas, ingreso con rol técnico, sin errores JS. No es una prueba en los teléfonos afectados ni de una subida real.
- Commit `dea30f1` subido a main. Respaldo previo de index.html, sw.js y manifiesto: `/opt/orbit-releases/red-movil-20260908/respaldo`; los assets anteriores se conservan según el despliegue habitual.

Despliegue automático completado correctamente: https://github.com/contactocaminoalcielo/cacapp/actions/runs/34270181925.

Pendiente: correlacionar los dos casos concretos. Guardar formularios antes de aceptar la actualización. No borrar datos de la PWA mientras haya archivos pendientes: podría eliminar el respaldo local.
