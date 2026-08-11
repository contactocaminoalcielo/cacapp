-- 090 — Etiquetado de conversaciones de WhatsApp
--
-- Por qué: con el agente respondiendo solo, coordinación pierde el hilo de qué
-- necesita atención. El badge de no leídos no alcanza — no distingue el "vamos a
-- cerrar, ¿dónde va el técnico?" de alguien preguntando precios. La etiqueta es
-- lo que convierte la bandeja en listas de trabajo.
--
-- El catálogo es una TABLA, no un enum: las categorías se van a ajustar con el
-- uso real y no puede hacer falta un despliegue para cambiarlas.
--
-- Las tablas NO se exponen por PostgREST: la UI habla con orbit-backend.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_etiquetas (
  id          serial PRIMARY KEY,
  clave       text NOT NULL UNIQUE,
  nombre      text NOT NULL,
  -- Los tres grupos son las listas que ve el coordinador. NOVEDAD = algo pasa y
  -- hay que actuar; SERVICIO = pregunta por algo ya en curso; COMERCIAL = venta.
  grupo       text NOT NULL CHECK (grupo IN ('NOVEDAD', 'SERVICIO', 'COMERCIAL', 'OTRO')),
  color       text NOT NULL DEFAULT '#64748B',
  -- Lo lee el AGENTE para decidir cuál aplica: es la definición operativa de la
  -- etiqueta, no una nota interna. Si se cambia, cambia el criterio del agente.
  descripcion text,
  orden       integer NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_conversacion_etiquetas (
  contacto    text NOT NULL REFERENCES public.whatsapp_contactos(contacto) ON DELETE CASCADE,
  etiqueta_id integer NOT NULL REFERENCES public.whatsapp_etiquetas(id) ON DELETE CASCADE,
  origen      text NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('AGENTE', 'MANUAL')),
  motivo      text,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  PRIMARY KEY (contacto, etiqueta_id)
);

-- La bandeja pinta las etiquetas de TODAS las conversaciones en cada refresco:
-- el índice por etiqueta es para las listas filtradas.
CREATE INDEX IF NOT EXISTS whatsapp_conv_etiq_etiqueta_idx
  ON public.whatsapp_conversacion_etiquetas (etiqueta_id, creado_en DESC);

-- ── Catálogo inicial ────────────────────────────────────────────────────────
-- Pensado para lo que David describió que llega por esta línea. Se ajusta con
-- el uso: son filas, no código.
INSERT INTO public.whatsapp_etiquetas (clave, nombre, grupo, color, orden, descripcion) VALUES
  ('URGENTE_TECNICO', 'Urgente: ¿dónde va el técnico?', 'NOVEDAD',   '#DC2626', 1,
   'La clínica pregunta por una recogida que ya solicitó y está esperando, o avisa que va a cerrar. Es lo más urgente de la línea: alguien tiene que llamar al técnico ya.'),
  ('RECLAMO',         'Reclamo o algo salió mal',       'NOVEDAD',   '#B91C1C', 2,
   'Una queja, un error del servicio, algo que no llegó o llegó mal.'),
  ('FUERA_COBERTURA', 'Fuera de cobertura',             'NOVEDAD',   '#D97706', 3,
   'Piden servicio en un municipio que no está en la lista de cobertura y hay que validarlo.'),
  ('SOLICITUD',       'Solicitud de recogida',          'SERVICIO',  '#059669', 4,
   'Se registró una solicitud de recogida en esta conversación.'),
  ('ESTADO_SERVICIO', 'Consulta un servicio en curso',  'SERVICIO',  '#0891B2', 5,
   'Preguntan por un servicio que ya está andando, sin la urgencia de estar esperando al técnico en la puerta.'),
  ('RECORDATORIOS',   'Consulta recordatorios',         'SERVICIO',  '#7C3AED', 6,
   'Preguntan por los recordatorios: si ya están listos, cuándo se entregan, el memorial, el video.'),
  ('COTIZACION',      'Cotización o planes',            'COMERCIAL', '#1A5CD8', 7,
   'Preguntan precios, planes, qué incluye cada uno, tiempos o cobertura, sin pedir todavía una recogida.'),
  ('CONVENIO',        'Convenio o comisión',            'COMERCIAL', '#4F46E5', 8,
   'Hablan de comisiones, condiciones especiales, convenios o facturación. Siempre lo decide coordinación.'),
  ('OTRO',            'Otro',                           'OTRO',      '#64748B', 9,
   'No encaja en ninguna de las anteriores.')
ON CONFLICT (clave) DO NOTHING;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- El rol del backend es `orbit_backend`, NO `postgres`: sin estos GRANT el
-- endpoint responde 200 y no guarda nada (ya pasó con el webhook).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_etiquetas               TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_conversacion_etiquetas  TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_etiquetas_id_seq                      TO orbit_backend;

-- Nadie más las toca: la UI pasa por el backend, no por PostgREST.
REVOKE ALL ON TABLE public.whatsapp_etiquetas              FROM anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_conversacion_etiquetas FROM anon, authenticated;

COMMIT;
