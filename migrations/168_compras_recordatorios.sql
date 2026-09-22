-- ============================================================================
-- 168 — Compra de recordatorios SIN servicio (cédula de mascota y otros)
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-09-22): un módulo solo para registrar la compra de
-- recordatorios. Se combina cliente + mascota como en el registro de un
-- servicio, pero en vez de crear un servicio se crea la venta de uno o varios
-- recordatorios del catálogo. Entre esos entra un producto nuevo: la
-- «Cédula de mascota», que se le vende a una familia con la mascota VIVA.
--
-- Por qué tablas propias y NO `servicio_recordatorios` con `servicio_id` nulo:
-- toda la operación (Producción, Imágenes, Digitales, Entregas, el trigger del
-- inventario, Finanzas) cuelga del servicio con `servicios!inner`. Un ítem sin
-- servicio quedaría invisible en todas esas pantallas sin que nada fallara —el
-- peor tipo de bug. Aquí la compra es la unidad, y tiene su propia cola de
-- producción dentro del módulo. Integrarla al tablero de Producción es una
-- decisión aparte, cuando se vea el volumen real.
--
-- Reglas que esta migración fija:
--   · El precio de cada línea es un SNAPSHOT (`precio_unitario`, `nombre`): el
--     catálogo puede cambiar después y la venta debe leerse igual.
--   · `valor_pagado` lo mantiene un trigger a partir de `..._pagos`, en la misma
--     transacción del INSERT. Nunca se escribe a mano (misma lección que el
--     inventario viejo: saldo y libro divergían en silencio).
--   · `estado_pago` es columna GENERADA: no puede quedar «vieja» como
--     `servicios.estado_pago` (ver memoria estado_pago_marca_vieja).
--   · Nada se borra: una compra se ANULA (fecha + motivo + quién) y los pagos
--     quedan. Cada cambio deja fila en `..._eventos`.
--   · Sin DELETE para nadie desde la app.
--
-- Aditiva, idempotente, reversible. No toca ninguna tabla viva salvo agregar
-- un origen al CHECK de `autorizaciones_datos` (el formulario capta datos de
-- una persona y va con su casilla, migr. 161) y sembrar UNA fila en el
-- catálogo `recordatorios` si no existe.
--
-- Aplicar en VPS (Contabo) — el archivo se PIPEA desde local; no vive en el VPS:
--   cat migrations/168_compras_recordatorios.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. Cabecera de la compra ───────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.compras_recordatorios_numero_seq START 1;

CREATE TABLE IF NOT EXISTS public.compras_recordatorios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Número corto para hablar de la compra por teléfono («la CR-12»).
  numero           integer NOT NULL UNIQUE
                   DEFAULT nextval('public.compras_recordatorios_numero_seq'),
  cliente_id       uuid NOT NULL REFERENCES public.clientes(id_cliente),
  mascota_id       uuid NOT NULL REFERENCES public.mascotas(id_mascota),
  total            numeric(12,2) NOT NULL CHECK (total >= 0),
  -- Lo mantiene el trigger de abajo. NUNCA escribirlo desde la app.
  valor_pagado     numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_pagado >= 0),
  estado_pago      text GENERATED ALWAYS AS (
                     CASE WHEN total <= 0 OR valor_pagado >= total THEN 'COMPLETO'
                          WHEN valor_pagado > 0                    THEN 'PARCIAL'
                          ELSE 'PENDIENTE' END) STORED,
  notas            text,
  registrado_por   uuid REFERENCES public.personal(id),
  anulada_en       timestamptz,
  anulada_por      uuid REFERENCES public.personal(id),
  motivo_anulacion text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- O está anulada con motivo y quién, o no está anulada. Nunca a medias.
  CONSTRAINT compras_rec_anulacion_completa CHECK (
    (anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
    OR (anulada_en IS NOT NULL AND anulada_por IS NOT NULL
        AND length(btrim(COALESCE(motivo_anulacion, ''))) > 0))
);

COMMENT ON TABLE  public.compras_recordatorios IS
  'Compra de recordatorios sin servicio funerario (cédula de mascota, un memopet suelto, etc.). Cliente + mascota + líneas. Se anula, no se borra (migr. 168).';
COMMENT ON COLUMN public.compras_recordatorios.valor_pagado IS
  'Suma de compra_recordatorio_pagos. La mantiene trg_compra_rec_pagos; nunca escribirla desde la app.';
COMMENT ON COLUMN public.compras_recordatorios.estado_pago IS
  'Generada: PENDIENTE / PARCIAL / COMPLETO según valor_pagado contra total. No puede quedar vieja.';

