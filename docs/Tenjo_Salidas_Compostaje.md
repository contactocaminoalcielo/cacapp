# Tenjo — Salidas del compostaje, cupo por cubículo y el reloj de los recordatorios

**Migración 155** · `migrations/155_tenjo_salida_cubiculo_cupo.sql` · 2026-09-11

Tres cambios que se pidieron juntos y que en realidad son uno solo: **cerrar bien el
compostaje**. Hasta hoy Orbit sabía cuándo entraba una mascota al cubículo, pero no cuándo
salía; y como no lo sabía, prometía la entrega de los recordatorios contra una fecha que no
tenía nada que ver.

---

## 1. La pestaña Salidas

`Tenjo → 🌿 Salidas` (`src/pages/tenjo/SalidasTab.jsx`). Dos listas:

| Lista | Qué trae |
|---|---|
| **Por sacar del cubículo** | Compostajes individuales que ya cumplieron su tiempo (`fecha_compostaje_inicio + meses_compostaje`) y siguen adentro. Con el atraso en días. |
| **Ya salieron** | Los que tienen `cubiculo_salida`, desde la fecha que se elija (por defecto, 60 días atrás). |

De cada una sale:

- **PDF** (`src/lib/salidasCompostajePdf.js`, jsPDF directo). El de "por sacar" lleva casilla
  de firma del operario: es la hoja de trabajo de la planta.
- **WhatsApp**: abre `wa.me/?text=…` con el listado escrito.
  ⚠️ **wa.me no puede adjuntar archivos.** El enlace lleva el texto; el PDF se baja al
  equipo y se adjunta a mano si hace falta. Es el mismo patrón que ya usan Jornada y Visitas.

Se puede sacar **una** mascota o **varias marcadas a la vez**, siempre poniendo la fecha real
de salida.

## 2. La fecha de salida manda sobre la entrega de los recordatorios

### El problema que corrige

`fn_calcular_fecha_entrega` (migración 007) fija
`servicios.fecha_limite_entrega = fecha_imagenes_recibidas + dias_entrega_prometidos` (8 días
hábiles). En un compostaje de 2–3 meses esa fecha **nace vencida**: la mascota sigue en el
cubículo cuando el plazo ya pasó, y Kanban y Producción la pintan en rojo durante dos meses.

### La regla nueva

Solo para **COMPOSTAJE_INDIVIDUAL** cuya familia **no marcó** que quiere los recordatorios
anticipados — es decir, `servicios.recordatorios_anticipados IS NOT TRUE`: dijo *"prefiero
recibirlos todos al final"* en el portal de fotos, **o no contestó**:

```
fecha_limite_entrega = cubiculo_salida + dias_entrega_prometidos  (días hábiles, con festivos)
```

Mientras la mascota siga adentro, `fecha_limite_entrega` es **NULL a propósito**: todavía no
hay compromiso que medir, y una fecha inventada es peor que ninguna.

Quien **sí** pidió los recordatorios anticipados (`= true`) no cambia: su producción arranca
con las imágenes y su plazo también.

### Cómo se sostiene

- `fn_compostaje_espera_salida(servicio)` — la pregunta, en un solo sitio.
- `fn_recalcular_limite_compostaje(servicio)` — el cálculo. No toca lo `ENTREGADO`/`CANCELADO`.
- `trg_item_salida_limite` — dispara el recálculo al escribir o corregir `cubiculo_salida`.
- `fn_calcular_fecha_entrega` — modificada: en estos compostajes ya no fija nada al llegar
  las imágenes.

Los tooltips de **Kanban** (`explicaLimite`) y **Producción** dicen de dónde sale la fecha en
cada caso; si no, explicarían un cálculo que no ocurrió.

### Dos fechas, no una

| Columna | Qué es |
|---|---|
| `lotes_tenjo_items.cubiculo_liberado_en` (timestamptz) | Cuándo se **pulsó el botón**. Auditoría. |
| `lotes_tenjo_items.cubiculo_salida` (date) | Cuándo **salió la mascota**. Hecho operativo, corregible. |

Mismo patrón de `cuarto_frio.fecha_ingreso`: la hora de registro nunca es la hora del hecho.
Si se corrige la fecha, el plazo con la familia se recalcula solo.

