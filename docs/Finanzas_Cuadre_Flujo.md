# Finanzas · Cuadre con técnicos — Flujo del proceso

> Referencia del módulo **Finanzas › Cuadre** (`src/pages/Finanzas.jsx`).
> Última actualización: 2026-07-06.

El cuadre sirve para **quedar a saldo con el técnico**: cuánto efectivo recogió,
cuánto se le reconoce (transporte, recargos, pagos) y cuánto entrega a gerencia.
Un pago pendiente del cliente **no bloquea** el cierre.

---

## 1. Diagrama de flujo

```mermaid
flowchart TD
    A([Generar cuadre: técnico + rango de fechas]) --> B[Armar filas del cuadre]
    B --> B1[Recibos del técnico]
    B --> B2[Servicios SIN recibo<br/>recogió pero no cobró]
    B --> B3[Cancelados]

    B1 --> C{Tipo de fila}
    B2 --> C
    B3 --> C

    C -->|Cancelado| D1[Reconoce pago por cancelado<br/>sin banda de diferencia]
    C -->|Facturación mensual| D2[Sugerido: PENDIENTE GESTIONAR<br/>x cobrar al aliado]
    C -->|Normal / Sin recibo| E[Calcular diferencia<br/>banda neto..bruto]

    E --> F{¿Cuánto recogió?}
    F -->|Dentro de banda o de más| G1[Sugerido: VERIFICADO OK]
    F -->|Menos que el neto = falta| G2[Sugerido: PENDIENTE GESTIONAR]

    D1 --> H[Coordinador confirma estado]
    D2 --> H
    G1 --> H
    G2 --> H

    H --> I{Estado final}
    I -->|VERIFICADO OK| J[Saldado · cuenta en Finanzas]
    I -->|PENDIENTE GESTIONAR| K[Va a Conciliaciones]
    D2 -.fact. mensual.-> K
    B2 -.sin recibo.-> K

    K --> K1[Definir vía: Llamar a cobrar / Fact. mensual]
    K1 --> K2[Marcar resuelta cuando se cobre<br/>funciona aun con cuadre cerrado]

    J --> L([Cerrar cuadre])
    K --> L

    L --> M{¿Falta comprobante digital<br/>O el técnico debe efectivo?}
    M -->|Sí| N[AVISO: 'Cerrar de todas formas'<br/>no bloquea]
    M -->|No| O[Confirmaciones normales]
    N --> P
    O --> P[Cuadre CERRADO congelado]
    P --> Q[Dinero a entregar =<br/>efectivo − reconocido − ajuste]
    Q --> R([Técnico entrega el efectivo<br/>→ 'Confirmar dinero recibido'])
    R --> S[Registro: quién recibió,<br/>cuándo, monto, notas]
```

### Versión ASCII

```
GENERAR CUADRE (técnico + rango)
        │
        ▼
 Armar filas ──► Recibos │ Sin recibo │ Cancelados
        │
        ▼
 ┌─────────────── ¿TIPO DE FILA? ───────────────┐
 │                      │                        │
 Cancelado         Fact. mensual          Normal / Sin recibo
 │                      │                        │
 reconoce pago     PENDIENTE           calcular DIFERENCIA
 cancelado         GESTIONAR            (banda neto..bruto)
 (sin banda)       (x cobrar aliado)           │
 │                      │            ┌──────────┴──────────┐
 │                      │       dentro banda          recogió de
 │                      │       o de más              MENOS (falta)
 │                      │            │                     │
 │                      │      VERIFICADO OK         PENDIENTE GESTIONAR
 │                      │            │                     │
 └──────────┬───────────┴───────────┴──────────┬──────────┘
            ▼                                   ▼
   COORDINADOR CONFIRMA ESTADO  ───►  ┌── VERIFICADO OK ──► saldado, cuenta en Finanzas
                                      └── PENDIENTE GESTIONAR ─┐
                                                               ▼
                                                        CONCILIACIONES
                                         (también: fact. mensual y sin recibo)
                                          - definir vía: llamar / fact. mensual
                                          - marcar resuelta al cobrar
            │
            ▼
     ┌──── CERRAR CUADRE ────┐
     │                       │
 ¿Falta comprobante digital  │
  O el técnico debe efectivo │
 (falta y NO es pendiente    │
  gestionar)?                │
     │            │          │
    SÍ           NO          │
     │            │          │
  AVISO         confirmación │
 "cerrar de     normal       │
  todas formas" │            │
 (no bloquea)   │            │
     └─────┬────┘            │
           ▼                 │
   CUADRE CERRADO (congelado)
           ▼
   Dinero a entregar = efectivo − reconocido − ajuste
   (reconocido = transporte + recargos + pago servicio + cancelados)
           ▼
   Técnico entrega el efectivo → "Confirmar dinero recibido"
   (queda: quién recibió, cuándo, monto, notas — una sola vez)
```

