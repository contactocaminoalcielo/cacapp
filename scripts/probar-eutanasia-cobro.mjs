// Genera una prueba SQL aislada de la migración 159 (quién cobró la eutanasia).
// Usa SOLO tablas temporales y termina en ROLLBACK: no toca un servicio real.
//
//   node scripts/probar-eutanasia-cobro.mjs | ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 \
//     'cd /opt/supabase/docker && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --pset pager=off'
//
// Los casos están calcados de producción (16-sep-2026):
//   KIRA            → el doctor cobró: $399.000 con eutanasia de $230.000
//   KIRA CRISTANCHO → el total NO incluye la eutanasia: no se puede restar
//   LUNA            → la cobró el técnico con el plan
import { readFileSync } from 'node:fs'

const crudo = readFileSync(new URL('../migrations/159_eutanasia_quien_la_cobra.sql', import.meta.url), 'utf8')

// Fuera la vista de agenda: arrastra clientes, mascotas y personal, y no es lo
// que se está probando (la prueba es de la plata, no del listado).
const sinVista = crudo.split('-- ── 5. La vista')[0]
  + '-- ── 6. El recibo' + crudo.split('-- ── 6. El recibo')[1]

const migracion = sinVista
  .replace(/^BEGIN;|^COMMIT;/gm, '')
  .replace(/^SET LOCAL lock_timeout.*$/gm, '')
  .replace(/^(REVOKE|GRANT) .*$/gm, '')   // roles reales, no aplican a pg_temp
  .replaceAll('public.', 'pg_temp.')

const ID = n => `'00000000-0000-0000-0000-00000000000${n}'::uuid`

