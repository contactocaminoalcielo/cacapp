-- 210_oferta_posterior_ventas.sql
--
-- OFERTA POSTERIOR AL SERVICIO + módulo VENTAS POSTERIORES (REPORTE ORBIT 2026-11-17).
--
-- Unos dos meses después del fallecimiento, Orbit le escribe a la familia por
-- WhatsApp —una plantilla con cuatro botones— y le ofrece, con descuento:
--   · recordatorios adicionales (los que NO venían en su plan),
--   · afiliar a sus otras mascoticas a un plan pre-exequial,
--   · cédulas para mascotas,
--   · o no recibir más información.
-- Cada botón lleva a un portal propio (/#/oferta/CODIGO) con el catálogo visual
-- y los formularios. Lo que la familia hace allí cae en /ventas-posteriores.
--
-- Es INDEPENDIENTE de las condolencias (migr. 209) y sale después de ellas.
--
-- Reglas (decididas con David el 2026-11-17):
--   · fecha_programada = GREATEST(fallecimiento + 60, condolencia + 30, entrega + 15).
--   · Solo servicios ENTREGADOS (por `servicios.estado`, igual que la 209).
--   · NO se le ofrece a: quien pidió no recibir información, quien calificó MAL
--     la encuesta post-entrega, quien tiene una QUEJA o RECLAMO en ese servicio,
--     plan DESAMPARADO, sin WhatsApp, y la condolencia excluida A MANO.
--   · Pre-exequiales: solo afiliaciones NUEVAS, las atiende COORDINACIÓN, y Orbit
--     NUNCA crea un contrato solo: el contrato lo crea una persona en
--     /presequiales cuando el pago está validado.
--   · Los tres descuentos son configurables (30 / 50 / 50).
--   · Solo de aquí en adelante: `arranque_desde` = el día en que se encienda.
--
-- Qué toca de lo que ya existe (todo aditivo):
--   · compras_recordatorios: + venta_posterior_id; origen admite 'OFERTA_POSTERIOR'.
--   · autorizaciones_datos.origen admite 'OFERTA_POSTERIOR'.
--   · afiliacion_contratos.descuento_motivo admite 'OFERTA_POSTERIOR'.
-- Ninguna fila existente cambia.
--
-- Las tablas nuevas NO se abren a `authenticated`: traen datos personales de la
-- solicitud y todo se lee y escribe por orbit-backend (rol `orbit_backend`).

BEGIN;

-- Los ALTER de más abajo piden un candado exclusivo sobre compras_recordatorios,
-- autorizaciones_datos y afiliacion_contratos. Si alguna transacción larga las
-- tiene tomadas, es mejor que la migración falle a los 5 s (y se reintenta) que
-- dejar a los portales públicos haciendo cola detrás de ella.
SET LOCAL lock_timeout = '5s';

-- ─── 1. No ofrecer: la familia lo pidió o el equipo la marcó ─────────────────
-- `ON DELETE SET NULL` y no CASCADE: si coordinación borra o fusiona una ficha
-- duplicada, el «no me escriban» de la familia NO se puede ir con ella — queda
-- vivo por su número (`tel10`).
CREATE TABLE IF NOT EXISTS public.oferta_exclusiones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id   uuid REFERENCES public.clientes(id_cliente) ON DELETE SET NULL,
  tel10        text CHECK (tel10 IS NULL OR tel10 ~ '^[0-9]{10}$'),
  motivo       text NOT NULL CHECK (length(btrim(motivo)) > 0),
  origen       text NOT NULL CHECK (origen IN ('FAMILIA', 'EQUIPO')),
  creado_por   uuid REFERENCES public.personal(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  retirado_en  timestamptz,
  retirado_por uuid REFERENCES public.personal(id)
);
COMMENT ON TABLE public.oferta_exclusiones IS
  'Familias a las que NO se les envían ofertas comerciales (migr. 210). origen FAMILIA = tocó «No deseo información» o lo pidió en el portal; EQUIPO = «Excluir de ofertas posteriores». Vale por cliente o por los últimos 10 dígitos del WhatsApp. Se retira, no se borra.';

CREATE INDEX IF NOT EXISTS idx_oferta_excl_cliente
  ON public.oferta_exclusiones (cliente_id) WHERE retirado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_oferta_excl_tel
  ON public.oferta_exclusiones (tel10) WHERE retirado_en IS NULL;

-- ─── 2. La oferta: una por servicio ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertas_posteriores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id         uuid NOT NULL UNIQUE REFERENCES public.servicios(id) ON DELETE CASCADE,
  cliente_id          uuid REFERENCES public.clientes(id_cliente) ON DELETE SET NULL,
  -- Llave del portal /#/oferta/CODIGO: 32 hex (122 bits), no adivinable.
  codigo              text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  fecha_fallecimiento date,
  fecha_entrega       date,
  fecha_programada    date NOT NULL,
  estado              text NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'ERROR', 'EXCLUIDO')),
  motivo_exclusion    text,
  excluido_por        uuid REFERENCES public.personal(id),
  excluido_en         timestamptz,
  -- true = coordinación la volvió a incluir a mano: ya no la excluyen solas las
  -- reglas de calificación/queja (sí la de «no deseo información»).
  forzada             boolean NOT NULL DEFAULT false,
  whatsapp_destino    text,
  linea_wa            text,
  mensaje_id          text,
  fecha_envio         timestamptz,
  enviado_por         uuid REFERENCES public.personal(id),
  intentos            integer NOT NULL DEFAULT 0,
  error               text,
  respuesta           text CHECK (respuesta IS NULL OR respuesta IN ('RECORDATORIOS', 'PREEXEQUIALES', 'CEDULAS', 'NO_DESEA')),
  respondido_en       timestamptz,
  abierta_en          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ofertas_posteriores IS
  'Oferta comercial posterior al servicio (migr. 210). Una por servicio. La prepara y envía /jobs/oferta-posterior; se ve en /ventas-posteriores.';
