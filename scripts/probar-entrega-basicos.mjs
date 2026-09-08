// Genera una prueba SQL aislada. Ejecutar su salida con psql -v ON_ERROR_STOP=1.
// Usa solo tablas temporales y revierte todo: no crea recibos de clientes.
import { readFileSync } from 'node:fs'
const migration = readFileSync(new URL('../migrations/147_entrega_basicos_recibo.sql', import.meta.url), 'utf8')
  .replace(/^BEGIN;|^COMMIT;/gm, '').replaceAll('public.', 'pg_temp.')
console.log(`
BEGIN;
CREATE TEMP TABLE servicios (id integer PRIMARY KEY, estado text);
CREATE TEMP TABLE recordatorios (id integer PRIMARY KEY, nombre text);
CREATE TEMP TABLE servicio_recordatorios (id integer PRIMARY KEY, servicio_id integer, recordatorio_id integer, estado text, origen text);
CREATE TEMP TABLE recibos_tecnico (id integer PRIMARY KEY, servicio_id integer, estado text, datos_form jsonb);
${migration}
GRANT ALL ON servicios, recordatorios, servicio_recordatorios, recibos_tecnico TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO servicios VALUES (1,'INGRESADO'),(2,'INGRESADO'),(3,'CANCELADO');
INSERT INTO recordatorios VALUES
 (1,'Huella y mechon'),(2,'Capsula de recuerdos'),(3,'Evidencias de conservación'),
 (4,'Soporte lazos de amor'),(5,'Huella corazón'),(6,'Audio de despedida'),
 (7,'Tarjeta de oración'),(8,'Huella 3D');
INSERT INTO servicio_recordatorios
 SELECT n,1,n,'PENDIENTE','PLAN' FROM generate_series(1,8) n;
UPDATE servicio_recordatorios SET estado='EN_PROCESO' WHERE id=2;
UPDATE servicio_recordatorios SET estado='LISTO' WHERE id=3;
INSERT INTO servicio_recordatorios VALUES
 (9,1,1,'NA','PLAN'),(10,1,1,'PENDIENTE','REMOVIDO'),
 (11,1,1,'PENDIENTE','ADICIONAL'),(12,2,5,'PENDIENTE','VIP'),
 (13,3,1,'PENDIENTE','PLAN'),(14,1,5,'ENTREGADO','PLAN');
CREATE TEMP TABLE controles AS SELECT * FROM servicio_recordatorios WHERE id>=6 AND id<>12;
INSERT INTO recibos_tecnico VALUES (1,1,'GUARDADO','{"toma_huella":true,"toma_mechon":true}');
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM servicio_recordatorios WHERE id<=5 AND estado='ENTREGADO') THEN RAISE EXCEPTION 'Tomar muestras no confirma entrega'; END IF;
END $$;
UPDATE recibos_tecnico SET datos_form='{"entrega_rec_basicos":true}' WHERE id=1;
DO $$ BEGIN
 IF (SELECT count(*) FROM servicio_recordatorios WHERE id<=5 AND estado='ENTREGADO')<>5 THEN RAISE EXCEPTION 'Faltan básicos por entregar'; END IF;
 IF (SELECT estado FROM servicio_recordatorios WHERE id=12)<>'PENDIENTE' THEN RAISE EXCEPTION 'Se modificó otro servicio'; END IF;
END $$;
-- Un nuevo recibo ya confirmado también entrega los básicos VIP existentes.
INSERT INTO recibos_tecnico VALUES (2,2,'GUARDADO','{"entrega_rec_basicos":true}'),(3,3,'GUARDADO','{"entrega_rec_basicos":true}');
DO $$ BEGIN
 IF (SELECT estado FROM servicio_recordatorios WHERE id=12)<>'ENTREGADO' THEN RAISE EXCEPTION 'No se entregó el básico VIP'; END IF;
 IF EXISTS ((SELECT * FROM controles EXCEPT ALL SELECT * FROM servicio_recordatorios) UNION ALL (SELECT * FROM servicio_recordatorios WHERE id>=6 AND id<>12 EXCEPT ALL SELECT * FROM controles)) THEN RAISE EXCEPTION 'Se alteraron exclusiones, cancelados, digitales o adicionales'; END IF;
END $$;
-- Editar otros datos del recibo no repite la transición ni borra estados.
UPDATE servicio_recordatorios SET estado='PENDIENTE' WHERE id=1;
UPDATE recibos_tecnico SET datos_form=datos_form || '{"nota":"edición"}' WHERE id=1;
UPDATE recibos_tecnico SET datos_form='{"entrega_rec_basicos":false}' WHERE id=2;
DO $$ BEGIN
 IF (SELECT estado FROM servicio_recordatorios WHERE id=1)<>'PENDIENTE' THEN RAISE EXCEPTION 'Una edición ajena repitió la entrega'; END IF;
 IF (SELECT estado FROM servicio_recordatorios WHERE id=12)<>'ENTREGADO' THEN RAISE EXCEPTION 'Desmarcar revirtió una entrega'; END IF;
END $$;
SELECT 'OK: entrega explícita, cinco básicos, VIP, exclusiones, idempotencia y no reversa' AS resultado;
ROLLBACK;
`)
