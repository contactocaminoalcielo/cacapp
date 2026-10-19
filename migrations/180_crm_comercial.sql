-- ============================================================================
-- 180 — CRM comercial de veterinarias (aliados)
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-10-19): un CRM para el área comercial, que es por donde
-- entra ~74 % de los servicios (316 de 433 en septiembre vinieron de un aliado).
-- Vive "aparte" dentro de Orbit (/crm, con su propio menú) y lo usa un rol
-- nuevo, COMERCIAL, que además puede CONSULTAR Gestión.
--
-- Lo que cubre:
--   1. Prospectos (importados, manuales, de redes, del portal de preregistro) y
--      su embudo Kanban.
--   2. La ficha de la veterinaria: los datos viven en `aliados` (no en una copia)
--      para que TODO Orbit gane horarios, teléfonos y contactos completos.
--   3. Gestiones (llamadas, visitas, WhatsApp) y seguimientos programados con
--      alerta.
--   4. Tickets / PQRS de veterinarias ("no me han pagado la comisión"). Aparte
--      de `pqrs` (migr. 167), que es lo que dice una FAMILIA sobre un servicio.
--   5. Fotos del establecimiento.
--   6. Hitos configurables (N servicios → plantilla de agradecimiento), que
--      Orbit PROPONE y el comercial aprueba (decisión de David: nada sale solo
--      hasta que una regla se pase a automática a propósito).
--   7. El agente VENTAS como DATO (apagado): atiende solo a los PROSPECTOS que
--      escriben por la línea de veterinarias, delegado del agente dueño de la
--      línea. Las veterinarias activas siguen con su agente de siempre.
--
-- Por qué `delegado_de` y no dos agentes con la misma línea: el sistema entero
-- asume UN agente por línea (agente-config rechaza compartirla; plantillas,
-- materiales y la WABA se resuelven por "el agente de esta línea"). El delegado
-- no posee la línea: el dueño decide, por conversación, si se la pasa.
--
-- Aditiva, idempotente. No borra ni reescribe nada vivo. Las métricas
-- (frecuencia, probabilidad, riesgo) NO se guardan: se calculan en el backend
-- sobre `servicios`, así nunca quedan viejas.
--
-- Aplicar en VPS (Contabo) — el archivo se PIPEA desde local:
--   cat migrations/180_crm_comercial.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. Rol COMERCIAL ───────────────────────────────────────────────────────
INSERT INTO public.roles_personal (id, nombre, descripcion)
VALUES (7, 'COMERCIAL', 'Gestiona veterinarias aliadas y prospectos desde el CRM')
ON CONFLICT (id) DO NOTHING;
-- La secuencia (si la tabla tiene una) no puede quedarse atrás del 7 manual.
DO $$
DECLARE s text := pg_get_serial_sequence('public.roles_personal', 'id');
BEGIN
  IF s IS NOT NULL THEN
    PERFORM setval(s, GREATEST((SELECT max(id) FROM public.roles_personal), 7));
  END IF;
END $$;

-- ─── 2. La ficha: campos nuevos en `aliados` ────────────────────────────────
-- Van en la tabla de siempre porque el resto de Orbit (Kanban, técnico, agente)
-- ya lee de aquí: completar la ficha en el CRM mejora la operación sin más.
ALTER TABLE public.aliados
  ADD COLUMN IF NOT EXISTS telefono_2         text,
  ADD COLUMN IF NOT EXISTS contacto_cargo     text,
  ADD COLUMN IF NOT EXISTS contacto_email     text,
  ADD COLUMN IF NOT EXISTS contacto_2_nombre  text,
  ADD COLUMN IF NOT EXISTS contacto_2_telefono text,
  ADD COLUMN IF NOT EXISTS instagram          text,
  ADD COLUMN IF NOT EXISTS sitio_web          text,
  ADD COLUMN IF NOT EXISTS atiende_24h        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS num_veterinarios   integer,
  ADD COLUMN IF NOT EXISTS servicios_clinica  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS referencia_ubicacion text,
  ADD COLUMN IF NOT EXISTS lat                numeric(9,6),
  ADD COLUMN IF NOT EXISTS lng                numeric(9,6),
  -- A quién del área comercial le toca esta cuenta.
  ADD COLUMN IF NOT EXISTS comercial_id       uuid REFERENCES public.personal(id),
  -- Lo que el comercial sabe y no cabe en un campo ("la dueña decide los martes").
  ADD COLUMN IF NOT EXISTS notas_comerciales  text,
  ADD COLUMN IF NOT EXISTS ficha_actualizada_en  timestamptz,
  ADD COLUMN IF NOT EXISTS ficha_actualizada_por uuid REFERENCES public.personal(id);

