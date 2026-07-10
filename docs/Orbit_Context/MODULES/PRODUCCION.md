# Módulo Producción

## Propósito
Controlar los procesos físicos asociados al servicio.

## Procesos
- Cremación.
- Aquamación.
- Compostaje grupal.
- Compostaje individual.
- Cementerio.

## Funciones mínimas
- Registrar ingreso a producción.
- Registrar tipo de proceso.
- Cambiar estado.
- Registrar fechas reales.
- Cargar reporte o evidencia.
- Registrar novedades.
- Finalizar producción.

## Estados sugeridos
- Pendiente.
- En proceso.
- En secado, si aplica.
- Reporte generado.
- Finalizado.
- Novedad.

## Tablero real (`src/pages/Produccion.jsx`, vista "Por servicio")
- Cada tarjeta agrupa los `servicio_recordatorios` del servicio con pills por estado
  (PENDIENTE/EN_PROCESO/LISTO), progreso y botón "Preparar entrega" cuando el servicio está LISTO.
- **Fechas en la tarjeta (2026-07-10)**: chip "Entrega máx {fecha}" desde
  `servicios.fecha_limite_entrega` con semáforo (ámbar ≤2 días, rojo vencida). Esa fecha la
  calcula el trigger `fn_calcular_fecha_entrega` (migración 007) = fecha en que el cliente subió
  imágenes + `planes.dias_entrega_prometidos` días hábiles (default 8) — **no existe hasta que
  hay fotos**. El chip verde de fotos muestra la fecha de `fecha_imagenes_recibidas`.
- **Orden**: tarjetas LISTO siempre de primeras, por `fecha_limite_entrega` ascendente
  (próximas a vencer arriba; sin límite al final del grupo); el resto por recencia.
- `autoCorregirEstados` sincroniza `servicios.estado` con los ítems (excluye ítems
  `recolecta_tecnico` del disparador EN_PRODUCCION para no saltarse el cuarto frío).
