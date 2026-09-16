-- 159_mitad_compostaje_visitas.sql
--
-- A MITAD DEL COMPOSTAJE: «el proceso va con normalidad» + invitación a visitar
-- el cubículo de la mascota.
--
-- Pedido de David el 2026-09-16. Hasta hoy la familia dejaba a su mascota en
-- Tenjo y no volvía a saber nada hasta que se cumplía el compostaje (migr. 149).
-- Este aviso llena ese silencio por la mitad y, de paso, abre la puerta a la
-- visita a planta — que existe en Orbit desde julio (migr. 059) pero **nunca se
-- ha usado**: 0 filas en `visitas_tenjo` al escribir esto.
--
-- LA MITAD NO SON "1 MES". Es `fecha_compostaje_inicio + meses_compostaje/2`,
-- porque `meses_compostaje` vale 2, 2.5 ó 3 según lo que fijó el operario. Al
-- 16-sep hay 75 mascotas en compostaje y **19 no son de 2 meses**: con un mes
-- fijo se les escribiría antes de tiempo. Misma regla que ya usa el job de
-- elección de planta, dividida entre dos.
--
-- LA VISITA NO QUEDA CONFIRMADA. La familia pide día y franja; coordinación
-- valida contra la jornada de Tenjo. Por eso la solicitud entra en un estado
-- nuevo (`SOLICITADA`) de la MISMA tabla de visitas, y no en una tabla aparte:
-- así aparece donde el equipo ya mira, y confirmarla es cambiar su estado.
--
-- Todo aditivo y re-ejecutable.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. visitas_tenjo: la familia también puede pedir (antes solo agendaba la casa)
-- ════════════════════════════════════════════════════════════════════════════

-- El CHECK original solo admitía PROGRAMADA/REALIZADA/CANCELADA. `SOLICITADA`
-- es el paso anterior a PROGRAMADA: pedida por la familia, sin validar.
ALTER TABLE public.visitas_tenjo DROP CONSTRAINT IF EXISTS visitas_tenjo_estado_check;
ALTER TABLE public.visitas_tenjo ADD  CONSTRAINT visitas_tenjo_estado_check
  CHECK (estado IN ('SOLICITADA', 'PROGRAMADA', 'REALIZADA', 'CANCELADA'));

ALTER TABLE public.visitas_tenjo
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'COORDINACION',
  -- Franja, no hora: la familia escoge mañana o tarde y la casa pone la hora
  -- exacta al confirmar contra la jornada. Pedirle una hora a la familia sería
  -- prometerle una precisión que la planta no puede sostener.
  ADD COLUMN IF NOT EXISTS franja text,
  ADD COLUMN IF NOT EXISTS personas smallint,
  ADD COLUMN IF NOT EXISTS solicitado_en timestamptz,
  ADD COLUMN IF NOT EXISTS confirmada_en timestamptz,
  ADD COLUMN IF NOT EXISTS confirmada_por uuid REFERENCES public.personal(id);

ALTER TABLE public.visitas_tenjo DROP CONSTRAINT IF EXISTS visitas_tenjo_origen_check;
ALTER TABLE public.visitas_tenjo ADD  CONSTRAINT visitas_tenjo_origen_check
  CHECK (origen IN ('COORDINACION', 'PORTAL_CLIENTE'));

ALTER TABLE public.visitas_tenjo DROP CONSTRAINT IF EXISTS visitas_tenjo_franja_check;
ALTER TABLE public.visitas_tenjo ADD  CONSTRAINT visitas_tenjo_franja_check
  CHECK (franja IS NULL OR franja IN ('MANANA', 'TARDE'));

COMMENT ON COLUMN public.visitas_tenjo.origen IS
  'COORDINACION = la agendó la casa. PORTAL_CLIENTE = la pidió la familia desde el enlace del aviso de mitad de compostaje.';