COMMENT ON COLUMN public.ofertas_posteriores.fecha_programada IS
  'GREATEST(fallecimiento + dias_desde_fallecimiento, condolencia + dias_tras_condolencia, entrega + dias_tras_entrega). Fin de semana y festivo salen el siguiente día hábil.';
COMMENT ON COLUMN public.ofertas_posteriores.respuesta IS
  'El ÚLTIMO botón que tocó la familia. Cada interés queda además como una venta en ventas_posteriores.';

CREATE INDEX IF NOT EXISTS idx_ofertas_post_estado_fecha ON public.ofertas_posteriores (estado, fecha_programada);
CREATE INDEX IF NOT EXISTS idx_ofertas_post_fecha        ON public.ofertas_posteriores (fecha_programada);
CREATE INDEX IF NOT EXISTS idx_ofertas_post_cliente      ON public.ofertas_posteriores (cliente_id);

-- ─── 3. Ventas posteriores: una oportunidad por oferta y categoría ──────────
CREATE TABLE IF NOT EXISTS public.ventas_posteriores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferta_id        uuid NOT NULL REFERENCES public.ofertas_posteriores(id) ON DELETE CASCADE,
  categoria        text NOT NULL CHECK (categoria IN ('RECORDATORIOS', 'PREEXEQUIALES', 'CEDULAS')),
  estado           text NOT NULL DEFAULT 'INTERESADO'
                   CHECK (estado IN ('INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO',
                                     'PENDIENTE_PAGO', 'PAGO_REPORTADO', 'PAGO_VALIDADO',
                                     'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA',
                                     'COMPRA_REGISTRADA', 'CERRADA_SIN_VENTA')),
  -- Pre-exequiales: lo que diligenció la familia (plan, propietario, mascotas).
  solicitud        jsonb,
  -- Precio POR MASCOTA congelado al completar el formulario (lista, % y neto).
  valor_lista      numeric(12,2) CHECK (valor_lista IS NULL OR valor_lista >= 0),
  descuento_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  valor            numeric(12,2) CHECK (valor IS NULL OR valor >= 0),
  -- Lo que la familia DECLARA del pago. No es plata recibida hasta validarlo.
  pago_cliente     jsonb,
  pago_validado_en timestamptz,
  pago_validado_por uuid REFERENCES public.personal(id),
  afiliacion_id    uuid REFERENCES public.afiliaciones(id) ON DELETE SET NULL,
  numero_contrato  text,
  motivo_cierre    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oferta_id, categoria),
  -- La regla dura del reporte, también en la base: sin pago validado no hay
  -- contrato ni afiliación activa, lo escriba quien lo escriba.
  CONSTRAINT ventas_post_contrato_exige_pago CHECK (
    estado NOT IN ('PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA')
    OR pago_validado_en IS NOT NULL)
);
COMMENT ON TABLE public.ventas_posteriores IS
  'Oportunidades de la oferta posterior (migr. 210): una por oferta y categoría. Recordatorios y cédulas terminan en una compra (compras_recordatorios.venta_posterior_id); pre-exequiales, en un contrato que crea COORDINACIÓN en /presequiales.';

