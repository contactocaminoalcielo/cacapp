# Módulo Cuarto Frío

## Propósito
Controlar el estado y ocupación del cuarto frío (refrigeración) entre la recolección de la mascota y su ingreso a producción.

## Posición en el flujo
`EN_RECOGIDA → **EN_CUARTO_FRIO** → EN_PROCESO`

## Funciones implementadas (`CuartoFrio.jsx`)
- Ver mascotas actualmente en cuarto frío con servicio, plan, técnico y fecha de ingreso.
- Asignar nevera a cada mascota.
- Registrar fecha/hora de ingreso y salida.
- Reportar estado diario de cada nevera (N1–N6 siempre visibles).
- Checklist diario: ozonizadores, olores, observaciones generales.
- Estado de funcionamiento + capacidad por nevera.
- Badge de alerta en TecnicoApp cuando no hay reporte del día.

## Acceso por rol
- **ADMIN**: CRUD completo.
- **COORDINADOR**: CRUD completo.
- **TÉCNICO/OPERARIO**: Solo puede ver estado de neveras y cargar reporte diario (desde TecnicoApp, tab "C. Frío").

## Entidades involucradas
- `cuarto_frio` — registros de estancia por servicio.
- `neveras` — capacidad en `capacidad_kg` (NO `capacidad`). Sort numérico con `numeric:true`.

## Nota de JOIN
No hacer JOIN directo `servicios → cuarto_frio`. Usar dos queries separadas y mergear client-side.

## Riesgos
- Si no se registra la salida del cuarto frío, el servicio queda en estado `EN_CUARTO_FRIO` indefinidamente.
- El reporte diario de neveras es crítico para control sanitario; debe recordarse si no se carga en el día.