CREATE INDEX IF NOT EXISTS idx_compras_rec_cliente ON public.compras_recordatorios (cliente_id);
CREATE INDEX IF NOT EXISTS idx_compras_rec_mascota ON public.compras_recordatorios (mascota_id);
CREATE INDEX IF NOT EXISTS idx_compras_rec_fecha   ON public.compras_recordatorios (created_at DESC);

-- ─── 2. Líneas ──────────────────────────────────────────────────────────────
-- `nombre` y `precio_unitario` son snapshot del catálogo al momento de vender.
-- `datos_cliente` tiene la MISMA forma que servicio_recordatorios.datos_cliente
-- ({ "<label del campo>": ["texto", ...] }) para que producción lea igual.
CREATE TABLE IF NOT EXISTS public.compra_recordatorio_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id         uuid NOT NULL REFERENCES public.compras_recordatorios(id) ON DELETE CASCADE,
  recordatorio_id   uuid NOT NULL REFERENCES public.recordatorios(id),
  nombre            text NOT NULL,
  cantidad          smallint NOT NULL CHECK (cantidad >= 1),
  precio_unitario   numeric(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal          numeric(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  estado            text NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','EN_PROCESO','LISTO','ENTREGADO')),
  datos_cliente     jsonb,
  imagenes_urls     text[] NOT NULL DEFAULT '{}',
  asignado_a        uuid REFERENCES public.personal(id),
  fecha_inicio_prod date,
  fecha_fin_prod    date,
  fecha_entrega     date,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.compra_recordatorio_items IS
  'Una línea por recordatorio vendido en una compra sin servicio. Estado propio de producción/entrega (migr. 168).';

CREATE INDEX IF NOT EXISTS idx_compra_rec_items_compra ON public.compra_recordatorio_items (compra_id);
CREATE INDEX IF NOT EXISTS idx_compra_rec_items_estado ON public.compra_recordatorio_items (estado);

-- ─── 3. Pagos ───────────────────────────────────────────────────────────────
-- Un pago es una fila; el abono parcial es otra fila. No se editan.
-- Los medios son los mismos del cobro en la entrega (migr. 151).
CREATE TABLE IF NOT EXISTS public.compra_recordatorio_pagos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id        uuid NOT NULL REFERENCES public.compras_recordatorios(id) ON DELETE CASCADE,
  monto            numeric(12,2) NOT NULL CHECK (monto > 0),
  metodo           text NOT NULL
                   CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','NEQUI','DAVIPLATA','TARJETA','OTRO')),
  referencia       text,
  -- Ruta en el bucket `evidencias` (misma casa que los comprobantes de Finanzas).
  comprobante_path text,
  registrado_por   uuid REFERENCES public.personal(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compra_rec_pagos_compra ON public.compra_recordatorio_pagos (compra_id);

-- El saldo se recalcula desde el libro, en la misma transacción. Es la única
-- forma de que `valor_pagado` y los pagos no se separen nunca.
CREATE OR REPLACE FUNCTION public.fn_compra_rec_recalcular_pagado()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.compras_recordatorios c
     SET valor_pagado = (SELECT COALESCE(SUM(p.monto), 0)
                           FROM public.compra_recordatorio_pagos p
                          WHERE p.compra_id = NEW.compra_id)
   WHERE c.id = NEW.compra_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compra_rec_pagos ON public.compra_recordatorio_pagos;
CREATE TRIGGER trg_compra_rec_pagos
  AFTER INSERT ON public.compra_recordatorio_pagos
  FOR EACH ROW EXECUTE FUNCTION public.fn_compra_rec_recalcular_pagado();

-- ─── 4. Eventos (bitácora) ──────────────────────────────────────────────────
-- Todo lo que le pasa a una compra queda como fila: creada, pago, cambio de
-- estado de un ítem, anulación. Nada se sobrescribe sin dejar rastro.
CREATE TABLE IF NOT EXISTS public.compra_recordatorio_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id  uuid NOT NULL REFERENCES public.compras_recordatorios(id) ON DELETE CASCADE,
  item_id    uuid REFERENCES public.compra_recordatorio_items(id) ON DELETE CASCADE,
  tipo       text NOT NULL
             CHECK (tipo IN ('CREADA','PAGO','ESTADO_ITEM','DATOS_ITEM','ANULADA','NOTA')),
  detalle    jsonb,
  por        uuid REFERENCES public.personal(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compra_rec_eventos_compra ON public.compra_recordatorio_eventos (compra_id, created_at);

-- ─── 5. Autorización de datos: origen nuevo ─────────────────────────────────
-- El formulario capta datos de una persona (cliente nuevo) ⇒ lleva la casilla
-- y su constancia va con `origen = 'COMPRA_RECORDATORIOS'`. La graba el backend
-- dentro de la transacción de la compra. Los orígenes anteriores se conservan
-- tal cual (migr. 161 + 163).
ALTER TABLE public.autorizaciones_datos
  DROP CONSTRAINT IF EXISTS autorizaciones_datos_origen_check,
  ADD CONSTRAINT autorizaciones_datos_origen_check CHECK (origen IN (
    'SOLICITUD_CLIENTE','SOLICITUD_ALIADO','AFILIACION_ALIADO',
    'PORTAL_FOTOS','PORTAL_PLANTA','PORTAL_VISITA','REGISTRO_INTERNO',
    'REVOCACION','COMPRA_RECORDATORIOS'));

-- ─── 6. Producto nuevo en el catálogo: Cédula de mascota ────────────────────
-- Precio 0 A PROPÓSITO: David no lo fijó; se pone en Configuración ›
-- Recordatorios. El formulario de compra avisa cuando una línea vale $0 para
-- que no se venda «gratis» por descuido. Los campos de texto son lo que la
-- cédula imprime además de lo que ya está en `mascotas` (nombre, especie,
-- raza, sexo); la foto es la de la mascota (1).
INSERT INTO public.recordatorios
  (nombre, descripcion, categoria, requiere_imagen, solo_nombre, precio_base,
   max_fotos, campos_texto, tiempo_produccion_dias, recolecta_tecnico, activo)
SELECT 'Cédula de mascota',
       'Documento de identidad de la mascota, con su foto y sus datos. Se vende sin servicio funerario, desde Compras de recordatorios.',
       'fisico', true, false, 0, 1,
       '[{"label":"Fecha de nacimiento","cantidad":1},{"label":"Color y señas particulares","cantidad":1}]'::jsonb,
       3, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.recordatorios WHERE nombre ILIKE 'c_dula de mascota%'
);

-- ─── 7. GRANTs + RLS (patrón del proyecto) ──────────────────────────────────
-- Toda ESCRITURA pasa por orbit-backend (rol `orbit_backend`, sin RLS): es
-- quien valida rol, arma la transacción y deja los eventos. La sesión del
-- navegador (`authenticated`) solo LEE, por si una pantalla quiere suscribirse
-- a cambios en tiempo real. Sin DELETE para nadie desde la app.
-- ⚠️ Los ALTER DEFAULT PRIVILEGES no cubren a `orbit_backend`: los GRANT van a
-- mano, incluida la secuencia (sin ella el INSERT falla mudo en docker logs).
GRANT SELECT ON TABLE public.compras_recordatorios,
                     public.compra_recordatorio_items,
                     public.compra_recordatorio_pagos,
                     public.compra_recordatorio_eventos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.compras_recordatorios,
                                    public.compra_recordatorio_items,
                                    public.compra_recordatorio_pagos,
                                    public.compra_recordatorio_eventos TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.compras_recordatorios_numero_seq TO orbit_backend;
GRANT ALL ON TABLE public.compras_recordatorios,
                   public.compra_recordatorio_items,
                   public.compra_recordatorio_pagos,
                   public.compra_recordatorio_eventos TO postgres, service_role;
GRANT ALL ON SEQUENCE public.compras_recordatorios_numero_seq TO postgres, service_role;

ALTER TABLE public.compras_recordatorios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_recordatorio_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_recordatorio_pagos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_recordatorio_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select" ON public.compras_recordatorios;
CREATE POLICY "auth_select" ON public.compras_recordatorios FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_select" ON public.compra_recordatorio_items;
CREATE POLICY "auth_select" ON public.compra_recordatorio_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_select" ON public.compra_recordatorio_pagos;
CREATE POLICY "auth_select" ON public.compra_recordatorio_pagos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_select" ON public.compra_recordatorio_eventos;
CREATE POLICY "auth_select" ON public.compra_recordatorio_eventos FOR SELECT TO authenticated USING (true);

COMMIT;

-- ============================================================================
-- Verificación (no destructiva):
--   select to_regclass('public.compras_recordatorios'),
--          to_regclass('public.compra_recordatorio_items'),
--          to_regclass('public.compra_recordatorio_pagos'),
--          to_regclass('public.compra_recordatorio_eventos');
--   select has_table_privilege('orbit_backend','public.compras_recordatorios','INSERT'),
--          has_sequence_privilege('orbit_backend','public.compras_recordatorios_numero_seq','USAGE');
--   select id, nombre, precio_base from public.recordatorios where nombre ilike 'c_dula de mascota%';
-- Revertir:
--   DROP TABLE public.compra_recordatorio_eventos, public.compra_recordatorio_pagos,
--              public.compra_recordatorio_items, public.compras_recordatorios;
--   DROP FUNCTION public.fn_compra_rec_recalcular_pagado();
--   DROP SEQUENCE public.compras_recordatorios_numero_seq;
--   (y volver a poner el CHECK de origen de la migración 163)
-- ============================================================================
