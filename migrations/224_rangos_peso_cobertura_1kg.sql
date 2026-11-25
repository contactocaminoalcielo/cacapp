-- ─────────────────────────────────────────────────────────────────────────────
-- 224 · Cada banda de peso cubre 1 kg por encima de su nombre
-- REPORTE ORBIT 2026-11-25 (mejora, urgencia alta, «Recalcular peso»):
--   «el de 1-10 kg tenga una cobertura hasta los 11 kg y de la misma manera con
--    los demás rangos».
--
-- Se lee con la regla de decimales del 12-jun-2026 (un peso pertenece a su banda
-- hasta ALCANZAR el mínimo de la siguiente). Antes 10,4 kg ya era 1-10 y desde
-- 11,0 kg era 11-20. Ahora un perro de 11 kg (11,0 a 11,999) sigue en 1-10.
--
--   banda      antes (g)        ahora (g)
--   1-10KG     1000 – 10999     1000 – 11999
--   11-20KG   11000 – 20999    12000 – 21999
--   21-35KG   21000 – 35999    22000 – 36999
--   36-60KG   36000 – 60999    37000 – 61999
--
-- PETIT (< 1 kg) y FELINO (plana desde 1 kg) no cambian.
--
-- ⚠️ Si «hasta los 11 kg» quería decir «hasta 11,000 kg exactos» (y 11,2 ya
--    pasa a 11-20), los techos son 11000/21000/36000/61000 y los mínimos
--    11001/21001/36001/37001: cambiar los números de abajo y los de
--    src/lib/rangosPeso.js (espejo usado por los portales y Configuración).
--
-- Quién lee estos límites: calcularPrecioPara (Gestión, báscula del técnico,
-- «Recalcular precio por peso» del Kanban), Registro, la alerta de Cuarto Frío
-- y la herramienta consultar_tarifas del agente (vista v_precios_por_peso).
--
-- NO recalcula servicios existentes: el precio de un servicio solo se mueve
-- cuando alguien cambia el peso o pulsa «Recalcular». La consulta del final
-- lista los servicios activos que hoy quedarían en una banda más barata.
--
-- Idempotente: cada UPDATE solo toca filas que siguen con los límites viejos.
-- Ensayo (este archivo trae COMMIT): ver ops_aplicar_migraciones_vps.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.planes_precios SET peso_max_gr = 11999
 WHERE rango_nombre = '1-10KG'  AND peso_min_gr = 1000  AND peso_max_gr = 10999;
UPDATE public.planes_precios SET peso_min_gr = 12000, peso_max_gr = 21999
 WHERE rango_nombre = '11-20KG' AND peso_min_gr = 11000 AND peso_max_gr = 20999;
UPDATE public.planes_precios SET peso_min_gr = 22000, peso_max_gr = 36999
 WHERE rango_nombre = '21-35KG' AND peso_min_gr = 21000 AND peso_max_gr = 35999;
UPDATE public.planes_precios SET peso_min_gr = 37000, peso_max_gr = 61999
 WHERE rango_nombre = '36-60KG' AND peso_min_gr = 36000 AND peso_max_gr = 60999;

-- Guarda: ninguna banda por peso puede quedar con límites distintos a los
-- nuevos (si alguien las editó a mano, mejor abortar que dejar huecos o
-- solapes: un peso sin banda no tiene precio, uno con dos tiene uno al azar).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.planes_precios
   WHERE (rango_nombre = '1-10KG'  AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (1000, 11999))
      OR (rango_nombre = '11-20KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (12000, 21999))
      OR (rango_nombre = '21-35KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (22000, 36999))
      OR (rango_nombre = '36-60KG' AND (peso_min_gr, peso_max_gr) IS DISTINCT FROM (37000, 61999));
  IF n > 0 THEN
    RAISE EXCEPTION '224: % filas de planes_precios con límites inesperados; revisar a mano', n;
  END IF;
END $$;

COMMIT;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
SELECT rango_nombre, peso_min_gr, peso_max_gr, count(*) AS planes
  FROM public.planes_precios
 GROUP BY 1, 2, 3
 ORDER BY peso_min_gr NULLS FIRST, rango_nombre;

-- Servicios activos cuyo peso quedó en la franja que cambió de banda
-- (11,0–11,999 · 21,0–21,999 · 36,0–36,999 · 61,0–61,999 kg), sin tarifa
-- felino. Son los candidatos a «Recalcular precio por peso» en el Kanban.
SELECT s.id, s.fecha_ingreso, m.nombre AS mascota, m.peso_kg, p.codigo AS plan,
       s.valor_plan, s.valor_total, s.estado
  FROM public.servicios s
  JOIN public.mascotas m ON m.id_mascota = s.mascota_id
  JOIN public.planes   p ON p.id = s.plan_id
  LEFT JOIN public.especies e ON e.id = m.especie_id
 WHERE s.estado NOT IN ('ENTREGADO', 'CANCELADO')
   AND COALESCE(e.tarifa_peso, 'ESTANDAR') <> 'FELINO'
   AND floor(m.peso_kg) IN (11, 21, 36, 61)
 ORDER BY m.peso_kg;
