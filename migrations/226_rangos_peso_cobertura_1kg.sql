-- ─────────────────────────────────────────────────────────────────────────────
-- 226 · Cada banda de peso cubre hasta 1 kg por encima de su nombre
-- REPORTE ORBIT 2026-11-25 (mejora, urgencia alta, «Recalcular peso»):
--   «el de 1-10 kg tenga una cobertura hasta los 11 kg y de la misma manera con
--    los demás rangos».
-- Lectura confirmada por David (26-nov): hasta ese kilo EXACTO — «si pesa 11.1
-- ya hace parte del escalón 11 a 20». 11,0 kg es 1-10; 11,001 kg ya es 11-20.
--
--   banda      antes (g)        ahora (g)
--   1-10KG     1000 – 10999     1000 – 11000
--   11-20KG   11000 – 20999    11001 – 21000
--   21-35KG   21000 – 35999    21001 – 36000
--   36-60KG   36000 – 60999    36001 – 61000
--
-- En la práctica cambia de banda el peso que cae JUSTO en 11,0 · 21,0 · 36,0 kg
-- (pasa a la banda más barata) y 61,0 kg entra en 36-60. Todo el código pasa el
-- peso a gramos con Math.round / round(): 11,0004 kg = 11000 g.
--
-- PETIT (< 1 kg) y FELINO (plana desde 1 kg) no cambian.
-- Espejo en código: src/lib/rangosPeso.js (portales y Configuración). Si se
-- cambia una, se cambia la otra.
--
-- Quién lee estos límites: calcularPrecioPara (Gestión, báscula del técnico,
-- «Recalcular precio por peso» del Kanban), Registro, la alerta de Cuarto Frío
-- y la herramienta consultar_tarifas del agente (vista v_precios_por_peso).
--
-- NO recalcula servicios existentes: el precio de un servicio solo se mueve
-- cuando alguien cambia el peso o pulsa «Recalcular». La consulta del final
-- lista los servicios activos que quedan en otra banda.
--
-- Idempotente: cada UPDATE solo toca filas que siguen con los límites viejos.
-- Deshacer: los mismos UPDATE con los números al revés.
--
-- ⚠️ ORDEN: esta migración ANTES del frontend. Si el frontend sale primero, una
--    fila nueva creada en Configuración se solapa con las viejas y el portal
--    de la vet cotiza 11,0 kg con una banda distinta a la que cobra el Kanban.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.planes_precios SET peso_max_gr = 11000
 WHERE rango_nombre = '1-10KG'  AND peso_min_gr = 1000  AND peso_max_gr = 10999;
UPDATE public.planes_precios SET peso_min_gr = 11001, peso_max_gr = 21000
 WHERE rango_nombre = '11-20KG' AND peso_min_gr = 11000 AND peso_max_gr = 20999;
UPDATE public.planes_precios SET peso_min_gr = 21001, peso_max_gr = 36000
 WHERE rango_nombre = '21-35KG' AND peso_min_gr = 21000 AND peso_max_gr = 35999;
UPDATE public.planes_precios SET peso_min_gr = 36001, peso_max_gr = 61000
 WHERE rango_nombre = '36-60KG' AND peso_min_gr = 36000 AND peso_max_gr = 60999;

-- Guarda: ninguna banda por peso puede quedar con límites distintos a los
-- nuevos (si alguien las editó a mano, mejor abortar que dejar huecos o
-- solapes: un peso sin banda no tiene precio, uno con dos tiene uno al azar).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.planes_precios
   WHERE (rango_nombre = '1-10KG'  AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (1000, 11000))
      OR (rango_nombre = '11-20KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (11001, 21000))
      OR (rango_nombre = '21-35KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (21001, 36000))
      OR (rango_nombre = '36-60KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (36001, 61000));
  IF n > 0 THEN
    RAISE EXCEPTION '226: % filas de planes_precios con límites inesperados; revisar a mano', n;
  END IF;
END $$;

COMMIT;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
SELECT rango_nombre, peso_min_gr, peso_max_gr, count(*) AS planes
  FROM public.planes_precios
 GROUP BY 1, 2, 3
 ORDER BY peso_min_gr NULLS FIRST, rango_nombre;

-- Servicios activos cuyo peso cambió de banda (11,0 · 21,0 · 36,0 · 61,0 kg
-- exactos), sin tarifa felino. Candidatos a «Recalcular precio por peso».
SELECT s.id, s.fecha_ingreso, m.nombre AS mascota, m.peso_kg, p.codigo AS plan,
       s.valor_plan, s.valor_total, s.estado
  FROM public.servicios s
  JOIN public.mascotas m ON m.id_mascota = s.mascota_id
  JOIN public.planes   p ON p.id = s.plan_id
  LEFT JOIN public.especies e ON e.id = m.especie_id
 WHERE s.estado NOT IN ('ENTREGADO', 'CANCELADO')
   AND COALESCE(e.tarifa_peso, 'ESTANDAR') <> 'FELINO'
   AND round(m.peso_kg * 1000) IN (11000, 21000, 36000, 61000)
 ORDER BY m.peso_kg;
