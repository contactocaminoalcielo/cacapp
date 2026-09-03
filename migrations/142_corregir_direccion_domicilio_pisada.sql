-- 142 — Devolver la dirección del domicilio a los servicios donde la conversión
-- pegó la de la veterinaria.
-- Fecha: 2026-09-03 · autorizado por David
--
-- El bug (corregido en el commit 75cdd18, `Kanban.jsx`): al convertir una
-- solicitud de aliado marcada "en domicilio del propietario", el precargado del
-- modal hacía `aliado?.direccion || s.direccion` sin mirar el tipo de recogida,
-- así que la dirección —y la ciudad y el barrio— de la CLÍNICA ganaban siempre.
-- `punto_recogida` sí quedaba DOMICILIO, por eso la pantalla no delataba nada.
--
-- El dato bueno nunca se perdió: sigue en `solicitudes_servicio`, que se guardó
-- correcta desde el portal. Esto solo lo copia de vuelta.
--
-- REGLA CONSERVADORA: nunca se BORRA nada. Un campo solo se pisa si la
-- solicitud trae un valor no vacío para él; si la solicitud lo tiene vacío, se
-- deja lo que hay. Caso Cony: no escribió barrio, y el "SAN MATEO" que quedó de
-- la vet resulta ser correcto (su dirección dice San Mateo) — vaciarlo sería
-- perder información buena.
--
-- ⚠️ NO se toca NADA de dinero. Bicho y Cony se recogían en SOACHA y quedaron
--    como Bogotá, ambos con `valor_transporte = 0`. Si Soacha debía cobrar
--    transporte, eso es una decisión de David servicio por servicio, no un
--    arreglo automático: ver [[bug_transporte_ciudad_sin_tarifa]].
--
-- Los 6 afectados: Salem (LISTO), Bicho (EN_CUARTO_FRIO), Aaron (CANCELADO),
-- Cony (CANCELADO), Missy (EN_PRODUCCION), michi (CANCELADO).

BEGIN;

-- Los afectados se identifican por la FIRMA del bug, no por id a mano: recogida
-- a domicilio, con aliado que tiene dirección, y la dirección del servicio es
-- exactamente la de esa vet.
CREATE TEMP TABLE _afectados ON COMMIT DROP AS
SELECT s.id AS servicio_id,
       m.nombre                                   AS mascota,
       s.direccion_recogida                       AS dir_antes,
       s.ciudad_recogida                          AS ciu_antes,
       s.barrio_recogida                          AS bar_antes,
       NULLIF(TRIM(ss.direccion), '')             AS dir_nueva,
       COALESCE(NULLIF(TRIM(ss.ciudad), ''),
                NULLIF(TRIM(ss.cliente_ciudad), '')) AS ciu_nueva,
       COALESCE(NULLIF(TRIM(ss.barrio), ''),
                NULLIF(TRIM(ss.localidad), ''),
                NULLIF(TRIM(ss.cliente_barrio), '')) AS bar_nueva
  FROM public.solicitudes_servicio ss
  JOIN public.servicios s ON s.id = ss.servicio_id
  JOIN public.aliados   a ON a.id_aliado = ss.aliado_id
  LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
 WHERE ss.tipo_recogida = 'domicilio'
   AND COALESCE(a.direccion, '') <> ''
   AND upper(trim(COALESCE(s.direccion_recogida, ''))) = upper(trim(a.direccion));

-- Cerrojo: si el conteo no es el que se revisó a mano, algo cambió desde el
-- diagnóstico y esta migración no debe correr a ciegas.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM _afectados;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'ESPERABA_6_AFECTADOS: encontré %. Revisar antes de aplicar.', v_n;
  END IF;
END $$;

UPDATE public.servicios s
   SET direccion_recogida = COALESCE(af.dir_nueva, s.direccion_recogida),
       ciudad_recogida    = COALESCE(af.ciu_nueva, s.ciudad_recogida),
       barrio_recogida    = COALESCE(af.bar_nueva, s.barrio_recogida),
       updated_at         = now()
  FROM _afectados af
 WHERE s.id = af.servicio_id;

-- Rastro en cada servicio, con el antes y el después.
INSERT INTO public.novedades_servicio
  (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
SELECT af.servicio_id, 'NOTA',
       'Corrección de datos (migración 142): la conversión había pegado la dirección de la veterinaria '
       || 'sobre el domicilio del propietario. Se restauró lo que la vet escribió en la solicitud. '
       || 'Dirección: «' || COALESCE(af.dir_antes, '—') || '» → «' || COALESCE(af.dir_nueva, af.dir_antes, '—') || '»'
       || CASE WHEN af.ciu_nueva IS NOT NULL AND af.ciu_nueva IS DISTINCT FROM af.ciu_antes
               THEN ' · Ciudad: «' || COALESCE(af.ciu_antes,'—') || '» → «' || af.ciu_nueva || '»' ELSE '' END
       || CASE WHEN af.bar_nueva IS NOT NULL AND af.bar_nueva IS DISTINCT FROM af.bar_antes
               THEN ' · Barrio: «' || COALESCE(af.bar_antes,'—') || '» → «' || af.bar_nueva || '»' ELSE '' END
       || '. No se tocó ningún valor de dinero.',
       0, NULL
  FROM _afectados af;

COMMIT;
