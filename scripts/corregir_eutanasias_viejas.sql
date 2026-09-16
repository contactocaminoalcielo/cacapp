-- Corrección de los servicios viejos con eutanasia cobrada por el doctor.
-- Fecha: 2026-09-16 · pedido de David · complemento de la migración 159.
--
-- Correr por SSH:
--   cat scripts/corregir_eutanasias_viejas.sql | ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 \
--     'cd /opt/supabase/docker && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --pset pager=off'
--
-- QUÉ ARREGLA. Solo los dos casos donde el saldo que Orbit persigue es
-- EXACTAMENTE la eutanasia y no hay nada más de por medio: el doctor la cobró,
-- el técnico cobró el resto, y la familia quedó debiendo una plata que ya pagó.
--
--   KIRA  (12-sep) — vale $399.000, pagó $169.000, eutanasia $230.000 → saldo 0
--   BLACK (22-ago) — vale $279.000, pagó  $99.000, eutanasia $180.000 → saldo 0
--
-- Va por la misma RPC que usa el técnico en la app: deja la nota en la bitácora,
-- recalcula el estado de pago y no puede restar dos veces si esto se corre otra
-- vez por error.
--
-- ⛔ QUÉ **NO** ARREGLA, Y POR QUÉ (los otros cuatro NO son el mismo caso):
--
--   NICKY (17-ago) — el 18-ago le recategorizaron el precio por peso:
--       $339.000 → $309.000, un día DESPUÉS de que el técnico cobrara $139.000.
--       Restarle la eutanasia lo deja pagado de más en $30.000. Eso no es un
--       error de la eutanasia: es plata cobrada de más a esa familia. Está
--       abajo, comentado, para que decidas (ver bloque NICKY).
--
--   PANCHA (23-jul) y LILU (22-jul) — el técnico recogió $140.000 y $139.000,
--       pero el servicio figura pagado COMPLETO: hay $229.000 y $200.000
--       marcados como pagados **sin una sola novedad de cobro** que los
--       respalde. Eso no es esta corrección, es la marca de `estado_pago`
--       puesta a mano. Si le resto la eutanasia encima, quedan con $200.000
--       pagados de más y el número se vuelve más falso, no menos.
--       → Primero hay que averiguar si esa plata entró de verdad.
--
--   MANCHAS (21-ago) — el técnico SÍ recogió $180.000 (DAVIPLATA, con
--       comprobante), que es justo el valor de la eutanasia, y dejó el plan
--       ($169.000) sin cobrar. No se puede saber si ese pago era de la
--       eutanasia o un abono al plan. Con esa duda no se toca plata.
--
-- La consulta del final te deja ver los cuatro que quedan pendientes.

\echo '=== ANTES ==='
SELECT m.nombre AS mascota, s.valor_total AS vale, s.valor_pagado AS pagado,
       s.valor_total - s.valor_pagado AS saldo, s.estado_pago,
       s.valor_eutanasia AS eutanasia, e.cobrada_por
  FROM servicios s
  JOIN eutanasias e ON e.id = s.eutanasia_id
  LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
 WHERE s.id IN ('01144a1e-30e5-435a-b186-8058083e8239',
                '74597554-e476-4d05-b2d0-64433af15d8d')
 ORDER BY m.nombre;

BEGIN;

-- Candado: si alguno de los dos ya no está como lo medimos el 16-sep (porque
-- alguien lo tocó entre medias), NO se corrige nada y la transacción se cae
-- entera. Es preferible no hacer nada que corregir sobre un número que cambió.
DO $guardia$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT s.id, s.valor_total, s.valor_pagado, s.valor_eutanasia,
           e.cobrada_por, m.nombre AS mascota,
           x.total_esperado, x.pagado_esperado, x.eutanasia_esperada
      FROM (VALUES
            ('01144a1e-30e5-435a-b186-8058083e8239'::uuid, 399000::numeric, 169000::numeric, 230000::numeric),
            ('74597554-e476-4d05-b2d0-64433af15d8d'::uuid, 279000::numeric,  99000::numeric, 180000::numeric)
           ) AS x(id, total_esperado, pagado_esperado, eutanasia_esperada)
      JOIN servicios s ON s.id = x.id
      JOIN eutanasias e ON e.id = s.eutanasia_id
      LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
  LOOP
    IF v.cobrada_por IS NOT NULL THEN
      RAISE EXCEPTION 'YA_CORREGIDO: % ya está marcada como cobrada por %. No se toca nada.',
        v.mascota, v.cobrada_por;
    END IF;
    IF v.valor_total <> v.total_esperado
       OR v.valor_pagado <> v.pagado_esperado
       OR v.valor_eutanasia <> v.eutanasia_esperada THEN
      RAISE EXCEPTION 'CAMBIO_DESDE_EL_DIAGNOSTICO: % ya no está como se midió (vale %, pagado %, eutanasia %). Revísalo a mano antes de correr esto.',
        v.mascota, v.valor_total, v.valor_pagado, v.valor_eutanasia;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM servicios
       WHERE id IN ('01144a1e-30e5-435a-b186-8058083e8239',
                    '74597554-e476-4d05-b2d0-64433af15d8d')) <> 2 THEN
    RAISE EXCEPTION 'FALTA_ALGUNO: no aparecen los dos servicios esperados.';
  END IF;
