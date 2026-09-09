-- ============================================================================
-- 149 — ELECCIÓN DE PLANTA por el cliente al cumplirse el compostaje
--
-- Al terminar el proceso de compostaje individual (fecha de ingreso al cubículo
-- + `meses_compostaje`, que el operario fija en 2, 2.5 ó 3), se le avisa al
-- cliente por WhatsApp y se le manda un enlace para que elija la especie de
-- planta en la que quedará su mascota (Helecho / Pescadito hoy) y, si quiere,
-- compre extras (una planta más, matera especial, placa…).
--
-- Tres piezas:
--   · `plantas`            catálogo editable en Configuración → Plantas. La
--                          especie de la planta CAMBIA con el tiempo: por eso es
--                          catálogo y no una lista quemada en el código.
--   · `planta_elecciones`  una fila por servicio: el aviso, su envío y la
--                          respuesta del cliente.
--   · `planta_adicionales` lo que compró. El precio es SNAPSHOT y lo pone el
--                          backend leyendo `plantas`, nunca el navegador.
--
-- Regla de oro heredada de Ofertas (migración 078): **el precio nunca viene del
-- navegador**. El portal manda ids y cantidades; el monto se resuelve aquí.
--
-- Ejecutar por SSH→psql en Contabo (ver memory/ops_aplicar_migraciones_vps.md).
-- Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Catálogo de plantas ────────────────────────────────────────────────────
-- Una fila cumple uno o los dos papeles:
--   · elegible = true  → aparece entre las opciones que el cliente ESCOGE (la
--                        que va incluida en el plan; normalmente precio 0).
--   · adicional = true → aparece en el bloque "¿deseas algo más?" con su precio.
-- Un mismo Helecho puede ser las dos cosas: la incluida y una segunda de pago.
CREATE TABLE IF NOT EXISTS public.plantas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text    NOT NULL,
  descripcion   text,
  imagen_url    text,
  precio        numeric NOT NULL DEFAULT 0 CHECK (precio >= 0),
  elegible      boolean NOT NULL DEFAULT true,
  adicional     boolean NOT NULL DEFAULT false,
  orden         integer NOT NULL DEFAULT 100,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_planta_nombre UNIQUE (nombre),
  -- Una fila que no es ni opción ni extra no se muestra en ningún sitio: casi
  -- siempre es un descuido al editar, no una intención.
  CONSTRAINT plantas_algun_uso CHECK (elegible OR adicional)
);

COMMENT ON TABLE  public.plantas            IS 'Catálogo de especies de planta del compostaje. La especie cambia con el tiempo: se edita en Configuración → Plantas, no en el código.';
COMMENT ON COLUMN public.plantas.elegible   IS 'Aparece entre las opciones que el cliente escoge (la incluida en el plan).';
COMMENT ON COLUMN public.plantas.adicional  IS 'Aparece en el bloque de compra con su precio.';
COMMENT ON COLUMN public.plantas.precio     IS 'Precio del extra. Fuente de verdad del cobro: el navegador nunca envía precios.';

-- ─── El aviso y la respuesta, una fila por servicio ─────────────────────────
CREATE TABLE IF NOT EXISTS public.planta_elecciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id       uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  -- Del item sale la fecha real de ingreso al cubículo. SET NULL: si el item se
  -- borra, la elección del cliente sigue siendo válida.
  lote_item_id      uuid REFERENCES public.lotes_tenjo_items(id) ON DELETE SET NULL,
  estado            text NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','ENVIADO','ELEGIDA','ERROR','CANCELADA')),
  -- Mismo secreto que el portal de fotos (`servicios.codigo_fotos`): el cliente
  -- ya lo tiene y no hay que inventarle otro.
  codigo            text NOT NULL,
  enlace            text,
  whatsapp_destino  text,
  linea_wa          text,
  -- Día en que se cumplió el compostaje (ingreso al cubículo + meses_compostaje).
  fecha_cumplida    date NOT NULL,
  fecha_envio       timestamptz,
  fecha_eleccion    timestamptz,
  planta_id         uuid REFERENCES public.plantas(id) ON DELETE SET NULL,
  -- Snapshot: si mañana se renombra o se retira la especie, la ficha del
  -- servicio debe seguir diciendo qué eligió ESTE cliente.
  planta_nombre     text,
  mensaje_id        text,
  error             text,
  intentos          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Un aviso por servicio. Es también el candado anti-duplicado del job.
  CONSTRAINT uq_planta_eleccion_servicio UNIQUE (servicio_id)
);