CREATE INDEX IF NOT EXISTS idx_ventas_post_cat_estado ON public.ventas_posteriores (categoria, estado);
CREATE INDEX IF NOT EXISTS idx_ventas_post_updated    ON public.ventas_posteriores (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.venta_posterior_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id   uuid NOT NULL REFERENCES public.ventas_posteriores(id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  detalle    jsonb,
  por        uuid REFERENCES public.personal(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.venta_posterior_eventos IS
  'Bitácora de cada venta posterior (migr. 210): cambios de estado, notas, pagos. `por` NULL = lo hizo la familia o el sistema.';
CREATE INDEX IF NOT EXISTS idx_venta_post_eventos ON public.venta_posterior_eventos (venta_id, created_at);

-- ─── 4. Compras de recordatorios: de qué venta vienen ───────────────────────
ALTER TABLE public.compras_recordatorios
  ADD COLUMN IF NOT EXISTS venta_posterior_id uuid REFERENCES public.ventas_posteriores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_compras_rec_venta_post
  ON public.compras_recordatorios (venta_posterior_id) WHERE venta_posterior_id IS NOT NULL;

ALTER TABLE public.compras_recordatorios DROP CONSTRAINT IF EXISTS compras_rec_origen_check;
ALTER TABLE public.compras_recordatorios
  ADD CONSTRAINT compras_rec_origen_check
  CHECK (origen IN ('INTERNO', 'CATALOGO_WEB', 'OFERTA_POSTERIOR'));

-- ─── 5. Autorización de datos: origen nuevo ─────────────────────────────────
ALTER TABLE public.autorizaciones_datos DROP CONSTRAINT IF EXISTS autorizaciones_datos_origen_check;
ALTER TABLE public.autorizaciones_datos ADD CONSTRAINT autorizaciones_datos_origen_check
  CHECK (origen = ANY (ARRAY['SOLICITUD_CLIENTE','SOLICITUD_ALIADO','AFILIACION_ALIADO','PORTAL_FOTOS',
    'PORTAL_PLANTA','PORTAL_VISITA','REGISTRO_INTERNO','REVOCACION','COMPRA_RECORDATORIOS',
    'CATALOGO_RECORDATORIOS','OFERTA_POSTERIOR']));

-- ─── 6. Afiliaciones: motivo de descuento nuevo ─────────────────────────────
ALTER TABLE public.afiliacion_contratos DROP CONSTRAINT IF EXISTS afil_contratos_descuento_motivo_valido;
ALTER TABLE public.afiliacion_contratos ADD CONSTRAINT afil_contratos_descuento_motivo_valido
  CHECK (descuento_motivo IS NULL OR descuento_motivo IN (
    'RENOVACION_ANTICIPADA', 'MULTIPLES_MASCOTAS', 'RENOVACION_MULTIPLE_TARDIA', 'MANUAL', 'OFERTA_POSTERIOR'));

-- ─── 7. Configuración. Arranca APAGADO ──────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('OFERTA_POSTERIOR', 'activo', 'false'::jsonb,
   'Interruptor de la oferta posterior. Encender en /automatizaciones cuando Meta apruebe la plantilla.'),
  ('OFERTA_POSTERIOR', 'plantilla', 'null'::jsonb,
   'Plantilla aprobada en la WABA de familias. La siembra scripts/crear-plantilla-oferta-posterior.mjs estado.'),
  ('OFERTA_POSTERIOR', 'arranque_desde', to_jsonb(public.fn_hoy_bogota()::text),
   'Solo ofertas programadas desde esta fecha (anti-blast del histórico). Encender la pone en ese día.'),
  ('OFERTA_POSTERIOR', 'dias_desde_fallecimiento', '60'::jsonb,
   'Días entre el fallecimiento y la oferta.'),
  ('OFERTA_POSTERIOR', 'dias_tras_condolencia', '30'::jsonb,
   'Mínimo de días después del mensaje de condolencias.'),
  ('OFERTA_POSTERIOR', 'dias_tras_entrega', '15'::jsonb,
   'Mínimo de días después de la entrega del servicio.'),
  ('OFERTA_POSTERIOR', 'dias_max_desde_fallecimiento', '180'::jsonb,
   'Si la fecha programada cae más allá de estos días del fallecimiento, no se programa.'),
  ('OFERTA_POSTERIOR', 'dias_max_atraso', '4'::jsonb,
   'Una oferta programada hace más de estos días ya no se envía sola (cubre fin de semana + festivo).'),
  ('OFERTA_POSTERIOR', 'max_envios_por_corrida', '40'::jsonb,
   'Tope de envíos por corrida del job.'),
  ('OFERTA_POSTERIOR', 'dias_entre_ofertas', '180'::jsonb,
   'Una misma familia no recibe dos ofertas en menos de estos días (dos mascoticas, un solo mensaje).'),
  ('OFERTA_POSTERIOR', 'dias_vigencia', '30'::jsonb,
   'Días que el portal de la oferta sigue abierto con los descuentos, contados desde el envío.'),
  ('OFERTA_POSTERIOR', 'descuento_recordatorios', '30'::jsonb,
   'Porcentaje de descuento en recordatorios adicionales (0 = sin descuento).'),
  ('OFERTA_POSTERIOR', 'descuento_cedulas', '50'::jsonb,
   'Porcentaje de descuento en cédulas para mascotas (0 = sin descuento).'),
  ('OFERTA_POSTERIOR', 'descuento_preexequiales', '50'::jsonb,
   'Porcentaje de descuento en afiliaciones pre-exequiales NUEVAS (0 = sin descuento). No se suma a los otros descuentos de afiliación.'),
  ('OFERTA_POSTERIOR', 'excluir_calificacion_mala', 'true'::jsonb,
   'true: no se le ofrece a quien calificó MALA la encuesta post-entrega.'),
  ('OFERTA_POSTERIOR', 'excluir_con_queja', 'true'::jsonb,
   'true: no se le ofrece a quien tiene una QUEJA o un RECLAMO registrado en ese servicio.'),
  ('OFERTA_POSTERIOR', 'niveles_ofrecidos', '["BRONCE","PLATA","ORO","DIAMANTE"]'::jsonb,
   'Niveles de plan pre-exequial que se muestran en el portal (solo los que tengan precio en Configuración › Afiliaciones).'),
  ('OFERTA_POSTERIOR', 'tipos_ofrecidos', '["ANUAL","VITALICIO"]'::jsonb,
   'Tipos de plan pre-exequial que se muestran en el portal.'),
  ('OFERTA_POSTERIOR', 'planes_info', '{}'::jsonb,
   'Contenido visual de cada plan en el portal: { "BRONCE": { "descripcion": "", "beneficios": [""], "imagen_url": "" }, ... }. Lo escribe coordinación en /ventas-posteriores › Configuración.'),
  ('OFERTA_POSTERIOR', 'datos_pago', '""'::jsonb,
   'Datos para el pago que ve la familia en el portal. Vacío = usa los del catálogo público.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── 8. GRANTs + RLS ────────────────────────────────────────────────────────
-- ⚠️ Sin el GRANT a orbit_backend el job falla MUDO.
-- Las cuatro tablas quedan cerradas a anon y authenticated (RLS sin políticas):
-- la solicitud trae cédula, dirección y teléfono, y `authenticated` incluye a
-- técnicos y mensajeros. Solo las lee orbit-backend, que filtra por rol.
ALTER TABLE public.oferta_exclusiones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertas_posteriores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_posteriores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_posterior_eventos  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oferta_exclusiones, public.ofertas_posteriores,
              public.ventas_posteriores, public.venta_posterior_eventos
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.oferta_exclusiones, public.ofertas_posteriores,
                   public.ventas_posteriores, public.venta_posterior_eventos
  TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.oferta_exclusiones, public.ofertas_posteriores,
  public.ventas_posteriores, public.venta_posterior_eventos
  TO orbit_backend;

-- Lo que el módulo LEE de tablas que ya existen. orbit_backend ya las usa en
-- otros flujos; se repite aquí para que este módulo no dependa de un GRANT
-- puesto por otra migración (GRANT es idempotente).
GRANT SELECT ON TABLE public.servicios, public.mascotas, public.clientes, public.planes,
                      public.especies, public.recordatorios, public.servicio_recordatorios,
                      public.condolencias, public.nps_seguimiento, public.pqrs, public.festivos,
                      public.personal, public.roles_personal, public.config_operativa,
                      public.afiliaciones, public.afiliacion_contratos, public.whatsapp_mensajes
  TO orbit_backend;
GRANT INSERT ON TABLE public.notificaciones TO orbit_backend;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (tras aplicar):
--   SELECT count(*) FROM ofertas_posteriores;                                  -- 0
--   SELECT count(*) FROM config_operativa WHERE modulo='OFERTA_POSTERIOR';     -- 20
--   SELECT has_table_privilege('orbit_backend','public.ventas_posteriores','INSERT');   -- t
--   SELECT has_table_privilege('authenticated','public.ventas_posteriores','SELECT');   -- f
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='compras_rec_origen_check';
--   SELECT count(*) FROM compras_recordatorios WHERE venta_posterior_id IS NOT NULL;    -- 0
--
-- REVERSA (solo si no hay ventas reales; borra las solicitudes de las familias):
--   BEGIN;
--     UPDATE public.compras_recordatorios SET origen = 'CATALOGO_WEB' WHERE origen = 'OFERTA_POSTERIOR';
--     ALTER TABLE public.compras_recordatorios DROP CONSTRAINT compras_rec_origen_check;
--     ALTER TABLE public.compras_recordatorios ADD CONSTRAINT compras_rec_origen_check
--       CHECK (origen IN ('INTERNO', 'CATALOGO_WEB'));
--     ALTER TABLE public.compras_recordatorios DROP COLUMN IF EXISTS venta_posterior_id;
--     DROP TABLE IF EXISTS public.venta_posterior_eventos, public.ventas_posteriores,
--                          public.ofertas_posteriores, public.oferta_exclusiones;
--     DELETE FROM public.config_operativa WHERE modulo = 'OFERTA_POSTERIOR';
--     -- Los CHECK de autorizaciones_datos y afiliacion_contratos pueden quedarse:
--     -- admitir un valor de más no rompe nada, y quitarlo fallaría si ya se usó.
--   COMMIT;
-- ============================================================================