---

## 2. Detalle por etapa

### A. Qué filas entran al cuadre
`generar_cuadre_tecnico` (RPC) arma una fila por cada:
1. **Recibo del técnico** en el rango — **UNO por servicio** (regla de conteo único,
   migración 027): un servicio puede tener varios recibos (el técnico lo regeneró,
   o generó doble documento CLIENTE + VETERINARIA del mismo cobro), pero el dinero
   cuenta una sola vez. El recibo "contado" = el más reciente **con dinero**; si
   ninguno cobró, el más reciente. Los demás recibos siguen siendo documentos
   válidos (PDF cliente/veterinaria), solo que no suman.
2. **Servicio recogido SIN recibo** (recogió pero no cobró) → etiqueta `SIN RECIBO`, recogido $0.
3. **Cancelado** que no esté ya en un cuadre cerrado → para reconocer el pago por cancelado.

El rango se mide por `servicios.fecha_ingreso` (recibos por `fecha_emision`).
La exclusión de cuadres CERRADOS es **por servicio**: si el dinero del servicio ya
se cuadró y cerró, otro recibo del mismo servicio no lo vuelve a meter. Una fila
`SIN RECIBO` cerrada **no bloquea**: si el técnico cobra después, ese recibo entra
al cuadre nuevo (y la conciliación vieja se marca resuelta a mano).

### B. Diferencia por fila (banda neto..bruto)
- **neto** = `valor_a_recoger` → lo que paga el cliente (transporte a municipio incluido, comisión descontada).
- **bruto** = `valor_a_cobrar` → incluye la comisión de la veterinaria.

| Recogido | Resultado |
|---|---|
| Entre neto y bruto | Diferencia = 0 (cuadrado) |
| Menos que el neto | Falta (diferencia > 0) |
| Más que el bruto | De más (excedente) |
| Fact. mensual / cancelado | No aplica banda |

### C. Los dos estados
| Estado | Significado |
|---|---|
| **Verificado OK** | Saldado, no se debe nada. Ese dinero **cuenta** en el reporte de Finanzas. |
| **Pendiente gestionar** | Pago pendiente del cliente, comisión de veterinaria o facturación mensual → **pasa a Conciliaciones**. |

**Sugerencia automática** (el coordinador puede cambiarla):
- Facturación mensual → *Pendiente gestionar*
- Recogió de menos (falta) → *Pendiente gestionar*
- Cuadrado o recogió de más → *Verificado OK*

### D. Conciliaciones
Entra una fila si **no está resuelta** y es: *Pendiente gestionar*, *facturación mensual* o *sin recibo*.
Ahí se define la **vía de cobro** (*Llamar a cobrar* / *Facturación mensual*) y se marca **resuelta** al cobrar
(funciona incluso con el cuadre ya cerrado).

### E. Cierre del cuadre
El cuadre **siempre se puede cerrar**. Al cerrar solo hay un **aviso** (con botón
*"Cerrar de todas formas"*, nunca bloqueo total) en dos casos:
1. **Falta comprobante** de un pago digital (`digital > 0` y ese servicio no tiene ningún comprobante subido).
2. **El técnico de verdad debe efectivo**: recogió de menos (diferencia > 0) y **NO** está marcado como *Pendiente gestionar*.