COMMENT ON TABLE  public.planta_elecciones               IS 'Aviso de fin de compostaje y elección de planta del cliente. Una fila por servicio.';
COMMENT ON COLUMN public.planta_elecciones.fecha_cumplida IS 'fecha_compostaje_inicio + meses_compostaje del item: el día en que de verdad se cumplió el proceso.';
COMMENT ON COLUMN public.planta_elecciones.planta_nombre IS 'Snapshot del nombre elegido; el catálogo puede cambiar después.';

-- ─── Extras comprados en el portal ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.planta_adicionales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eleccion_id      uuid NOT NULL REFERENCES public.planta_elecciones(id) ON DELETE CASCADE,
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  planta_id        uuid NOT NULL REFERENCES public.plantas(id) ON DELETE RESTRICT,
  nombre           text    NOT NULL,
  cantidad         integer NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario  numeric NOT NULL CHECK (precio_unitario >= 0),
  total            numeric NOT NULL CHECK (total >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Candado anti doble cobro: reenviar el formulario no vuelve a cargar el extra.
  CONSTRAINT uq_planta_adicional UNIQUE (eleccion_id, planta_id)
);

COMMENT ON TABLE  public.planta_adicionales                 IS 'Extras que el cliente compró en el portal de la planta. El UNIQUE(eleccion,planta) es el candado anti doble cobro.';
COMMENT ON COLUMN public.planta_adicionales.precio_unitario IS 'Snapshot del precio cobrado; el catálogo puede cambiar después.';

CREATE INDEX IF NOT EXISTS idx_plantas_activas          ON public.plantas (activo, orden);
CREATE INDEX IF NOT EXISTS idx_planta_elec_estado       ON public.planta_elecciones (estado, fecha_cumplida);
CREATE INDEX IF NOT EXISTS idx_planta_elec_codigo       ON public.planta_elecciones (codigo);
CREATE INDEX IF NOT EXISTS idx_planta_adic_servicio     ON public.planta_adicionales (servicio_id);

-- updated_at automático en las dos tablas que se editan.
CREATE OR REPLACE FUNCTION public.fn_plantas_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plantas_touch ON public.plantas;
CREATE TRIGGER trg_plantas_touch BEFORE UPDATE ON public.plantas
  FOR EACH ROW EXECUTE FUNCTION public.fn_plantas_touch();

DROP TRIGGER IF EXISTS trg_planta_elecciones_touch ON public.planta_elecciones;
CREATE TRIGGER trg_planta_elecciones_touch BEFORE UPDATE ON public.planta_elecciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_plantas_touch();

-- ─── Semilla: las dos especies de hoy ───────────────────────────────────────
-- Van a precio 0 y solo como opción: la planta incluida no se cobra. Los extras
-- de pago los crea David desde Configuración → Plantas.
INSERT INTO public.plantas (nombre, descripcion, precio, elegible, adicional, orden)
VALUES
  ('Helecho',   'Follaje verde y abundante, de interior o media sombra.', 0, true, false, 10),
  ('Pescadito', 'Hojas alargadas y colgantes, muy resistente.',           0, true, false, 20)
ON CONFLICT (nombre) DO NOTHING;

