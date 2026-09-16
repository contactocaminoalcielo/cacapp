// SQL aislado para psql -v ON_ERROR_STOP=1: solo tablas temporales, ROLLBACK.
import { readFileSync } from 'node:fs'
const migration = readFileSync(new URL('../migrations/160_cierre_sin_ruta_planes_comprobante.sql', import.meta.url), 'utf8')
  .replace(/^BEGIN;|^COMMIT;/gm, '').replaceAll('public.', 'pg_temp.')
console.log(`
BEGIN;
CREATE TEMP TABLE planes (id integer PRIMARY KEY, codigo text);
CREATE TEMP TABLE servicios (id uuid PRIMARY KEY, plan_id integer, estado text, fecha_entrega_real date);
CREATE TEMP TABLE servicio_recordatorios (id integer PRIMARY KEY, servicio_id uuid, origen text, estado text);
CREATE TEMP TABLE digitales_envios (servicio_id uuid, estado text);
CREATE TEMP TABLE reportes_grupales_envios (servicio_id uuid, estado text);
CREATE TEMP TABLE entregas (servicio_id uuid, estado text, mensajero_id uuid, notas text);
${migration}
GRANT ALL ON planes,servicios,servicio_recordatorios,digitales_envios,reportes_grupales_envios,entregas TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO planes VALUES (1,'ECO_GRUPAL'),(2,'OTRO'),(3,'DESAMPARADO'),(4,'ANGEL'),(5,'BASICO_SIN_REC');
INSERT INTO servicios
 SELECT lpad(n::text,32,'0')::uuid,CASE WHEN n=6 THEN 2 ELSE 1 END,
 CASE WHEN n=10 THEN 'CANCELADO' ELSE 'EN_PRODUCCION' END,NULL FROM generate_series(1,10) n;
-- Planes de solo comprobante: no llevan pieza digital y no deben esperarla.
INSERT INTO servicios VALUES
 (lpad('11',32,'0')::uuid,3,'EN_PRODUCCION',NULL),
 (lpad('12',32,'0')::uuid,4,'EN_PRODUCCION',NULL),
 (lpad('13',32,'0')::uuid,5,'EN_PRODUCCION',NULL);
INSERT INTO entregas VALUES (lpad('1',32,'0')::uuid,'DISPONIBLE',NULL,'Nota previa');
INSERT INTO servicio_recordatorios
 SELECT n,lpad(n::text,32,'0')::uuid,'PLAN',CASE WHEN n=9 THEN 'NA' ELSE 'ENTREGADO' END FROM generate_series(1,10) n;
INSERT INTO servicio_recordatorios VALUES
 (11,lpad('7',32,'0')::uuid,'ADICIONAL','LISTO'),
 (12,lpad('8',32,'0')::uuid,'PLAN','PENDIENTE'),
 (13,lpad('1',32,'0')::uuid,'REMOVIDO','PENDIENTE'),
 (21,lpad('11',32,'0')::uuid,'PLAN','ENTREGADO'),
 (22,lpad('12',32,'0')::uuid,'PLAN','ENTREGADO'),
 (23,lpad('13',32,'0')::uuid,'PLAN','PENDIENTE');
INSERT INTO digitales_envios SELECT lpad(n::text,32,'0')::uuid,
 CASE WHEN n=5 THEN 'ERROR' ELSE 'ENVIADO' END FROM generate_series(1,10) n WHERE n NOT IN (2,4);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM servicios WHERE estado='ENTREGADO') THEN RAISE EXCEPTION 'Cerró sin certificado'; END IF;
END $$;
INSERT INTO reportes_grupales_envios SELECT lpad(n::text,32,'0')::uuid,
 CASE WHEN n=5 THEN 'ERROR' ELSE 'ENVIADO' END FROM generate_series(1,10) n WHERE n<>3;
INSERT INTO reportes_grupales_envios VALUES
 (lpad('11',32,'0')::uuid,'ENVIADO'),(lpad('13',32,'0')::uuid,'ENVIADO');
INSERT INTO digitales_envios VALUES (lpad('2',32,'0')::uuid,'ENVIADO');
DO $$ BEGIN
 IF (SELECT count(*) FROM servicios WHERE estado='ENTREGADO')<>3 THEN RAISE EXCEPTION 'Cierre incorrecto'; END IF;
 IF EXISTS (SELECT 1 FROM servicios WHERE estado='ENTREGADO' AND id NOT IN
   (lpad('1',32,'0')::uuid,lpad('2',32,'0')::uuid,lpad('11',32,'0')::uuid)) THEN RAISE EXCEPTION 'Cerró un servicio incompleto'; END IF;
 IF EXISTS (SELECT 1 FROM servicios WHERE estado='ENTREGADO' AND fecha_entrega_real IS DISTINCT FROM (now() AT TIME ZONE 'America/Bogota')::date) THEN RAISE EXCEPTION 'Fecha incorrecta'; END IF;
 IF NOT EXISTS (SELECT 1 FROM entregas WHERE estado='ENTREGADA' AND notas LIKE 'Nota previa%sin ruta física.') THEN RAISE EXCEPTION 'No cerró la fila de entrega o perdió notas'; END IF;
END $$;
-- Completar el último ítem también dispara el cierre, aunque envíos sean previos.
UPDATE servicio_recordatorios SET estado='ENTREGADO' WHERE id IN (11,12,23);
DO $$ BEGIN
 IF (SELECT count(*) FROM servicios WHERE estado='ENTREGADO')<>6 THEN RAISE EXCEPTION 'No cerró al completar el último ítem'; END IF;
 IF (SELECT estado FROM servicios WHERE id=lpad('12',32,'0')::uuid)='ENTREGADO' THEN RAISE EXCEPTION 'Cerró un plan de comprobante sin el envío'; END IF;
END $$;
UPDATE servicios SET fecha_entrega_real='2026-01-01' WHERE id=lpad('1',32,'0')::uuid;
INSERT INTO digitales_envios VALUES (lpad('1',32,'0')::uuid,'ENVIADO');
DO $$ BEGIN
 IF (SELECT fecha_entrega_real FROM servicios WHERE id=lpad('1',32,'0')::uuid)<>'2026-01-01'::date THEN RAISE EXCEPTION 'El reenvío cambió la entrega'; END IF;
END $$;
SELECT 'OK: ambos órdenes, envíos fallidos, pendientes, adicionales, NA, removidos, cancelados, otro plan, planes de solo comprobante y reenvíos' AS resultado;
ROLLBACK;
`)