CREATE INDEX IF NOT EXISTS idx_aliados_comercial ON public.aliados (comercial_id);

-- ─── 3. Importaciones (de dónde salió cada lote de prospectos) ──────────────
CREATE TABLE IF NOT EXISTS public.crm_importaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_archivo text,
  fuente         text NOT NULL DEFAULT 'IMPORTACION',
  fuente_detalle text,
  filas_total    integer NOT NULL DEFAULT 0,
  creadas        integer NOT NULL DEFAULT 0,
  duplicadas     integer NOT NULL DEFAULT 0,
  con_error      integer NOT NULL DEFAULT 0,
  creado_por     uuid REFERENCES public.personal(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── 4. Prospectos (el embudo) ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.crm_prospectos_numero_seq START 1;

CREATE TABLE IF NOT EXISTS public.crm_prospectos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           integer NOT NULL UNIQUE DEFAULT nextval('public.crm_prospectos_numero_seq'),
  nombre           text NOT NULL,
  contacto_nombre  text,
  contacto_cargo   text,
  telefono         text,
  whatsapp         text,
  email            text,
  ciudad           text,
  localidad        text,
  barrio           text,
  direccion        text,
  instagram        text,
  sitio_web        text,
  tipo_establecimiento_id integer REFERENCES public.tipo_establecimiento(id),
  -- De dónde llegó. REDES y WEB entran por el webhook /crm/leads; PORTAL es el
  -- preregistro de /aliado; AGENTE, lo que capturó el agente de ventas.
  fuente           text NOT NULL DEFAULT 'MANUAL'
                   CHECK (fuente IN ('MANUAL','IMPORTACION','REDES','WEB','PORTAL','REFERIDO','AGENTE','WHATSAPP','VISITA','OTRO')),
  fuente_detalle   text,
  importacion_id   uuid REFERENCES public.crm_importaciones(id) ON DELETE SET NULL,
  etapa            text NOT NULL DEFAULT 'NUEVO'
                   CHECK (etapa IN ('NUEVO','CONTACTADO','INTERESADO','REUNION','PROPUESTA','GANADO','PERDIDO')),
  -- Orden dentro de la columna del Kanban (arrastrar y soltar).
  orden            double precision NOT NULL DEFAULT 0,
  motivo_perdida   text,
  -- Servicios al mes que se espera que mande si se gana. Alimenta el "valor del embudo".
  potencial_mensual integer,
  -- 0-100. NULL = que lo calcule el sistema por etapa.
  probabilidad     integer CHECK (probabilidad IS NULL OR probabilidad BETWEEN 0 AND 100),
  responsable_id   uuid REFERENCES public.personal(id),
  -- Al ganarlo queda atado a la veterinaria que se creó (o que ya existía).
  aliado_id        uuid REFERENCES public.aliados(id_aliado) ON DELETE SET NULL,
  notas            text,
  -- Columnas del archivo importado que no tienen casilla propia: no se pierden.
  datos            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultima_gestion_en timestamptz,
  etapa_desde      timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid REFERENCES public.personal(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_prospecto_perdido_con_motivo
    CHECK (etapa <> 'PERDIDO' OR coalesce(trim(motivo_perdida), '') <> '')
);

CREATE INDEX IF NOT EXISTS idx_crm_prosp_etapa  ON public.crm_prospectos (etapa, orden);
CREATE INDEX IF NOT EXISTS idx_crm_prosp_tel    ON public.crm_prospectos (public.wa_tel10(whatsapp));
CREATE INDEX IF NOT EXISTS idx_crm_prosp_tel2   ON public.crm_prospectos (public.wa_tel10(telefono));
CREATE INDEX IF NOT EXISTS idx_crm_prosp_aliado ON public.crm_prospectos (aliado_id);

-- ─── 5. Gestiones (lo que pasó) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_actividades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id     uuid REFERENCES public.aliados(id_aliado) ON DELETE CASCADE,
  prospecto_id  uuid REFERENCES public.crm_prospectos(id) ON DELETE CASCADE,
  tipo          text NOT NULL
                CHECK (tipo IN ('LLAMADA','WHATSAPP','VISITA','EMAIL','REUNION','NOTA','PLANTILLA','MATERIAL','SISTEMA')),
  resultado     text
                CHECK (resultado IS NULL OR resultado IN (
                  'CONTESTO','NO_CONTESTO','OCUPADO','NUMERO_ERRADO','BUZON',
                  'INTERESADO','NO_INTERESADO','VOLVER_A_LLAMAR','COMPROMISO','QUEJA','INFORMATIVO')),
  resumen       text NOT NULL,
  -- Lo que quedó pactado ("manda 2 servicios esta semana", "le enviamos tarifario").
  compromiso    text,
  duracion_min  integer CHECK (duracion_min IS NULL OR duracion_min >= 0),
  origen        text NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','AGENTE','SISTEMA')),
  realizado_por uuid REFERENCES public.personal(id),
  realizado_en  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_actividad_un_destino CHECK (aliado_id IS NOT NULL OR prospecto_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_act_aliado ON public.crm_actividades (aliado_id, realizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_prosp  ON public.crm_actividades (prospecto_id, realizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_fecha  ON public.crm_actividades (realizado_en DESC);

-- ─── 6. Tickets / PQRS de veterinarias ──────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.crm_tickets_numero_seq START 1;

CREATE TABLE IF NOT EXISTS public.crm_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         integer NOT NULL UNIQUE DEFAULT nextval('public.crm_tickets_numero_seq'),
  aliado_id      uuid NOT NULL REFERENCES public.aliados(id_aliado),
  tipo           text NOT NULL DEFAULT 'PETICION'
                 CHECK (tipo IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  categoria      text NOT NULL DEFAULT 'OTRO'
                 CHECK (categoria IN ('COMISION','PAGO','FACTURACION','RECOGIDA','ENTREGA','CERTIFICADO',
                                      'RECORDATORIOS','ATENCION','PRECIOS','PLATAFORMA','OTRO')),
  prioridad      text NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA','MEDIA','ALTA','URGENTE')),
  estado         text NOT NULL DEFAULT 'ABIERTO'
                 CHECK (estado IN ('ABIERTO','EN_PROCESO','ESPERANDO_VET','RESUELTO','CERRADO')),
  asunto         text NOT NULL,
  descripcion    text,
  canal          text CHECK (canal IS NULL OR canal IN ('LLAMADA','WHATSAPP','VISITA','EMAIL','PORTAL','OTRO')),
  servicio_id    uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  responsable_id uuid REFERENCES public.personal(id),
  -- Fecha compromiso de respuesta. La pone el backend con el SLA de la prioridad.
  vence_en       timestamptz,
  solucion       text,
  resuelto_en    timestamptz,
  creado_por     uuid REFERENCES public.personal(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_ticket_resuelto_con_solucion
    CHECK (estado NOT IN ('RESUELTO','CERRADO') OR coalesce(trim(solucion), '') <> '')
);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_estado ON public.crm_tickets (estado, vence_en);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_aliado ON public.crm_tickets (aliado_id, created_at DESC);

-- La historia del ticket. Nada se edita: cada cambio es una fila.
CREATE TABLE IF NOT EXISTS public.crm_ticket_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES public.crm_tickets(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('CREADO','COMENTARIO','ESTADO','ASIGNACION','PRIORIDAD')),
  texto      text,
  de         text,
  a          text,
  autor_id   uuid REFERENCES public.personal(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_ticket_ev ON public.crm_ticket_eventos (ticket_id, created_at);

-- ─── 7. Seguimientos programados (las alertas de "toca llamar") ─────────────
CREATE TABLE IF NOT EXISTS public.crm_seguimientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id       uuid REFERENCES public.aliados(id_aliado) ON DELETE CASCADE,
  prospecto_id    uuid REFERENCES public.crm_prospectos(id) ON DELETE CASCADE,
  ticket_id       uuid REFERENCES public.crm_tickets(id) ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'LLAMADA'
                  CHECK (tipo IN ('LLAMADA','WHATSAPP','VISITA','REUNION','TAREA')),
  titulo          text NOT NULL,
  notas           text,
  programado_para timestamptz NOT NULL,
  responsable_id  uuid REFERENCES public.personal(id),
  estado          text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','HECHO','CANCELADO')),
  origen          text NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','AGENTE','SISTEMA')),
  completado_en   timestamptz,
  completado_por  uuid REFERENCES public.personal(id),
  actividad_id    uuid REFERENCES public.crm_actividades(id) ON DELETE SET NULL,
  creado_por      uuid REFERENCES public.personal(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_seguimiento_un_destino
    CHECK (aliado_id IS NOT NULL OR prospecto_id IS NOT NULL OR ticket_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_seg_pend ON public.crm_seguimientos (programado_para) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_crm_seg_aliado ON public.crm_seguimientos (aliado_id);
CREATE INDEX IF NOT EXISTS idx_crm_seg_prosp  ON public.crm_seguimientos (prospecto_id);

-- ─── 8. Fotos del establecimiento ───────────────────────────────────────────
-- En la DB (bytea) como los materiales de WhatsApp: nada nuevo en el Storage de
-- Supabase (directriz de arquitectura). El navegador las manda ya reducidas.
CREATE TABLE IF NOT EXISTS public.crm_fotos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id    uuid REFERENCES public.aliados(id_aliado) ON DELETE CASCADE,
  prospecto_id uuid REFERENCES public.crm_prospectos(id) ON DELETE CASCADE,
  archivo      bytea NOT NULL,
  miniatura    bytea,
  mime         text NOT NULL,
  bytes        integer NOT NULL CHECK (bytes > 0 AND bytes <= 6291456),
  descripcion  text,
  es_portada   boolean NOT NULL DEFAULT false,
  subido_por   uuid REFERENCES public.personal(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_foto_un_destino CHECK (aliado_id IS NOT NULL OR prospecto_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_fotos_aliado ON public.crm_fotos (aliado_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_fotos_prosp  ON public.crm_fotos (prospecto_id, created_at DESC);

-- ─── 9. Hitos: reglas y propuestas de envío ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_hitos_reglas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  -- SERVICIOS_TOTAL: al llegar a N servicios en toda la historia (10, 50, 100…).
  -- SERVICIOS_MES:   al llegar a N servicios dentro de un mes calendario.
  -- PRIMER_SERVICIO: el primero que manda (bienvenida).
  -- REACTIVACION:    vuelve a mandar después de N días sin hacerlo.
  tipo            text NOT NULL CHECK (tipo IN ('SERVICIOS_TOTAL','SERVICIOS_MES','PRIMER_SERVICIO','REACTIVACION')),
  umbral          integer NOT NULL DEFAULT 1 CHECK (umbral >= 1),
  -- Solo SERVICIOS_TOTAL: volver a disparar cada `umbral` servicios (10, 20, 30…).
  repetir         boolean NOT NULL DEFAULT false,
  plantilla       text,
  idioma          text NOT NULL DEFAULT 'es_MX',
  -- Valores fijos o por hueco que no salen del mapeo de Plantillas → Datos.
  valores         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- PROPONER: queda en "Por enviar" y alguien lo aprueba. AUTOMATICO: sale solo.
  modo            text NOT NULL DEFAULT 'PROPONER' CHECK (modo IN ('PROPONER','AUTOMATICO')),
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid REFERENCES public.personal(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_hitos_envios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regla_id      uuid NOT NULL REFERENCES public.crm_hitos_reglas(id) ON DELETE CASCADE,
  aliado_id     uuid NOT NULL REFERENCES public.aliados(id_aliado) ON DELETE CASCADE,
  -- Qué vez del hito es: "T50" (total 50), "M2026-10" (mes), "P" (primero),
  -- "R2026-10-19" (reactivación). Junto con la regla y el aliado, evita
  -- proponer dos veces lo mismo.
  periodo       text NOT NULL,
  valor         integer,
  estado        text NOT NULL DEFAULT 'PROPUESTO' CHECK (estado IN ('PROPUESTO','ENVIADO','DESCARTADO','ERROR')),
  error         text,
  propuesto_en  timestamptz NOT NULL DEFAULT now(),
  resuelto_en   timestamptz,
  resuelto_por  uuid REFERENCES public.personal(id),
  UNIQUE (regla_id, aliado_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_crm_hitos_env_estado ON public.crm_hitos_envios (estado, propuesto_en DESC);

-- Reglas de ejemplo, APAGADAS y sin plantilla: el comercial elige la plantilla
-- aprobada y las enciende. Así se ve cómo se configuran sin que salga nada.
INSERT INTO public.crm_hitos_reglas (nombre, tipo, umbral, repetir, modo, activo)
SELECT * FROM (VALUES
  ('Bienvenida: primer servicio', 'PRIMER_SERVICIO', 1, false, 'PROPONER', false),
  ('Gracias por 10 servicios',     'SERVICIOS_TOTAL', 10, true, 'PROPONER', false),
  ('Aliado del mes: 8 servicios',  'SERVICIOS_MES',    8, false, 'PROPONER', false),
  ('Volvió después de 60 días',    'REACTIVACION',    60, false, 'PROPONER', false)
) v(nombre, tipo, umbral, repetir, modo, activo)
WHERE NOT EXISTS (SELECT 1 FROM public.crm_hitos_reglas);

-- ─── 10. Configuración del CRM (umbrales editables desde la pantalla) ───────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('CRM', 'dias_enfriandose', '30'::jsonb, 'Días sin servicio a partir de los cuales una veterinaria activa pasa a "Enfriándose"'),
  ('CRM', 'dias_en_riesgo',   '60'::jsonb, 'Días sin servicio para "En riesgo"'),
  ('CRM', 'dias_dormida',     '90'::jsonb, 'Días sin servicio para "Dormida"'),
  ('CRM', 'sla_horas',        '{"URGENTE":4,"ALTA":24,"MEDIA":48,"BAJA":96}'::jsonb, 'Horas para responder un ticket según su prioridad'),
  ('CRM', 'dias_sin_gestion', '21'::jsonb, 'Una veterinaria sin ninguna gestión en estos días aparece en "Sin contacto"')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── 11. El preregistro del portal (/aliado) entra al embudo ────────────────
-- Una vet que se registra sola es un prospecto INTERESADO: si nadie la llama,
-- se enfría igual que cualquier otro. Al aprobarla (estado → activo) el
-- prospecto se gana solo.
CREATE OR REPLACE FUNCTION public.fn_crm_aliado_a_prospecto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.estado = 'pendiente_validacion' THEN
    IF NOT EXISTS (SELECT 1 FROM public.crm_prospectos WHERE aliado_id = NEW.id_aliado) THEN
      INSERT INTO public.crm_prospectos
        (nombre, contacto_nombre, telefono, whatsapp, email, ciudad, localidad, barrio, direccion,
         tipo_establecimiento_id, fuente, fuente_detalle, etapa, aliado_id)
      VALUES
        (NEW.nombre, NEW.contacto_nombre, NEW.telefono, NEW.whatsapp, NEW.email, NEW.ciudad,
         NEW.localidad, NEW.barrio, NEW.direccion, NEW.tipo_establecimiento_id,
         'PORTAL', 'Preregistro en /aliado', 'INTERESADO', NEW.id_aliado);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'activo' AND OLD.estado IS DISTINCT FROM 'activo' THEN
    UPDATE public.crm_prospectos
       SET etapa = 'GANADO', etapa_desde = now(), updated_at = now()
     WHERE aliado_id = NEW.id_aliado AND etapa NOT IN ('GANADO','PERDIDO');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_crm_aliado_a_prospecto ON public.aliados;
CREATE TRIGGER trg_crm_aliado_a_prospecto
  AFTER INSERT OR UPDATE OF estado ON public.aliados
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_aliado_a_prospecto();

-- updated_at de prospectos y tickets
CREATE OR REPLACE FUNCTION public.fn_crm_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_crm_prosp_touch ON public.crm_prospectos;
CREATE TRIGGER trg_crm_prosp_touch BEFORE UPDATE ON public.crm_prospectos
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_touch();
DROP TRIGGER IF EXISTS trg_crm_ticket_touch ON public.crm_tickets;
CREATE TRIGGER trg_crm_ticket_touch BEFORE UPDATE ON public.crm_tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_touch();
DROP TRIGGER IF EXISTS trg_crm_regla_touch ON public.crm_hitos_reglas;
CREATE TRIGGER trg_crm_regla_touch BEFORE UPDATE ON public.crm_hitos_reglas
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_touch();

-- ─── 12. El agente VENTAS (dato, APAGADO) ───────────────────────────────────
-- `delegado_de`: el agente dueño de la línea le pasa la conversación cuando el
-- número es un prospecto abierto del CRM. Sin dueño activo, no hace nada.
ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS delegado_de integer REFERENCES public.agente_wa(id) ON DELETE SET NULL;

INSERT INTO public.agente_wa
  (clave, nombre, activo, categoria, objetivo, idioma, instrucciones, modelo, effort, memoria_mensajes, delegado_de)
SELECT 'VENTAS', 'Agente comercial — prospectos', false, 'VENTAS',
  'Convertir clínicas veterinarias interesadas en aliadas de Camino al Cielo: resolver sus dudas, '
  || 'explicar cómo funciona la alianza y dejar agendada una llamada con el área comercial o '
  || 'enviarles el enlace de afiliación.',
  'es',
  'Hablas con una CLÍNICA VETERINARIA que todavía NO es aliada de Camino al Cielo (funeraria de '
  || 'mascotas en Bogotá y alrededores). Eres del área comercial: cálido, breve y concreto, como un '
  || 'asesor por WhatsApp. Nunca más de 3 o 4 líneas por mensaje.' || E'\n\n'
  || 'Lo que buscas, en este orden:' || E'\n'
  || '1. Entender quién es (nombre de la clínica, quién habla, zona) y qué necesita.' || E'\n'
  || '2. Explicar el valor de la alianza: recogemos en la clínica, la clínica gana comisión por '
  || 'cada servicio, la familia recibe acompañamiento y certificados, y la clínica no tiene que '
  || 'gestionar nada.' || E'\n'
  || '3. Cerrar UN siguiente paso: que reciba el enlace de afiliación (`enviar_enlace_registro`) '
  || 'o que el área comercial la llame (`registrar_interes_comercial` con quiere_llamada=true y '
  || 'la hora que prefieran).' || E'\n\n'
  || 'LO URGENTE PRIMERO: si escriben porque tienen una mascota fallecida y necesitan la recogida '
  || 'ya, olvídate de vender y toma la solicitud con `registrar_solicitud` (pide los mismos datos '
  || 'que pide el formulario). La venta se hace después.' || E'\n\n'
  || 'Registra SIEMPRE lo que aprendas con `registrar_interes_comercial`, aunque no quieran nada: '
  || 'es lo único que ve el comercial. No inventes porcentajes de comisión ni precios: usa '
  || '`consultar_tarifas` para precios y, para comisiones, di que el asesor se las detalla en la llamada.',
  'claude-sonnet-5', 'low', 20,
  (SELECT id FROM public.agente_wa WHERE clave = 'VETERINARIAS')
WHERE NOT EXISTS (SELECT 1 FROM public.agente_wa WHERE clave = 'VENTAS');

-- Sus herramientas (sin fila no las tiene). CON `registrar_solicitud`: una
-- clínica no registrada que escribe con una mascota fallecida necesita la
-- recogida YA; si el agente de ventas no pudiera tomarla, el prospecto se
-- quedaría sin servicio justo cuando más importa (hoy el agente de vets sí la toma).
INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, orden)
SELECT a.id, h.clave, true, h.orden
  FROM public.agente_wa a
  CROSS JOIN (VALUES ('registrar_interes_comercial', 1), ('enviar_enlace_registro', 2),
                     ('consultar_tarifas', 3), ('enviar_material', 4), ('clasificar_conversacion', 5),
                     ('registrar_solicitud', 6)) h(clave, orden)
 WHERE a.clave = 'VENTAS'
   AND NOT EXISTS (SELECT 1 FROM public.agente_wa_herramientas x WHERE x.agente_id = a.id AND x.clave = h.clave);

-- ─── 13. GRANTs + RLS ───────────────────────────────────────────────────────
-- Toda escritura del CRM pasa por orbit-backend (rol `orbit_backend`). El
-- navegador solo LEE. Sin DELETE desde la app salvo fotos y seguimientos (el
-- backend los borra a pedido).
GRANT SELECT ON TABLE public.crm_importaciones, public.crm_prospectos, public.crm_actividades,
                     public.crm_tickets, public.crm_ticket_eventos, public.crm_seguimientos,
                     public.crm_hitos_reglas, public.crm_hitos_envios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_importaciones, public.crm_prospectos,
                     public.crm_actividades, public.crm_tickets, public.crm_ticket_eventos,
                     public.crm_seguimientos, public.crm_hitos_reglas, public.crm_hitos_envios,
                     public.crm_fotos TO orbit_backend;
GRANT DELETE ON TABLE public.crm_fotos, public.crm_seguimientos, public.crm_hitos_reglas TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.crm_prospectos_numero_seq, public.crm_tickets_numero_seq TO orbit_backend;
GRANT ALL ON TABLE public.crm_importaciones, public.crm_prospectos, public.crm_actividades,
                   public.crm_tickets, public.crm_ticket_eventos, public.crm_seguimientos,
                   public.crm_hitos_reglas, public.crm_hitos_envios, public.crm_fotos TO postgres, service_role;
GRANT ALL ON SEQUENCE public.crm_prospectos_numero_seq, public.crm_tickets_numero_seq TO postgres, service_role;
-- La ficha se edita desde el backend y al ganar un prospecto se crea la vet.
GRANT SELECT, INSERT, UPDATE ON TABLE public.aliados TO orbit_backend;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agente_wa, public.agente_wa_herramientas TO orbit_backend;
GRANT SELECT, UPDATE ON TABLE public.config_operativa TO orbit_backend;

ALTER TABLE public.crm_importaciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospectos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_actividades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_ticket_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_seguimientos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_hitos_reglas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_hitos_envios   ENABLE ROW LEVEL SECURITY;
-- Las fotos no se exponen a la sesión del navegador: se sirven por el backend.
ALTER TABLE public.crm_fotos          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_importaciones','crm_prospectos','crm_actividades','crm_tickets',
                           'crm_ticket_eventos','crm_seguimientos','crm_hitos_reglas','crm_hitos_envios']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_select" ON public.%I', t);
    EXECUTE format('CREATE POLICY "auth_select" ON public.%I FOR SELECT TO authenticated USING (true)', t);
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- Verificación (no destructiva):
--   select id, nombre from roles_personal where id = 7;
--   select count(*) from information_schema.columns
--    where table_name = 'aliados' and column_name in ('comercial_id','instagram','atiende_24h');  -- 3
--   select to_regclass('public.crm_prospectos'), to_regclass('public.crm_tickets'),
--          to_regclass('public.crm_seguimientos'), to_regclass('public.crm_fotos');
--   select clave, activo, delegado_de from agente_wa where clave = 'VENTAS';           -- activo = f
--   select count(*) from crm_hitos_reglas where activo;                                 -- 0
-- ============================================================================