> Si el faltante ya se justificó como *Pendiente gestionar* (cliente / veterinaria), no molesta al cerrar.
> Si quedó sin justificar (o "Sin revisar" con faltante), sí avisa: ahí el técnico se estaría quedando con la plata.

### F. Dinero a entregar a gerencia
```
dinero a entregar = efectivo recibido − reconocido al técnico − ajuste manual
reconocido al técnico = transporte + recargos + pago por servicio + pago por cancelados
```
El pago digital va directo a la empresa (no pasa por el técnico).

### G. Comprobantes
El modal del cuadre busca el comprobante por **`servicio_id`** (no por `recibo_id`),
porque un servicio puede tener varios recibos y el comprobante suele quedar bajo otro recibo.
Así aparecen todos los que subió el técnico.

### H. Confirmación de entrega del dinero (migración 029)
Cerrar el cuadre y **recibir el efectivo** son dos momentos distintos. Cuando el
técnico entrega la plata, gerencia pulsa **"Confirmar dinero recibido"** en el
cuadre cerrado (tarjeta azul): queda registrado **quién recibió, cuándo, el monto
y notas** (`cuadres_tecnico.entrega_*`, RPC `confirmar_entrega_cuadre`). Es de
una sola vez y solo aplica a cuadres CERRADOS. Si el monto difiere del cuadre,
la nota es obligatoria. El historial marca los cerrados **"Pendiente de entrega"**
hasta que se confirme.

### I. Historial de cuadres
Cuando no hay un cuadre cargado, la pestaña muestra **"Cuadres anteriores"**
(últimos 30, borradores y cerrados). Desde ahí se **abre** cualquier cuadre:
un CERRADO queda de solo lectura (sirve para re-descargar el PDF, ver firma y
entrega) y un BORRADOR se puede seguir editando/regenerando.

### J. Ayudas para gerencia
- **Rango sugerido**: al elegir técnico se precarga *desde = día siguiente al
  último cuadre CERRADO de ese técnico* y *hasta = hoy* (editable).
- **Aviso de saldo a favor**: si el técnico quedó con saldo a favor en cuadres
  cerrados anteriores, un banner ámbar lo muestra al generar. **No se arrastra
  automático** (decisión 2026-07-06): se compensa a mano con el Ajuste manual (+).
- **Guía en la UI**: botón *"¿Cómo funciona?"* con el flujo en 4 pasos
  (`GuiaCuadreModal` — mantener sincronizado con este documento).

---

## 3. Notas técnicas
- Estado en DB: `cuadre_items.estado_conciliacion IN ('VERIFICADO','PENDIENTE_GESTIONAR')` (o `NULL` = sin revisar).
  Constraint fijada en la migración `migrations/022_cuadre_dos_estados_conciliacion.sql`.
- **Conteo único del dinero** (migración `027_recibos_duplicados_conteo_unico.sql`):
  `recibos_tecnico.pago_aplicado` registra cuánto sumó cada recibo a
  `servicios.valor_pagado`; `guardar_recibo_tecnico` v2 resta lo aplicado por
  recibos anteriores del servicio antes de sumar (regenerar un recibo NO duplica
  el pago), y `generar_cuadre_tecnico` v7 toma un solo recibo por servicio
  (`DISTINCT ON`). Las marcas manuales del borrador (lejanía, obs, estado,
  conciliación) se preservan por **servicio** al regenerar.
- El cierre (`cerrar_cuadre` RPC) **no** valida estados: el freno es solo el aviso en la UI.
- **Entrega del dinero** (migración `029_cuadre_entrega_dinero.sql`): columnas
  `entrega_confirmada_en/por`, `entrega_monto`, `entrega_notas` en `cuadres_tecnico`
  + RPC `confirmar_entrega_cuadre` (solo CERRADO, una sola vez).
- Helpers relevantes en `Finanzas.jsx`: `diferenciaItem`, `valorARecoger`, `esFactMensual`,
  `estadoSugerido`, `faltaPlata`, `tecnicoDebe`, `enConciliacion`, `cerrarCuadre`,
  `abrirCuadre`, `cargarHistorial`, `confirmarEntrega`, `seleccionarTecnico`.
```
