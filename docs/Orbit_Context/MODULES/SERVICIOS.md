# Módulo Servicios

## Propósito
Controlar el ciclo de vida completo de cada servicio funerario desde la solicitud hasta el cierre.

## Funciones mínimas
- Crear servicio (desde Registro.jsx o conversión de solicitud en Kanban).
- Asociar mascota (que lleva al cliente por FK).
- Seleccionar plan y calcular precio por especie + peso.
- Registrar canal de entrada, tipo de acompañamiento.
- Asociar aliado/veterinaria si aplica.
- Asignar técnico de recogida.
- Cambiar estados con trazabilidad.
- Ver historial completo por servicio.

## Estados reales en DB (SCREAMING_SNAKE_CASE)

```
INGRESADO
  └─ EN_RECOGIDA
       └─ EN_CUARTO_FRIO
            └─ EN_PROCESO
                 └─ EN_PRODUCCION
                      └─ LISTO
                           └─ EN_ENTREGA
                                └─ ENTREGADO
CANCELADO (desde cualquier estado)
```

| Estado | Significado operativo |
|--------|-----------------------|
| `INGRESADO` | Servicio creado, técnico asignado o pendiente |
| `EN_RECOGIDA` | Técnico en ruta hacia el cliente |
| `EN_CUARTO_FRIO` | Mascota recogida, en cuarto frío esperando proceso |
| `EN_PROCESO` | Ingresada a producción física |
| `EN_PRODUCCION` | Recordatorios/diseños en proceso |
| `LISTO` | Todo listo, pendiente de programar entrega |
| `EN_ENTREGA` | Técnico o mensajero en ruta de entrega |
| `ENTREGADO` | Entrega confirmada con evidencia |
| `CANCELADO` | Servicio cancelado (con motivo) |

## Campos de estado complementarios

- `estado_pago`: `PENDIENTE | PARCIAL | COMPLETO`
- `canal_entrada`: `DIRECTO | ALIADO | REFERIDO | REDES_SOCIALES | GOOGLE | CLIENTE_ANTIGUO`
- `tipo_acompanamiento`: `PRESENCIAL | VIDEOLLAMADA | EVIDENCIA`

## Flujo de creación (Registro.jsx)
1. Paso 1: Datos del propietario (buscar o crear cliente).
2. Paso 2: Datos de la mascota (buscar o crear).
3. Paso 3: Selección de plan + cálculo precio por especie/peso + adicionales + recargos.
4. Paso 4: Datos de recogida (dirección, técnico, fecha/hora, acompañamiento, pago).
5. Resumen y confirmación → INSERT en `servicios` + `recogidas`.

## Flujo alternativo: Solicitud web
- Cliente completa formulario público `/solicitud` → INSERT en `solicitudes_servicio`.
- Coordinador o Admin convierte desde columna "Solicitudes" en Kanban → crea cliente + mascota + servicio + recogida → marca solicitud como `CONVERTIDO`.

## Planes presequiales
Filtrar con `.not('codigo', 'in', '(BRONCE,PLATA,ORO_EXCLUSIVO,DIAMANTE,VITALICIO)')` en Registro para no mostrarlos como planes de servicio normal.

## Riesgos
- Cambios de estado sin auditoría generan pérdida de control operativo.
- El campo `responsable_id` en servicios y `tecnico_id` en recogidas pueden diferir — ambos deben mantenerse sincronizados.
