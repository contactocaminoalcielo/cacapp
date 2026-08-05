-- 085_reportes_medicion.sql
-- Indicadores del módulo de Reportes que YA se pueden calcular con los datos
-- que Orbit viene guardando. Ver docs: auditoría de medición del 2026-08-05.
--
-- POR QUÉ EN SQL Y NO EN EL NAVEGADOR: PostgREST corre con PGRST_DB_MAX_ROWS=1000.
-- `produccion_recordatorio_log` ya tiene 7.023 filas y `novedades_servicio` 3.036:
-- leerlas desde el frontend para agregarlas devolvería 1.000 filas en silencio y
-- los indicadores saldrían MAL sin ningún error visible. Estas funciones devuelven
-- el resultado ya agregado (decenas de filas), muy por debajo del tope.
--
-- Todas son de solo lectura y SECURITY INVOKER: respetan las políticas RLS
-- existentes (`auth_full`), no las eluden.
--
-- ESTE ARCHIVO NO TRAE BEGIN/COMMIT a propósito: aplicar con
--   psql -v ON_ERROR_STOP=1 --single-transaction -f 085_reportes_medicion.sql
-- Así el ensayo con ROLLBACK sí funciona (un BEGIN externo no protege a un
-- archivo que trae su propio COMMIT).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Espera por imágenes del cliente
--     Separa el retraso propio del retraso del cliente. Una fila por servicio
--     en `solicitudes_imagenes` (verificado: numero_solicitud siempre 1).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rep_espera_imagenes(date, date);
CREATE FUNCTION public.rep_espera_imagenes(p_desde date, p_hasta date)
RETURNS TABLE (
  mes            text,
  solicitadas    bigint,
  recibidas      bigint,
  dias_promedio  numeric,
  dias_mediana   numeric,
  dias_p90       numeric
)
LANGUAGE sql STABLE AS $$
  SELECT to_char(si.fecha_solicitud, 'YYYY-MM')                        AS mes,
         count(*)                                                      AS solicitadas,
         count(si.fecha_recepcion)                                     AS recibidas,
         round(avg(si.fecha_recepcion - si.fecha_solicitud)::numeric, 1) AS dias_promedio,
         round(percentile_cont(0.5) WITHIN GROUP (
           ORDER BY (si.fecha_recepcion - si.fecha_solicitud))::numeric, 1) AS dias_mediana,
         round(percentile_cont(0.9) WITHIN GROUP (
           ORDER BY (si.fecha_recepcion - si.fecha_solicitud))::numeric, 1) AS dias_p90
  FROM public.solicitudes_imagenes si
  JOIN public.servicios s ON s.id = si.servicio_id
  WHERE s.estado <> 'CANCELADO'
    AND si.fecha_solicitud IS NOT NULL
    AND (p_desde IS NULL OR si.fecha_solicitud >= p_desde)
    AND (p_hasta IS NULL OR si.fecha_solicitud <= p_hasta)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Los que siguen esperando. Es la lista accionable: a estos hay que perseguirlos.
DROP FUNCTION IF EXISTS public.rep_espera_imagenes_pendientes(integer);
CREATE FUNCTION public.rep_espera_imagenes_pendientes(p_limite integer DEFAULT 300)
RETURNS TABLE (
  servicio_id     uuid,
  mascota         text,
  propietario     text,
  telefono        text,
  fecha_solicitud date,
  dias_esperando  integer,
  estado_servicio text
)
LANGUAGE sql STABLE AS $$
  SELECT s.id,
         m.nombre,
         TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')),
         COALESCE(NULLIF(TRIM(c.whatsapp),''), NULLIF(TRIM(c.telefono),''), NULLIF(TRIM(c.telefono2),'')),
         si.fecha_solicitud,
         (CURRENT_DATE - si.fecha_solicitud)::integer,
         s.estado
  FROM public.solicitudes_imagenes si
  JOIN public.servicios s      ON s.id = si.servicio_id
  JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
  LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
  WHERE si.fecha_recepcion IS NULL
    AND si.fecha_solicitud IS NOT NULL
    AND s.estado <> 'CANCELADO'
    AND COALESCE(si.seguimiento_pausado, false) = false
  ORDER BY si.fecha_solicitud ASC   -- el que más lleva esperando, primero
  LIMIT COALESCE(p_limite, 300);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Frente comercial: servicios por veterinaria y por canal
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rep_veterinarias(date, date);
CREATE FUNCTION public.rep_veterinarias(p_desde date, p_hasta date)
RETURNS TABLE (
  aliado_id         uuid,
  aliado            text,
  vip               boolean,
  servicios         bigint,
  valor_total       numeric,
  primera_remision  date,
  ultima_remision   date,
  dias_sin_remitir  integer
)
LANGUAGE sql STABLE AS $$
  WITH hist AS (   -- primera/última remisión SIEMPRE sobre todo el histórico,
                   -- no sobre el rango: "dejó de remitir" no puede depender del filtro
    SELECT aliado_origen_id AS id, min(fecha_ingreso) AS primera, max(fecha_ingreso) AS ultima
    FROM public.servicios
    WHERE aliado_origen_id IS NOT NULL AND estado <> 'CANCELADO'
    GROUP BY 1
  )
  SELECT a.id_aliado,
         a.nombre,
         a.vip,
         count(s.id)                                      AS servicios,
         COALESCE(sum(s.valor_total), 0)                  AS valor_total,
         h.primera,
         h.ultima,
         (CURRENT_DATE - h.ultima)::integer               AS dias_sin_remitir
  FROM public.aliados a
  JOIN hist h ON h.id = a.id_aliado
  LEFT JOIN public.servicios s
    ON s.aliado_origen_id = a.id_aliado
   AND s.estado <> 'CANCELADO'
   AND (p_desde IS NULL OR s.fecha_ingreso >= p_desde)
   AND (p_hasta IS NULL OR s.fecha_ingreso <= p_hasta)
  GROUP BY a.id_aliado, a.nombre, a.vip, h.primera, h.ultima
  ORDER BY servicios DESC, a.nombre;