COMMENT ON COLUMN public.visitas_tenjo.franja IS
  'Franja pedida por la familia (MANANA/TARDE). La hora exacta la pone la casa al confirmar, en hora_visita.';
COMMENT ON COLUMN public.visitas_tenjo.personas IS
  'Cuántas personas piensan venir. Lo informa la familia; sirve para saber si cabe en la jornada.';

-- Una familia no puede pedir dos visitas a la vez para la misma mascota. Es
-- índice parcial y no UNIQUE de tabla a propósito: cuando la visita se hace o
-- se cancela, puede volver a pedir otra (una familia puede volver, decisión de
-- la migración 059 que no se toca aquí).
CREATE UNIQUE INDEX IF NOT EXISTS ux_visitas_tenjo_solicitud_viva
  ON public.visitas_tenjo (servicio_id)
  WHERE estado IN ('SOLICITADA', 'PROGRAMADA');

CREATE INDEX IF NOT EXISTS idx_visitas_tenjo_solicitadas
  ON public.visitas_tenjo (estado, fecha_visita)
  WHERE estado = 'SOLICITADA';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. El aviso de mitad de compostaje
-- ════════════════════════════════════════════════════════════════════════════
-- Misma forma que `planta_elecciones` (migr. 149) porque es el mismo problema:
-- un job diario que prepara y envía, idempotente por servicio, que nunca marca
-- ENVIADO lo que no salió.
CREATE TABLE IF NOT EXISTS public.avisos_mitad_compostaje (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id      uuid NOT NULL UNIQUE REFERENCES public.servicios(id),
  lote_item_id     uuid REFERENCES public.lotes_tenjo_items(id),
  estado           text NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'ERROR', 'CANCELADO')),
  -- El secreto del portal de fotos, reusado: la familia ya lo tiene.
  codigo           text,
  enlace           text,
  whatsapp_destino text,
  linea_wa         text,
  fecha_mitad      date,          -- el día en que se cumplió la mitad
  fecha_envio      timestamptz,
  mensaje_id       text,
  intentos         smallint NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE public.avisos_mitad_compostaje IS
  'Aviso «el proceso va con normalidad» a mitad del compostaje, con invitación a visitar el cubículo. Un registro por servicio (UNIQUE): el aviso no se repite.';
COMMENT ON COLUMN public.avisos_mitad_compostaje.fecha_mitad IS
  'fecha_compostaje_inicio + meses_compostaje/2. NO es "un mes": meses_compostaje vale 2, 2.5 ó 3.';

CREATE INDEX IF NOT EXISTS idx_avisos_mitad_estado
  ON public.avisos_mitad_compostaje (estado, fecha_mitad);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Configuración
-- ════════════════════════════════════════════════════════════════════════════
-- `arranque_desde` se siembra con HOY a propósito: el 16-sep hay 37 mascotas
-- que ya pasaron la mitad (6 de ellas con el compostaje entero cumplido). David
-- decidió no escribirles — el aviso vale para las que vienen, no para tapar el
-- silencio de las que ya lo vivieron.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('MITAD_COMPOSTAJE', 'activo', 'false'::jsonb,
   'Interruptor del aviso de mitad de compostaje. Arranca APAGADO: encender cuando Meta apruebe la plantilla.'),
  ('MITAD_COMPOSTAJE', 'plantilla', 'null'::jsonb,
   'Plantilla HSM aprobada: {"nombre","idioma","categoria","vars":["mascota","enlace"]}. NULL → el job no envía y lo reporta.'),
  ('MITAD_COMPOSTAJE', 'max_envios_por_corrida', '20'::jsonb,
   'Tope de avisos por ejecución del job.'),
  ('MITAD_COMPOSTAJE', 'arranque_desde', to_jsonb(public.fn_hoy_bogota()::text),
   'No avisar por mitades cumplidas antes de esta fecha (anti-blast del histórico).')
ON CONFLICT (modulo, clave) DO NOTHING;