-- ─── Configuración del módulo ───────────────────────────────────────────────
-- La plantilla arranca en NULL a propósito: mientras Meta no apruebe una, el job
-- deja el aviso en PENDIENTE y lo reporta. NUNCA simula un envío (mismo criterio
-- que `usar_plantilla` del flujo de imágenes).
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('PLANTAS', 'activo', 'true'::jsonb,
   'Interruptor del aviso automático de fin de compostaje.'),
  ('PLANTAS', 'plantilla', 'null'::jsonb,
   'Plantilla HSM aprobada: {"nombre","idioma","categoria","vars":["mascota","enlace"]}. NULL → el job no envía.'),
  ('PLANTAS', 'max_envios_por_corrida', '30'::jsonb,
   'Tope de avisos por ejecución del job.'),
  ('PLANTAS', 'arranque_desde', 'null'::jsonb,
   'No avisar por compostajes cumplidos antes de esta fecha (anti-blast del histórico).'),
  ('PLANTAS', 'max_adicionales', '4'::jsonb,
   'Cuántos extras distintos ve el cliente en el portal.'),
  ('PLANTAS', 'dias_ventana_portal', '120'::jsonb,
   'Días tras el aviso en que el enlace sigue aceptando la elección.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── GRANTs + RLS ───────────────────────────────────────────────────────────
-- Tablas creadas por SQL raw: Supabase NO aplica grants automáticos, y los
-- ALTER DEFAULT PRIVILEGES no cubren a `orbit_backend` (el rol con el que se
-- conecta el backend). Sin este GRANT el portal falla MUDO: responde 200 y no
-- guarda nada. Ver memory/ops_backend_rol_y_url_reales.md.
GRANT ALL ON TABLE public.plantas            TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.planta_elecciones  TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.planta_adicionales TO postgres, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plantas            TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planta_elecciones  TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planta_adicionales TO orbit_backend;

ALTER TABLE public.plantas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planta_elecciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planta_adicionales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plantas_auth_all            ON public.plantas;
DROP POLICY IF EXISTS planta_elecciones_auth_all  ON public.planta_elecciones;
DROP POLICY IF EXISTS planta_adicionales_auth_sel ON public.planta_adicionales;

-- El catálogo lo administra el personal desde Configuración.
CREATE POLICY plantas_auth_all ON public.plantas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Las elecciones las escribe el backend; el personal las lee (ficha, tablero) y
-- puede cancelar un aviso desde Orbit.
CREATE POLICY planta_elecciones_auth_all ON public.planta_elecciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Los extras son dinero cobrado: solo lectura desde el frontend. Quien los crea
-- es el backend dentro de la transacción que suma al servicio.
CREATE POLICY planta_adicionales_auth_sel ON public.planta_adicionales
  FOR SELECT TO authenticated USING (true);

-- `anon` NO toca estas tablas: el portal público las lee por el backend propio
-- con conexión directa a Postgres, igual que Ofertas.

-- ─── Vista de trabajo: quién está pendiente de elegir ───────────────────────
-- La usa el tablero de Tenjo y la ficha. Deriva la fecha de cumplimiento del
-- item, sin columna que se desincronice (mismo principio que la ocupación de
-- cubículos: el estado físico se deriva del hecho).
CREATE OR REPLACE VIEW public.v_plantas_pendientes AS
SELECT pe.id                AS eleccion_id,
       pe.servicio_id,
       pe.estado,
       pe.codigo,
       pe.enlace,
       pe.fecha_cumplida,
       pe.fecha_envio,
       pe.fecha_eleccion,
       pe.planta_nombre,
       pe.error,
       m.nombre             AS mascota,
       TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
       c.whatsapp,
       cu.codigo            AS cubiculo,
       COALESCE(ad.extras, 0)      AS extras_comprados,
       COALESCE(ad.valor_extras, 0) AS valor_extras
FROM public.planta_elecciones pe
JOIN public.servicios s        ON s.id = pe.servicio_id
JOIN public.mascotas m         ON m.id_mascota = s.mascota_id
LEFT JOIN public.clientes c    ON c.id_cliente = m.cliente_id
LEFT JOIN public.lotes_tenjo_items i ON i.id = pe.lote_item_id
LEFT JOIN public.cubiculos cu  ON cu.id = i.cubiculo_id
LEFT JOIN LATERAL (
  SELECT count(*) AS extras, sum(total) AS valor_extras
  FROM public.planta_adicionales pa WHERE pa.eleccion_id = pe.id
) ad ON true
WHERE s.estado <> 'CANCELADO';

-- security_invoker: la vista respeta la RLS de quien consulta, no la del dueño.
-- Sin esto una vista es un agujero por el que se lee lo que la política niega.
ALTER VIEW public.v_plantas_pendientes SET (security_invoker = true);
GRANT SELECT ON public.v_plantas_pendientes TO authenticated, service_role, orbit_backend;

COMMIT;

-- PostgREST cachea el esquema: sin esto el frontend no ve las tablas nuevas y
-- los embeds responden PGRST200.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
--   BEGIN;
--     DROP VIEW  IF EXISTS public.v_plantas_pendientes;
--     DROP TABLE IF EXISTS public.planta_adicionales;
--     DROP TABLE IF EXISTS public.planta_elecciones;
--     DROP TABLE IF EXISTS public.plantas;
--     DROP FUNCTION IF EXISTS public.fn_plantas_touch();
--     DELETE FROM public.config_operativa WHERE modulo = 'PLANTAS';
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