$$;

DROP FUNCTION IF EXISTS public.rep_canales(date, date);
CREATE FUNCTION public.rep_canales(p_desde date, p_hasta date)
RETURNS TABLE (
  canal        text,
  servicios    bigint,
  valor_total  numeric,
  con_aliado   bigint
)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(s.canal_entrada, 'SIN_CANAL'),
         count(*),
         COALESCE(sum(s.valor_total), 0),
         count(s.aliado_origen_id)
  FROM public.servicios s
  WHERE s.estado <> 'CANCELADO'
    AND (p_desde IS NULL OR s.fecha_ingreso >= p_desde)
    AND (p_hasta IS NULL OR s.fecha_ingreso <= p_hasta)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Producción: cola por etapa y flujo
--     `produccion_recordatorio_log` guarda estado anterior y nuevo en columnas
--     separadas desde el 7-jul-2026, así que la cola sale sola.
-- ─────────────────────────────────────────────────────────────────────────────

-- OJO al leer esta cola: los recordatorios `digital` inflan los números y NO son
-- trabajo de taller. "Dia de amor y milagrino" (589 en PENDIENTE) se queda ahí a
-- propósito, y "Tarjeta de oración" / "Audio de despedida" / "Herramientas de
-- superación de duelo" son enlaces fijos de la plantilla de WhatsApp que solo se
-- marcan al enviar los digitales. "Evidencias de conservación" vive en EN_PROCESO
-- por diseño (recolecta_tecnico). Por eso la función devuelve `categoria` y
-- `recolecta_tecnico`: el cuello de botella real es la cola `fisico`.
DROP FUNCTION IF EXISTS public.rep_cola_produccion();
CREATE FUNCTION public.rep_cola_produccion()
RETURNS TABLE (
  estado            text,
  recordatorio      text,
  categoria         text,
  recolecta_tecnico boolean,
  items             bigint,
  dias_promedio     numeric,
  items_mas_7dias   bigint,
  dias_max          integer
)
LANGUAGE sql STABLE AS $$
  WITH ultimo AS (   -- cuándo entró cada ítem a su estado ACTUAL
    SELECT DISTINCT ON (l.servicio_recordatorio_id)
           l.servicio_recordatorio_id AS sr_id, l.created_at, l.estado_nuevo
    FROM public.produccion_recordatorio_log l
    ORDER BY l.servicio_recordatorio_id, l.created_at DESC
  ),
  vivos AS (
    SELECT sr.id, sr.estado, r.nombre AS recordatorio,
           r.categoria, COALESCE(r.recolecta_tecnico, false) AS recolecta_tecnico,
           -- si el log no cubre el estado actual (ítems anteriores al 7-jul),
           -- se cae al created_at del ítem: es un piso, nunca inventa antigüedad
           GREATEST(0, EXTRACT(EPOCH FROM (
             now() - COALESCE(
               CASE WHEN u.estado_nuevo = sr.estado THEN u.created_at END,
               sr.created_at)
           )) / 86400.0) AS dias
    FROM public.servicio_recordatorios sr
    JOIN public.recordatorios r ON r.id = sr.recordatorio_id
    JOIN public.servicios s     ON s.id = sr.servicio_id
    LEFT JOIN ultimo u          ON u.sr_id = sr.id
    WHERE sr.estado IN ('PENDIENTE', 'EN_PROCESO', 'LISTO')
      AND s.estado <> 'CANCELADO'
      AND COALESCE(sr.origen, '') <> 'REMOVIDO'
  )
  SELECT estado,
         recordatorio,
         categoria,
         recolecta_tecnico,
         count(*),
         round(avg(dias)::numeric, 1),
         count(*) FILTER (WHERE dias > 7),
         floor(max(dias))::integer
  FROM vivos
  GROUP BY 1, 2, 3, 4
  ORDER BY 5 DESC;