console.log(`
BEGIN;
CREATE TEMP TABLE servicios (
  id uuid PRIMARY KEY, valor_total numeric, valor_pagado numeric DEFAULT 0,
  estado_pago text DEFAULT 'PENDIENTE', eutanasia_id uuid,
  valor_plan numeric, valor_adicionales numeric DEFAULT 0, valor_transporte numeric DEFAULT 0,
  recargo_nocturno numeric DEFAULT 0, descuento_adicional numeric DEFAULT 0,
  comision_aliado numeric DEFAULT 0, comision_descontada boolean DEFAULT false
);
CREATE TEMP TABLE eutanasias (
  id uuid PRIMARY KEY, servicio_id uuid, veterinario_id uuid,
  valor numeric, valor_pagado numeric DEFAULT 0, estado_pago text DEFAULT 'PENDIENTE',
  metodo_pago text, cobro_conjunto boolean DEFAULT true
);
CREATE TEMP TABLE veterinarios (id uuid PRIMARY KEY, nombre text);
CREATE TEMP TABLE novedades_servicio (
  id serial PRIMARY KEY, servicio_id uuid, tipo_novedad text, descripcion text,
  valor_ajuste numeric, registrado_por uuid
);
CREATE TEMP TABLE recibos_tecnico (id uuid PRIMARY KEY, valor_total numeric);

${migracion}

INSERT INTO veterinarios VALUES (${ID(9)}, 'Dr. Prueba');

-- KIRA: plan 169.000 + eutanasia 230.000 = 399.000, con 169.000 ya pagados.
INSERT INTO servicios (id, valor_total, valor_pagado, estado_pago, eutanasia_id, valor_plan)
VALUES (${ID(1)}, 399000, 169000, 'PARCIAL', ${ID(1)}, 169000);
-- KIRA CRISTANCHO: el total (169.000) NO incluye su eutanasia (200.000).
INSERT INTO servicios (id, valor_total, valor_pagado, estado_pago, eutanasia_id, valor_plan)
VALUES (${ID(2)}, 169000, 339000, 'COMPLETO', ${ID(2)}, 169000);
-- LUNA: la cobra el técnico, servicio pagado completo.
INSERT INTO servicios (id, valor_total, valor_pagado, estado_pago, eutanasia_id, valor_plan)
VALUES (${ID(3)}, 999000, 999000, 'COMPLETO', ${ID(3)}, 819000);

INSERT INTO eutanasias (id, servicio_id, veterinario_id, valor) VALUES
  (${ID(1)}, ${ID(1)}, ${ID(9)}, 230000),
  (${ID(2)}, ${ID(2)}, ${ID(9)}, 200000),
  (${ID(3)}, ${ID(3)}, ${ID(9)}, 180000);

-- El backfill del archivo ya corrió arriba, con las tablas vacías; se repite la
-- MISMA sentencia ahora que hay datos para poder verificar qué marca y qué no.
UPDATE servicios s SET valor_eutanasia = e.valor
  FROM eutanasias e
 WHERE e.id = s.eutanasia_id AND s.valor_eutanasia = 0 AND COALESCE(e.valor,0) > 0
   AND s.valor_plan IS NOT NULL
   AND abs((COALESCE(s.valor_total,0) + CASE WHEN s.comision_descontada THEN COALESCE(s.comision_aliado,0) ELSE 0 END)
       - (COALESCE(s.valor_plan,0) + COALESCE(s.valor_adicionales,0) + COALESCE(s.valor_transporte,0)
          + COALESCE(s.recargo_nocturno,0) - COALESCE(s.descuento_adicional,0) + e.valor)) <= 1;

DO $prueba$ BEGIN
  -- 1. El backfill marca lo que cuadra y NO inventa lo que no cuadra.
  IF (SELECT valor_eutanasia FROM servicios WHERE id=${ID(1)}) <> 230000
    THEN RAISE EXCEPTION 'El backfill no marcó el servicio que sí cuadra'; END IF;
  IF (SELECT valor_eutanasia FROM servicios WHERE id=${ID(2)}) <> 0
    THEN RAISE EXCEPTION 'El backfill marcó un servicio cuyo total NO incluye la eutanasia'; END IF;
  IF (SELECT valor_eutanasia FROM servicios WHERE id=${ID(3)}) <> 180000
    THEN RAISE EXCEPTION 'El backfill no marcó LUNA'; END IF;
END $prueba$;

-- 2. El doctor cobró: sale del servicio y la cartera queda en cero.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'VETERINARIO', NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(1)}) <> 169000
    THEN RAISE EXCEPTION 'No se restó la eutanasia del valor del servicio'; END IF;
  IF (SELECT estado_pago FROM servicios WHERE id=${ID(1)}) <> 'COMPLETO'
    THEN RAISE EXCEPTION 'El servicio debía quedar COMPLETO: ya no le falta plata'; END IF;
  IF (SELECT valor_eutanasia FROM servicios WHERE id=${ID(1)}) <> 0
    THEN RAISE EXCEPTION 'La eutanasia sigue contada dentro del servicio'; END IF;
  IF (SELECT cobrada_por FROM eutanasias WHERE id=${ID(1)}) <> 'VETERINARIO'
    THEN RAISE EXCEPTION 'No quedó registrado quién la cobró'; END IF;
  IF (SELECT estado_pago FROM eutanasias WHERE id=${ID(1)}) <> 'COMPLETO'
    THEN RAISE EXCEPTION 'La eutanasia sigue figurando sin pagar'; END IF;
  IF (SELECT descontada_del_servicio FROM eutanasias WHERE id=${ID(1)}) <> 230000
    THEN RAISE EXCEPTION 'No quedó guardado cuánto se restó'; END IF;
  IF (SELECT count(*) FROM novedades_servicio WHERE servicio_id=${ID(1)} AND valor_ajuste = -230000) <> 1
    THEN RAISE EXCEPTION 'Falta la nota en la bitácora del servicio'; END IF;
END $prueba$;

-- 3. Idempotencia: repetirlo NO vuelve a restar (doble toque, recibo reabierto).
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'VETERINARIO', NULL);
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'VETERINARIO', NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(1)}) <> 169000
    THEN RAISE EXCEPTION 'Se restó la eutanasia más de una vez'; END IF;
  IF (SELECT count(*) FROM novedades_servicio WHERE servicio_id=${ID(1)}) <> 1
    THEN RAISE EXCEPTION 'Se duplicó la nota en la bitácora'; END IF;
END $prueba$;

-- 4. Deshacer: la plata vuelve exactamente al servicio.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, NULL, NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(1)}) <> 399000
    THEN RAISE EXCEPTION 'Al deshacer no volvió el valor original'; END IF;
  IF (SELECT valor_eutanasia FROM servicios WHERE id=${ID(1)}) <> 230000
    THEN RAISE EXCEPTION 'Al deshacer la eutanasia no volvió a contarse en el servicio'; END IF;
  IF (SELECT estado_pago FROM servicios WHERE id=${ID(1)}) <> 'PARCIAL'
    THEN RAISE EXCEPTION 'Al deshacer el servicio debía volver a PARCIAL'; END IF;
  IF (SELECT cobrada_por FROM eutanasias WHERE id=${ID(1)}) IS NOT NULL
    THEN RAISE EXCEPTION 'Al deshacer quedó marcada igual'; END IF;
END $prueba$;

-- 5. Cambiar de opinión (doctor → técnico) devuelve la plata antes de marcar.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'VETERINARIO', NULL);
SELECT pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'TECNICO', NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(1)}) <> 399000
    THEN RAISE EXCEPTION 'Al pasar de doctor a técnico no volvió el valor al servicio'; END IF;
  IF (SELECT cobrada_por FROM eutanasias WHERE id=${ID(1)}) <> 'TECNICO'
    THEN RAISE EXCEPTION 'No quedó marcada como cobrada por el técnico'; END IF;
  IF (SELECT descontada_del_servicio FROM eutanasias WHERE id=${ID(1)}) <> 0
    THEN RAISE EXCEPTION 'Quedó un descuento fantasma anotado'; END IF;
END $prueba$;

-- 6. El servicio cuyo total NO incluye la eutanasia no se puede tocar.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(2)}, 'VETERINARIO', NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(2)}) <> 169000
    THEN RAISE EXCEPTION 'Se le restó plata a un servicio que no llevaba la eutanasia dentro'; END IF;
  IF (SELECT descontada_del_servicio FROM eutanasias WHERE id=${ID(2)}) <> 0
    THEN RAISE EXCEPTION 'Anotó un descuento que nunca ocurrió'; END IF;
END $prueba$;
-- …y deshacerlo tampoco puede regalarle plata.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(2)}, NULL, NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(2)}) <> 169000
    THEN RAISE EXCEPTION 'Al deshacer le inventó plata a un servicio que nunca se tocó'; END IF;
END $prueba$;

-- 7. La cobra el técnico: el servicio no se mueve y la eutanasia queda saldada.
SELECT pg_temp.registrar_cobro_eutanasia(${ID(3)}, 'TECNICO', NULL);
DO $prueba$ BEGIN
  IF (SELECT valor_total FROM servicios WHERE id=${ID(3)}) <> 999000
    THEN RAISE EXCEPTION 'Cobrándola el técnico, el valor del servicio NO puede cambiar'; END IF;
  IF (SELECT estado_pago FROM eutanasias WHERE id=${ID(3)}) <> 'COMPLETO'
    THEN RAISE EXCEPTION 'El servicio está pagado completo: la eutanasia no puede seguir PENDIENTE'; END IF;
  IF (SELECT valor_pagado FROM eutanasias WHERE id=${ID(3)}) <> 180000
    THEN RAISE EXCEPTION 'No quedó registrado el pago de la eutanasia'; END IF;
  IF (SELECT count(*) FROM novedades_servicio WHERE servicio_id=${ID(3)}) <> 0
    THEN RAISE EXCEPTION 'No debe ensuciar la bitácora cuando no hay plata que mover'; END IF;
END $prueba$;

-- 8. Entradas imposibles: se rechazan con un error entendible.
DO $prueba$ BEGIN
  BEGIN
    PERFORM pg_temp.registrar_cobro_eutanasia('00000000-0000-0000-0000-0000000000ff'::uuid, 'TECNICO', NULL);
    RAISE EXCEPTION 'Aceptó una eutanasia inexistente';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE 'EUTANASIA_NO_EXISTE%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.registrar_cobro_eutanasia(${ID(1)}, 'CUALQUIERA', NULL);
    RAISE EXCEPTION 'Aceptó un valor inválido en cobrada_por';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE 'COBRADA_POR_INVALIDA%' THEN RAISE; END IF;
  END;
END $prueba$;

SELECT '✅ Migración 159: las 8 pruebas pasaron' AS resultado;
ROLLBACK;
`)
