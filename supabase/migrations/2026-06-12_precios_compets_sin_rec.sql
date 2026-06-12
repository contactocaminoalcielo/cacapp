-- ─────────────────────────────────────────────────────────────────────────────
-- Tarifas del plan "Compets sin recordatorios" (COMPETS_SIN_REC)
-- 2026-06-12 — antes este plan NO tenía filas en planes_precios y el frontend
-- calculaba un fallback hardcodeado (Compets Evidencia × 80%) que daba tarifas
-- incorrectas. El fallback fue eliminado de Registro.jsx y Kanban.jsx; desde
-- este seed las tarifas viven en planes_precios y se editan desde
-- Configuración → Precios sin tocar código.
--
-- Tarifas correctas (confirmadas por David):
--   PETIT  (0-999 g, todas las especies)  $339.000
--   FELINO (gato o conejo, ≥ 1 kg)        $409.000
--   1-10KG                                $499.000
--   11-20KG                               $499.000
--   21-35KG                               $579.000
--   36-60KG                               $659.000
--
-- Idempotente: no duplica si la fila plan+rango ya existe.
-- Ejecutar en el VPS Contabo:
--   cd /opt/supabase/docker && docker compose exec db psql -U postgres -d postgres \
--     --pset pager=off -f - < 2026-06-12_precios_compets_sin_rec.sql
-- (o pegar el INSERT directo con -c)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.planes_precios (plan_id, rango_nombre, peso_min_gr, peso_max_gr, precio)
SELECT v.plan_id, v.rango_nombre, v.peso_min_gr, v.peso_max_gr, v.precio
FROM (VALUES
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, 'PETIT',   0,     999,        339000::numeric),
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, 'FELINO',  1000,  NULL::int,  409000::numeric),
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, '1-10KG',  1000,  10999,      499000::numeric),
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, '11-20KG', 11000, 20999,      499000::numeric),
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, '21-35KG', 21000, 35999,      579000::numeric),
  ('47a278f4-0417-4ce7-aa0b-25b3e9093b49'::uuid, '36-60KG', 36000, 60999,      659000::numeric)
) AS v(plan_id, rango_nombre, peso_min_gr, peso_max_gr, precio)
WHERE NOT EXISTS (
  SELECT 1 FROM public.planes_precios pp
  WHERE pp.plan_id = v.plan_id AND pp.rango_nombre = v.rango_nombre
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Planes nuevos "Exclusivo sin recordatorios" (decisión David 2026-06-12:
--    DOS planes, uno por cada base). Estos NO llevan filas en planes_precios:
--    el precio se deriva en código como plan base × 0.8 (Registro, Kanban,
--    SolicitudCliente) — si suben los precios del plan base en Configuración,
--    estos siguen automáticamente.
--    Atributos espejo de su plan base; precio_base solo es informativo en
--    catálogos (base × 0.8). Idempotente por codigo.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.planes
  (codigo, nombre, categoria, tipo_proceso, requiere_imagenes, dias_entrega_prometidos, precio_base, activo)
SELECT v.*
FROM (VALUES
  ('EXCLUSIVO_PRESENCIAL_SIN_REC',   'Exclusivo presencial sin recordatorios',   'individual', 'CREMACION_INDIVIDUAL', true, 8, 400000::numeric, true),
  ('EXCLUSIVO_VIDEOLLAMADA_SIN_REC', 'Exclusivo videollamada sin recordatorios', 'individual', 'CREMACION_INDIVIDUAL', true, 8, 384000::numeric, true)
) AS v(codigo, nombre, categoria, tipo_proceso, requiere_imagenes, dias_entrega_prometidos, precio_base, activo)
WHERE NOT EXISTS (
  SELECT 1 FROM public.planes p WHERE p.codigo = v.codigo
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Regla de decimales (David 2026-06-12): un peso decimal pertenece a su
--    rango hasta ALCANZAR el mínimo del siguiente — 10.4 kg es 1-10KG, solo
--    desde 11.0 kg entra a 11-20KG. Se corren los límites en gramos de TODAS
--    las filas existentes (antes 11-20KG empezaba en 10001 g). El tope sube a
--    60999 g por la misma regla (60.4 kg sigue siendo 36-60KG).
--    Idempotente: los guards solo tocan filas con los límites antiguos.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.planes_precios SET peso_max_gr = 10999
  WHERE rango_nombre = '1-10KG'  AND peso_max_gr = 10000;
UPDATE public.planes_precios SET peso_min_gr = 11000, peso_max_gr = 20999
  WHERE rango_nombre = '11-20KG' AND peso_min_gr = 10001;
UPDATE public.planes_precios SET peso_min_gr = 21000, peso_max_gr = 35999
  WHERE rango_nombre = '21-35KG' AND peso_min_gr = 20001;
UPDATE public.planes_precios SET peso_min_gr = 36000, peso_max_gr = 60999
  WHERE rango_nombre = '36-60KG' AND peso_min_gr = 35001;

-- Verificación
SELECT pp.rango_nombre, pp.peso_min_gr, pp.peso_max_gr, pp.precio
FROM public.planes_precios pp
WHERE pp.plan_id = '47a278f4-0417-4ce7-aa0b-25b3e9093b49'
ORDER BY pp.peso_min_gr, pp.rango_nombre;

SELECT codigo, nombre, tipo_proceso, activo
FROM public.planes
WHERE codigo IN ('EXCLUSIVO_PRESENCIAL_SIN_REC', 'EXCLUSIVO_VIDEOLLAMADA_SIN_REC');
