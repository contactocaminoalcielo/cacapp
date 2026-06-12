-- ============================================================
-- ORBIT — HARDENING FORMULARIO PÚBLICO /solicitud
-- Fecha: 2026-06-12 | Producción: Contabo (db.orbitacac.com)
-- ============================================================
-- Problemas que corrige (auditoría pre-deploy del envío de enlace):
--
--   1. aliados: la policy anon_select USING(true) + GRANT de tabla
--      completa dejaban a CUALQUIER anónimo leer vía REST todas las
--      columnas comerciales (telefono, whatsapp, contacto_nombre,
--      vip, modalidad_comision, ...). El formulario público solo
--      necesita id_aliado, nombre, ciudad (+ activo para filtrar).
--      → GRANT por columnas + policy restringida a activos.
--
--   2. solicitudes_servicio: sin límite de tamaño en campos text.
--      Un atacante con la anon key podía insertar strings gigantes.
--      → CHECK de longitudes máximas (NOT VALID: no toca filas viejas).
--
--   (3. El flooding de inserts se mitiga con rate limit en nginx —
--       ver 04_nginx_solicitudes_ratelimit.conf, se aplica aparte.)
--
-- Cómo aplicar (SSH al VPS):
--   cd /opt/supabase/docker && docker compose exec db psql -U postgres -d postgres --pset pager=off -f - < este_archivo
--   (o pegar el bloque completo en un solo -c "...")
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. aliados: anon solo lee columnas mínimas y solo activos
-- ────────────────────────────────────────────────────────────
-- Usado por SolicitudCliente.jsx:
--   db.from('aliados').select('id_aliado,nombre,ciudad').eq('activo', true).order('nombre')
-- authenticated NO se toca (auth_full + grants intactos).

REVOKE SELECT ON public.aliados FROM anon;
GRANT SELECT (id_aliado, nombre, ciudad, activo) ON public.aliados TO anon;

DROP POLICY IF EXISTS "anon_select" ON public.aliados;
CREATE POLICY "anon_select_activos" ON public.aliados
  FOR SELECT TO anon USING (activo = true);

-- ────────────────────────────────────────────────────────────
-- 2. solicitudes_servicio: longitudes máximas (anti-payload gigante)
-- ────────────────────────────────────────────────────────────
-- NOT VALID: se aplica solo a inserts/updates nuevos, no valida
-- las filas históricas (no bloquea el deploy si hubiera datos largos).

ALTER TABLE public.solicitudes_servicio
  ADD CONSTRAINT solicitudes_servicio_max_len CHECK (
    length(coalesce(cliente_nombre,    '')) <= 120 AND
    length(coalesce(cliente_apellido,  '')) <= 120 AND
    length(coalesce(cliente_cedula,    '')) <= 30  AND
    length(coalesce(cliente_whatsapp,  '')) <= 25  AND
    length(coalesce(cliente_telefono,  '')) <= 25  AND
    length(coalesce(cliente_telefono2, '')) <= 25  AND
    length(coalesce(cliente_email,     '')) <= 160 AND
    length(coalesce(cliente_ciudad,    '')) <= 80  AND
    length(coalesce(cliente_localidad, '')) <= 80  AND
    length(coalesce(cliente_barrio,    '')) <= 120 AND
    length(coalesce(cliente_direccion, '')) <= 250 AND
    length(coalesce(mascota_nombre,    '')) <= 120 AND
    length(coalesce(mascota_raza,      '')) <= 120 AND
    length(coalesce(mascota_sexo,      '')) <= 20  AND
    length(coalesce(aliado_nombre_otro,'')) <= 160 AND
    length(coalesce(ciudad,            '')) <= 80  AND
    length(coalesce(localidad,         '')) <= 80  AND
    length(coalesce(barrio,            '')) <= 120 AND
    length(coalesce(direccion,         '')) <= 250 AND
    length(coalesce(notas_cliente,     '')) <= 2000 AND
    (mascota_peso_kg IS NULL OR (mascota_peso_kg > 0 AND mascota_peso_kg <= 1000))
  ) NOT VALID;

COMMIT;

-- PostgREST: recargar schema cache para que tome los nuevos grants
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN (correr después de aplicar)
-- ============================================================
-- Como anon vía REST (reemplazar $ANON por la anon key):
--   OK (200, solo columnas públicas):
--     curl 'https://db.orbitacac.com/rest/v1/aliados?select=id_aliado,nombre,ciudad&activo=eq.true' -H "apikey: $ANON"
--   DEBE FALLAR (42501 permission denied):
--     curl 'https://db.orbitacac.com/rest/v1/aliados?select=telefono,whatsapp,modalidad_comision' -H "apikey: $ANON"
--     curl 'https://db.orbitacac.com/rest/v1/aliados' -H "apikey: $ANON"          # select=* implícito
--   DEBE FALLAR (23514 check violation):
--     POST a solicitudes_servicio con notas_cliente de 3000 chars

-- ============================================================
-- ROLLBACK (solo si algo se rompe)
-- ============================================================
-- BEGIN;
-- GRANT SELECT ON public.aliados TO anon;
-- DROP POLICY IF EXISTS "anon_select_activos" ON public.aliados;
-- CREATE POLICY "anon_select" ON public.aliados FOR SELECT TO anon USING (true);
-- ALTER TABLE public.solicitudes_servicio DROP CONSTRAINT IF EXISTS solicitudes_servicio_max_len;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
