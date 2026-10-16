-- ============================================================================
-- 177 — Localidad del servicio (para filtrar el historial de Gestión)
-- Fecha: 2026-10-16 · pedido de David
--
-- `servicios` no tiene localidad. El dato existe, pero repartido según por
-- dónde entró el servicio (conteo en prod el 16-oct sobre 1704 servicios):
--   · la veterinaria donde se recoge     → aliados.localidad        (1098 con aliado con localidad)
--   · la solicitud del portal/Kanban     → solicitudes_servicio.localidad / cliente_localidad (421)
--   · el cliente                         → clientes.localidad
--   · Registro la guarda como texto      → clientes.notas "Localidad: X" (658)
--   · a veces quedó en el barrio         → recogidas.barrio / servicios.barrio_recogida
--
-- En vez de una columna nueva con backfill (que habría que mantener desde
-- Registro, Kanban y la edición de recogida, y que se desincroniza), esto es un
-- CAMPO CALCULADO de PostgREST: `localidad_servicio(servicios)` se puede pedir en
-- el select y filtrar (`?localidad_servicio=in.(...)`) como si fuera columna.
-- Siempre responde con un texto del catálogo, nunca NULL, para que el filtro sea
-- un `in` simple:
--   · una de las 20 localidades de Bogotá (nombre igual a LOCALIDADES_BOGOTA del front)
--   · 'Fuera de Bogotá' si la ciudad de recogida no es Bogotá
--   · 'Sin localidad'   si no hay de dónde sacarla
--
-- Prioridad: recogida en veterinaria → la localidad de la vet manda (es donde
-- está la mascota). A domicilio → la solicitud, luego el cliente, luego sus notas.
-- El barrio va de último y solo si es EXACTAMENTE el nombre de una localidad
-- (Kanban lo rellena con la localidad cuando no hay barrio): un barrio como
-- "San Cristóbal Norte" está en Usaquén, no en San Cristóbal.
--
-- Solo lectura, SECURITY INVOKER: respeta el RLS de cada tabla que consulta.
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;

-- Texto libre → nombre canónico de la localidad, o NULL si no es una.
-- Tolera tildes, mayúsculas, espacios dobles y los nombres cortos de uso diario.
CREATE OR REPLACE FUNCTION public.normalizar_localidad(p_txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT v.nombre
    FROM (VALUES
      ('antonio narino',      'Antonio Nariño'),
      ('barrios unidos',      'Barrios Unidos'),
      ('bosa',                'Bosa'),
      ('chapinero',           'Chapinero'),
      ('ciudad bolivar',      'Ciudad Bolívar'),
      ('engativa',            'Engativá'),
      ('fontibon',            'Fontibón'),
      ('kennedy',             'Kennedy'),
      ('la candelaria',       'La Candelaria'),
      ('candelaria',          'La Candelaria'),
      ('los martires',        'Los Mártires'),
      ('martires',            'Los Mártires'),
      ('puente aranda',       'Puente Aranda'),
      ('rafael uribe uribe',  'Rafael Uribe Uribe'),
      ('rafael uribe',        'Rafael Uribe Uribe'),
      ('san cristobal',       'San Cristóbal'),
      ('santa fe',            'Santa Fe'),
      ('santafe',             'Santa Fe'),
      ('suba',                'Suba'),
      ('sumapaz',             'Sumapaz'),
      ('teusaquillo',         'Teusaquillo'),
      ('tunjuelito',          'Tunjuelito'),
      ('usaquen',             'Usaquén'),
      ('usme',                'Usme')
    ) AS v(clave, nombre)
   WHERE v.clave = lower(regexp_replace(
           translate(trim(p_txt), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'),
           '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.localidad_servicio(s public.servicios)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT tipo_lugar, aliado_id, ciudad, barrio
      FROM recogidas WHERE servicio_id = s.id
     LIMIT 1
  ), ctx AS (
    SELECT COALESCE(NULLIF(r.tipo_lugar, ''), s.punto_recogida, 'DOMICILIO')   AS lugar,
           COALESCE(NULLIF(trim(r.ciudad), ''), NULLIF(trim(s.ciudad_recogida), '')) AS ciudad,
           COALESCE(r.aliado_id, s.aliado_origen_id)                          AS aliado_id,
           COALESCE(NULLIF(trim(r.barrio), ''), s.barrio_recogida)             AS barrio
      FROM (SELECT 1) uno LEFT JOIN r ON true
  ), cand(prio, txt) AS (
    -- En la veterinaria: la vet y lo que Kanban copió de ella a la solicitud.
    SELECT 1, a.localidad FROM ctx JOIN aliados a ON a.id_aliado = ctx.aliado_id
     WHERE ctx.lugar = 'CLINICA_ALIADA'
    UNION ALL
    SELECT 2, ss.localidad FROM solicitudes_servicio ss WHERE ss.servicio_id = s.id
    -- A domicilio: lo que dijo la solicitud del cliente y la ficha del cliente.
    UNION ALL
    SELECT 3, ss.cliente_localidad FROM ctx, solicitudes_servicio ss
     WHERE ss.servicio_id = s.id AND ctx.lugar <> 'CLINICA_ALIADA'
    UNION ALL
    SELECT 4, c.localidad FROM ctx, mascotas m JOIN clientes c ON c.id_cliente = m.cliente_id
     WHERE m.id_mascota = s.mascota_id AND ctx.lugar <> 'CLINICA_ALIADA'
    UNION ALL
    SELECT 5, substring(c.notas FROM '(?i)localidad:\s*([^.\n]+)')
      FROM ctx, mascotas m JOIN clientes c ON c.id_cliente = m.cliente_id
     WHERE m.id_mascota = s.mascota_id AND ctx.lugar <> 'CLINICA_ALIADA'
    UNION ALL
    SELECT 6, ctx.barrio FROM ctx
  )
  SELECT CASE
           WHEN ctx.ciudad IS NOT NULL
            AND lower(translate(ctx.ciudad, 'Áá', 'Aa')) NOT LIKE 'bogota%'
             THEN 'Fuera de Bogotá'
           ELSE COALESCE(
             (SELECT normalizar_localidad(cand.txt) FROM cand
               WHERE normalizar_localidad(cand.txt) IS NOT NULL
               ORDER BY cand.prio LIMIT 1),
             'Sin localidad')
         END
    FROM ctx
$$;

COMMENT ON FUNCTION public.localidad_servicio(public.servicios) IS
  'Campo calculado (PostgREST): localidad de Bogotá donde se recoge la mascota, deducida de vet/solicitud/cliente/barrio. Devuelve el nombre canónico, ''Fuera de Bogotá'' o ''Sin localidad''. Migración 177.';

REVOKE ALL ON FUNCTION public.normalizar_localidad(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.localidad_servicio(public.servicios)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalizar_localidad(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.localidad_servicio(public.servicios) TO authenticated;

COMMIT;

-- PostgREST tiene que ver la función nueva para exponerla como campo.
NOTIFY pgrst, 'reload schema';

-- ─── Verificación ───────────────────────────────────────────────────────────
-- SELECT public.localidad_servicio(s) AS localidad, count(*)
--   FROM public.servicios s GROUP BY 1 ORDER BY 2 DESC;

-- ─── ROLLBACK ───────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.localidad_servicio(public.servicios);
-- DROP FUNCTION IF EXISTS public.normalizar_localidad(text);
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
