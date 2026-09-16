# Correcciones de rendimiento — 7 de septiembre de 2026

## Cambios

- **Contadores:** una RPC de lectura sustituye cuatro peticiones. Calcula los días hábiles una vez por fecha distinta, usando la misma función de Bogotá/festivos. Conserva RLS y excluye acceso anónimo.
- **Kanban:** resumen de ítems agrupado por servicio; conserva los estados y tipos usados por filtros, adicionales y autocorrección. Se elimina la segunda consulta que generaba URLs >8 KB. Los lotes de compatibilidad se paginan y limitan concurrencia. La autocorrección no actúa con datos truncados y no sobrescribe servicios que ya avanzaron fuera de sus estados permitidos.
- **WhatsApp:** proveedor, pantalla sin búsqueda y badge comparten la bandeja. Continúan los avisos de fondo y la separación por línea. Búsqueda con debounce y descarte de respuestas obsoletas.
- **Finanzas:** el sondeo deja de solicitar la columna inexistente `entrega_confirmada_monto`; conserva los campos reales de confirmación y no modifica importes.
- **Recargas:** Kanban, Dashboard, Producción, Cuarto Frío, Tenjo y la carga principal del técnico serializan solicitudes. Si llega un cambio durante la lectura, hacen una vuelta adicional sin superponer consultas.
- **Paginación:** Kanban, Dashboard y Calendario incluyen resultados posteriores a la fila 1.000 con orden estable. El helper general informa el límite de páginas en vez de retornar un conjunto incompleto.
- **Backend IA:** los asistentes de reportes grupales y cuadres liberan la conexión antes de esperar al modelo. La espera de adquisición del pool queda acotada a diez segundos; no se limita la duración de las transacciones existentes.
- **Recategorizaciones:** se corrige la referencia a una variable inexistente que ocultaba las etiquetas.

## Verificación

1. Diez pruebas automatizadas: paginación >1.000, rechazo de truncamiento, estados pendientes fuera de primera página, exclusiones de autocorrección, concurrencia, recuperación de red y liberación del pool ante éxito/error.
2. Navegador Chromium aislado con todas las solicitudes externas simuladas: ocho rutas sin errores de JavaScript; un sondeo de bandeja durante el intervalo de once segundos; búsqueda `v → ve → vet` agrupada en `vet`.
3. Comparación SQL en la base real dentro de una transacción revertida: contadores iguales a las consultas antiguas y cero diferencias de tipos/estados/servicios en el resumen, tanto con rol administrador como `authenticated`. Sin permiso de ejecución para `anon`.
4. Build de producción con la misma URL y clave pública anon del frontend existente. Las pruebas de navegador se repitieron sobre ese build.

La medición de prueba de **todos los contadores** fue 20,9 ms y 1.471 accesos a buffers; la lectura anterior de **solo el contador de alertas** había sido 231,6 ms y 14.647 accesos. Son mediciones individuales, no un p95 ni una promesa de acelerar toda la aplicación diez veces.

## Publicación y reversa

Código y pruebas versionados en el commit `49e2bc7`. Los informes de infraestructura y el script de despliegue puntual se conservan localmente.

Publicación confirmada: frontend, backend y migración 144 aplicados. El backend respondió HTTP 200 en `/health`; el frontend servido por el origen coincidió con el archivo publicado. El pool activo confirmó el timeout de adquisición de 10.000 ms. La verificación SQL posterior midió todos los contadores en 41,3 ms y el resumen devolvió 1.174 servicios.

El despliegue automático del mismo commit terminó correctamente: [GitHub Actions 34162531730](https://github.com/contactocaminoalcielo/cacapp/actions/runs/34162531730). Respaldo de la publicación manual: `/opt/orbit-releases/rendimiento-20260907-1615/respaldo`.

El script de despliegue compara los hashes del backend anterior, respalda archivos e imagen, comprueba que no existan renders/publicaciones/campañas ni actividad reciente de llamadas, y verifica `/health` antes de publicar el frontend. Mantiene los chunks de versiones previas y cambia el índice de forma atómica. Ante fallo restaura código e imagen anteriores. La migración 144 es aditiva y compatible con la versión previa.

El frontend tiene compatibilidad con una base donde aún no está la migración: solo usa la lectura anterior si la función está ausente, sin esconder errores de permisos ni timeouts.

Las pestañas que ya estaban abiertas siguen con su versión hasta aceptar la actualización. No forzar la recarga mientras se llena un formulario.

## Alcance pendiente de medición

No se cambiaron fórmulas de dinero, tarifas, comisiones, festivos, permisos ni transporte de mensajes. No se realizó una reescritura del sistema, migración de adjuntos ni separación física de multimedia. Tampoco se ajustó memoria de PostgreSQL sin un presupuesto de carga medido.

Falta observar el p95 y CPU en horario pico con las pestañas actualizadas. Las pruebas no certifican todos los procesos de negocio ni las redes/dispositivos de cada usuario. El espacio libre en disco no mide trabajo de CPU: son recursos distintos.

## Repetir las pruebas

```powershell
node --experimental-vm-modules --test --test-isolation=none tests/rendimiento.test.mjs tests/pool-ia.test.mjs
# Primero generar dist con configuración válida (real o simulada):
node tests/navegacion-rendimiento.mjs
```

El verificador SQL está en `scripts/verificar-lecturas-operativas.sql`. Debe ejecutarse en una transacción consistente junto con la migración para comparar el mismo estado de datos.