-- Reglas de la visita. Están en config y no en el código porque son de la
-- operación de la planta, no del programa: David las cambia en un UPDATE sin
-- redespliegue.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('VISITAS_TENJO', 'dias_anticipacion_min', '3'::jsonb,
   'Días mínimos entre hoy y la fecha que puede pedir la familia (da margen para validar y avisarle).'),
  ('VISITAS_TENJO', 'dias_ofrecidos', '6'::jsonb,
   'Cuántos días de operación futuros se le muestran en el enlace.'),
  ('VISITAS_TENJO', 'max_por_dia', '3'::jsonb,
   'Cupo de visitas por día. Un día que ya lo alcanzó deja de ofrecerse.'),
  ('VISITAS_TENJO', 'franjas', '[{"clave":"MANANA","label":"En la mañana","detalle":"9:00 a. m. – 12:00 m."},{"clave":"TARDE","label":"En la tarde","detalle":"1:00 – 4:00 p. m."}]'::jsonb,
   'Franjas que ve la familia. ⚠️ Confirmar con la planta antes de encender el aviso.'),
  ('VISITAS_TENJO', 'dias_ventana_portal', '90'::jsonb,
   'Días tras el aviso en que el enlace sigue aceptando solicitudes.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. GRANTs + RLS
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `ALTER DEFAULT PRIVILEGES` no cubre a `orbit_backend` (el rol con el que se
-- conecta el backend). Sin este GRANT el portal falla MUDO: responde 200 y no
-- escribe nada. Mismo tropiezo de la migración 149.
GRANT ALL ON TABLE public.avisos_mitad_compostaje TO postgres, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.avisos_mitad_compostaje TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.visitas_tenjo           TO orbit_backend;

ALTER TABLE public.avisos_mitad_compostaje ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avisos_mitad_auth_all ON public.avisos_mitad_compostaje;
CREATE POLICY avisos_mitad_auth_all ON public.avisos_mitad_compostaje
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PostgREST cachea el esquema: sin esto, las columnas nuevas de visitas_tenjo
-- no existen para el frontend (PGRST204) aunque estén en la tabla.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (tras aplicar):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='visitas_tenjo'::regclass AND contype='c';   -- 4 estados
--   SELECT count(*) FROM avisos_mitad_compostaje;                -- 0
--   SELECT clave, valor FROM config_operativa WHERE modulo IN ('MITAD_COMPOSTAJE','VISITAS_TENJO');
--   -- arranque_desde debe ser HOY, o los 37 atrasados saldrán todos juntos:
--   SELECT valor FROM config_operativa WHERE modulo='MITAD_COMPOSTAJE' AND clave='arranque_desde';
--
-- REVERSA:
--   BEGIN;
--     DROP TABLE IF EXISTS public.avisos_mitad_compostaje;
--     DELETE FROM public.config_operativa WHERE modulo IN ('MITAD_COMPOSTAJE','VISITAS_TENJO');
--     DROP INDEX IF EXISTS public.ux_visitas_tenjo_solicitud_viva;
--     DROP INDEX IF EXISTS public.idx_visitas_tenjo_solicitadas;
--     DELETE FROM public.visitas_tenjo WHERE origen = 'PORTAL_CLIENTE';
--     ALTER TABLE public.visitas_tenjo DROP CONSTRAINT IF EXISTS visitas_tenjo_estado_check;
--     ALTER TABLE public.visitas_tenjo ADD  CONSTRAINT visitas_tenjo_estado_check
--       CHECK (estado IN ('PROGRAMADA','REALIZADA','CANCELADA'));
--     ALTER TABLE public.visitas_tenjo
--       DROP COLUMN IF EXISTS origen, DROP COLUMN IF EXISTS franja,
--       DROP COLUMN IF EXISTS personas, DROP COLUMN IF EXISTS solicitado_en,
--       DROP COLUMN IF EXISTS confirmada_en, DROP COLUMN IF EXISTS confirmada_por;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
