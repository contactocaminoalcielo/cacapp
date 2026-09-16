# Segunda revisión de rendimiento — 8 de septiembre de 2026

## Resultado

Se midió producción entre aproximadamente 12:42 y 12:56 de Bogotá. Se aplicaron dos índices concurrentes de WhatsApp y una optimización equivalente del cálculo de días hábiles. No se reiniciaron servicios ni se modificaron mensajes, importes, estados o permisos.

## Mediciones

- CPU inicial: 89–96 % ociosa en cinco intervalos de dos segundos; memoria disponible 6.510 MiB. Load average inicial 2,16 / 1,66 / 1,54, con seis CPU lógicas. No demuestra saturación sostenida ni representa el horario pico completo.
- Ventana SQL de 136,3 segundos, usando diferencias por **userid, dbid, toplevel y queryid**, sin reiniciar estadísticas: bandeja WhatsApp 47 llamadas, media 127,8 ms; conteo antiguo de alertas ocho llamadas, media 619,3 ms; nuevos contadores 19 llamadas, media 29,4 ms; notificaciones 50 llamadas, media 29,2 ms. Realtime acumuló 6.381 ms en 252 llamadas; estos tiempos SQL no son porcentajes de CPU y no deben sumarse como tales.
- La presencia de consultas antiguas de badges es compatible con pestañas sin actualizar; no se identificó qué usuario o versión las originó.
- Bandeja de 400 conversaciones: antes de los índices 114,368 / 137,191 / 106,486 ms; después 113,852 / 61,739 / 94,974 ms. El plan confirmó el uso de ambos índices nuevos. No es un p95 ni una prueba de carga.
- Conteo de alertas sobre la misma instantánea: 293,074 ms antes y 87,529 ms después del cambio de días hábiles, sin diferencias de datos. Comprobación posterior al COMMIT: 101,533 ms, 3.748 accesos a buffers, frente a 14.831 en la muestra previa.
- Todos los contadores después del COMMIT: 13,309 ms, 1.007 accesos a buffers. Son muestras puntuales.

## Cambios publicados

Código y verificador subidos a main en el commit `1ae2b90`. El commit omite CI porque estos cambios SQL ya se aplicaron y comprobaron directamente; no requieren desplegar de nuevo frontend ni reiniciar Edge Functions.

1. Migración 145: índice `(phone_number_id, contacto, ocurrido_en DESC, id DESC)` para recuperar el último mensaje sin ordenamiento adicional; índice parcial `(phone_number_id, contacto, ocurrido_en) WHERE direccion='IN'` para los no leídos. Ambos válidos y listos; tamaños aproximados 7.632 y 3.088 KiB. Se conservan los índices anteriores.
2. Migración 146: el cálculo de días hábiles expresa la exclusión de festivos dentro de una sola consulta, evitando invocar una función con subconsulta por cada día. Mantiene la regla actual de `fn_es_dia_habil`, zona Bogotá, signo, NULL y exclusión del extremo inicial. `CREATE OR REPLACE` conserva propietario y permisos; sigue SECURITY INVOKER.

## Verificación de integridad

- Ensayo completo en transacción revertida antes de publicar.
- Publicación en REPEATABLE READ, con comparación de todas las columnas y multiplicidades de v_alertas (871 filas) y v_kanban (1.180 filas) antes/después: cero diferencias. Un fallo habría abortado el COMMIT.
- Verificador de días: 801 fechas alrededor de hoy, fechas reales de entrega/código enviado, festivos y días adyacentes, febrero bisiesto de 2024 y 2028, NULL. Comparación con `fn_es_dia_habil`, tanto como administrador como rol authenticated.
- Verificador anterior de contadores e ítems de Kanban: equivalencia y permisos aprobados con ambos roles.
- Cambios solo SQL: no requieren recompilar frontend ni modificar transporte de WhatsApp.

## Reversa y mantenimiento

Respaldo de la función previa: `/opt/orbit-releases/rendimiento-20260908-sql/revertir-dias-habiles.sql`. Restaurarla con psql y ON_ERROR_STOP si se identifica una regresión. Los índices nuevos pueden retirarse con DROP INDEX CONCURRENTLY sobre sus nombres exactos, fuera de transacción, sin borrar datos.

La migración 145 debe ejecutarse con autocommit. Después de una interrupción, comprobar indisvalid/indisready: IF NOT EXISTS no repara un índice inválido. Si cambia la regla autoritativa de fn_es_dia_habil, actualizar también fn_dias_habiles_hasta y ejecutar scripts/verificar-dias-habiles.sql.

## Qué sigue pendiente

No se ha medido un p95 de navegación ni un pico completo con todas las personas trabajando. No se puede atribuir la diferencia de carga respecto a ayer exclusivamente a estos cambios: cambian horario y demanda. No se justificó comprar hardware, cambiar memoria global de PostgreSQL, trasladar multimedia ni rediseñar listados en esta muestra. El siguiente diagnóstico debe concentrarse en la pantalla concreta que siga lenta y correlacionar sus tiempos con CPU por proceso durante el incidente.