Al **volver a meter** una mascota a un cubículo (Jornada, o reasignación) `cubiculo_salida`
se borra: si no, una salida vieja dejaría corriendo un plazo que ya no aplica.

## 3. Más de una mascota por cubículo

`cubiculos.capacidad smallint NOT NULL DEFAULT 1` (1–20). Se sube **a mano**, cubículo por
cubículo, desde `Tenjo → Cubículos → (tocar un cubículo)`. No se puede dejar por debajo de
las que ya están adentro.

El índice único `uq_cubiculo_ocupado` **se cayó** — ya no es "uno y solo uno" — y lo reemplaza
el trigger `fn_cubiculo_cupo`, que **bloquea la fila del cubículo** (`SELECT … FOR UPDATE`)
antes de contar. Sin ese bloqueo, dos operarios guardando a la vez podrían pasarse del cupo:
el índice único daba esa garantía gratis y un `COUNT` suelto no la da.

El mapa pasó a tener **tres** estados en vez de dos — vacío, con cupo, lleno — y un contador
en la esquina cuando el cubículo admite más de uno. Los totales por zona se cuentan en
**cupos**, no en cubículos: con capacidad > 1, "3 de 12 ocupados" no dice cuánto espacio
queda de verdad.

---

## Archivos

| Archivo | Qué cambió |
|---|---|
| `migrations/155_tenjo_salida_cubiculo_cupo.sql` | Todo lo de DB + puesta al día de lo vivo |
| `src/lib/cubiculos.js` | `ocupacion` pasa a ser **array**; `capacidad`, `cuposLibres`, `finCompostaje`, `cargarSalidasCompostaje`, `actualizarFechaSalida`, salida en `liberarCubiculo` |
| `src/lib/salidasCompostajePdf.js` | **nuevo** — PDF de las dos listas + texto para wa.me |
| `src/pages/tenjo/SalidasTab.jsx` | **nuevo** — la pestaña |
| `src/pages/tenjo/MapaCubiculos.jsx` | vacío / con cupo / lleno, contador, totales por cupos |
| `src/pages/tenjo/CubiculosTab.jsx` | varios ocupantes por cubículo, editor de cupo, sacar uno a uno |
| `src/pages/tenjo/JornadaTab.jsx` | limpia `cubiculo_salida` al asignar; `finCompostaje` deja de estar duplicado |
| `src/pages/Tenjo.jsx` | registra la pestaña Salidas |
| `src/pages/Kanban.jsx` · `src/pages/Produccion.jsx` | el tooltip de la fecha límite deja de mentir en estos compostajes |

## Al aplicar la migración

El archivo **no trae `BEGIN`/`COMMIT`**, así que el ensayo con `BEGIN … ROLLBACK` sí ensaya
de verdad (ver `memory/ops_aplicar_migraciones_vps.md`) y conviene aplicarla con `-1`.

```bash
# ANTES — cuántos compostajes esperan al final y con qué fecha vienen
cat <<'SQL' | ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 "docker exec -i supabase-db psql -U postgres -d postgres -f -"
SELECT count(*) FILTER (WHERE i.cubiculo_liberado_en IS NULL)          AS en_cubiculo,
       count(*) FILTER (WHERE s.fecha_limite_entrega < CURRENT_DATE)   AS con_fecha_vencida
  FROM lotes_tenjo_items i
  JOIN servicios s ON s.id = i.servicio_id
  JOIN planes    p ON p.id = s.plan_id
 WHERE i.cubiculo_id IS NOT NULL
   AND p.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL'
   AND s.recordatorios_anticipados IS NOT TRUE
   AND s.estado NOT IN ('ENTREGADO','CANCELADO');
SQL

# APLICAR (transacción única: o entra todo o no entra nada)
cat migrations/155_tenjo_salida_cubiculo_cupo.sql | ssh -i ~/.ssh/orbit_deploy \
  root@13.140.139.61 "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f -"

# DESPUÉS — ver la verificación al pie del archivo de migración
```

El frontend va por `git push` → Actions. **El backend no se toca en este cambio.**