END $guardia$;

-- KIRA y BLACK: la cobró el doctor. Sale del valor del servicio, la cartera
-- deja de perseguirla y queda la nota en la bitácora de cada servicio.
SELECT m.nombre AS mascota,
       registrar_cobro_eutanasia(s.eutanasia_id, 'VETERINARIO', NULL) AS resultado
  FROM servicios s
  LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
 WHERE s.id IN ('01144a1e-30e5-435a-b186-8058083e8239',
                '74597554-e476-4d05-b2d0-64433af15d8d')
 ORDER BY m.nombre;

COMMIT;

\echo '=== DESPUES (saldo debe quedar en 0 y estado COMPLETO) ==='
SELECT m.nombre AS mascota, s.valor_total AS vale, s.valor_pagado AS pagado,
       s.valor_total - s.valor_pagado AS saldo, s.estado_pago,
       e.cobrada_por, e.estado_pago AS eut_pago, e.descontada_del_servicio AS se_resto
  FROM servicios s
  JOIN eutanasias e ON e.id = s.eutanasia_id
  LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
 WHERE s.id IN ('01144a1e-30e5-435a-b186-8058083e8239',
                '74597554-e476-4d05-b2d0-64433af15d8d')
 ORDER BY m.nombre;

\echo '=== LOS CUATRO QUE QUEDAN PENDIENTES DE TU DECISION ==='
SELECT m.nombre AS mascota, s.fecha_ingreso, s.valor_total AS vale,
       s.valor_pagado AS pagado, s.estado_pago, s.valor_eutanasia AS eutanasia,
       COALESCE((SELECT sum(rt.pago_aplicado) FROM recibos_tecnico rt
                  WHERE rt.servicio_id = s.id), 0) AS cobro_del_tecnico,
       s.valor_pagado - COALESCE((SELECT sum(rt.pago_aplicado) FROM recibos_tecnico rt
                                   WHERE rt.servicio_id = s.id), 0) AS marcado_sin_recibo
  FROM servicios s
  LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
 WHERE s.id IN ('ff34d916-d9bc-46ff-9d6a-52154f01782e',   -- NICKY
                '20ce3c81-fba3-49b2-b3db-8b328a2b7901',   -- PANCHA
                '9a96e628-b7a6-4008-9db3-7be0e5d81cfc',   -- LILU
                'ad9518db-baf3-4313-a8c3-bb01e6a404a9')   -- MANCHAS
 ORDER BY s.fecha_ingreso DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE NICKY — descomentar SOLO si aceptas que quede pagada de más $30.000.
--
-- Qué pasa si lo corres: el servicio baja de $309.000 a $109.000 y, con los
-- $139.000 que ya pagó, queda con $30.000 A FAVOR DE LA FAMILIA. Ese sobrepago
-- NO lo causa la eutanasia: viene de la recategorización por peso del 18-ago,
-- que le bajó el precio un día después de que el técnico cobrara. Es la verdad
-- de esa cuenta, y hoy está escondida detrás de un saldo de $170.000 que dice
-- que la familia debe — cuando en realidad se le cobró de más.
--
-- BEGIN;
-- SELECT registrar_cobro_eutanasia(s.eutanasia_id, 'VETERINARIO', NULL)
--   FROM servicios s WHERE s.id = 'ff34d916-d9bc-46ff-9d6a-52154f01782e';
-- INSERT INTO novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
-- VALUES ('ff34d916-d9bc-46ff-9d6a-52154f01782e', 'NOTA',
--   'Al sacar la eutanasia (la cobró el veterinario) queda un sobrepago de $ 30.000 a favor de la familia: '
--   || 'el precio se recategorizó por peso de $ 339.000 a $ 309.000 el 18-ago, un día DESPUES de que el '
--   || 'técnico cobrara $ 139.000. Pendiente de decidir si se devuelve o se abona.', 30000, NULL);
-- COMMIT;