$$;

DROP FUNCTION IF EXISTS public.rep_flujo_produccion(date, date);
CREATE FUNCTION public.rep_flujo_produccion(p_desde date, p_hasta date)
RETURNS TABLE (
  semana        date,
  estado_nuevo  text,
  movimientos   bigint
)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', l.created_at AT TIME ZONE 'America/Bogota')::date,
         l.estado_nuevo,
         count(*)
  FROM public.produccion_recordatorio_log l
  WHERE l.estado_nuevo IS NOT NULL
    AND (p_desde IS NULL OR (l.created_at AT TIME ZONE 'America/Bogota')::date >= p_desde)
    AND (p_hasta IS NULL OR (l.created_at AT TIME ZONE 'America/Bogota')::date <= p_hasta)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · Línea de tiempo del servicio
--     El disparador `fn_registrar_cambio_estado` guarda cada cambio desde el
--     22-may-2026, pero como FRASE ('Estado: X → Y') en novedades_servicio.
--     Aquí se parte el texto para reconstruir cuánto duró cada etapa.
--     Si algún día ese log pasa a columnas propias, esta función se simplifica
--     pero su salida no cambia.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rep_tiempos_servicio(date, date);
CREATE FUNCTION public.rep_tiempos_servicio(p_desde date, p_hasta date)
RETURNS TABLE (
  estado          text,
  servicios       bigint,
  horas_promedio  numeric,
  horas_mediana   numeric,
  horas_p90       numeric
)
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT n.servicio_id,
           n.created_at,
           -- chr(8594) = '→'. Se usa el código para no depender del encoding del archivo.
           split_part(n.descripcion, ' ' || chr(8594) || ' ', 2) AS estado_a,
           lead(n.created_at) OVER (PARTITION BY n.servicio_id ORDER BY n.created_at) AS siguiente
    FROM public.novedades_servicio n
    JOIN public.servicios s ON s.id = n.servicio_id
    WHERE n.tipo_novedad = 'CAMBIO_ESTADO'
      AND n.descripcion LIKE 'Estado: %' || chr(8594) || '%'
      AND s.estado <> 'CANCELADO'
      AND (p_desde IS NULL OR s.fecha_ingreso >= p_desde)
      AND (p_hasta IS NULL OR s.fecha_ingreso <= p_hasta)
  ),
  dur AS (
    SELECT estado_a,
           servicio_id,
           EXTRACT(EPOCH FROM (siguiente - created_at)) / 3600.0 AS horas
    FROM ev
    WHERE siguiente IS NOT NULL AND estado_a <> ''
  )
  SELECT estado_a,
         count(*),
         round(avg(horas)::numeric, 1),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 1),
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY horas)::numeric, 1)
  FROM dur
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos. SECURITY INVOKER + estos GRANT = el usuario ve exactamente lo que
-- sus políticas RLS ya le permiten ver, ni más ni menos.
-- ─────────────────────────────────────────────────────────────────────────────

-- ⚠️ Postgres concede EXECUTE a PUBLIC por defecto, y PUBLIC incluye a `anon`.
-- Sin este REVOKE, cualquiera con la ANON_KEY (que viaja en el bundle del
-- frontend) podía llamar rep_canales y leer la facturación agregada. La RLS
-- filtraba las filas, pero los totales igual salían. Revocar SIEMPRE antes de
-- conceder. Ver la nota de seguridad del portal /solicitud.
REVOKE ALL ON FUNCTION public.rep_espera_imagenes(date, date)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_espera_imagenes_pendientes(integer)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_veterinarias(date, date)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_canales(date, date)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_cola_produccion()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_flujo_produccion(date, date)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_tiempos_servicio(date, date)           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rep_espera_imagenes(date, date)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_espera_imagenes_pendientes(integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_veterinarias(date, date)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_canales(date, date)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_cola_produccion()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_flujo_produccion(date, date)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_tiempos_servicio(date, date)           TO authenticated;

-- Índices de apoyo: estas consultas barren el log completo y crecen ~1.000
-- filas/semana. Sin esto los reportes se van poniendo lentos solos.
CREATE INDEX IF NOT EXISTS idx_prod_log_sr_fecha
  ON public.produccion_recordatorio_log (servicio_recordatorio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_novedades_tipo_servicio
  ON public.novedades_servicio (tipo_novedad, servicio_id, created_at);
