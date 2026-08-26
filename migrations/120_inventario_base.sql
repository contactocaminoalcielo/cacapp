-- 120 — Inventario, fase 1: catálogo, kardex y saldos
--
-- Base del módulo de inventario de insumos y materias primas. Esta migración
-- NO automatiza nada: crea el catálogo, el libro de movimientos y el saldo.
-- El descuento automático al marcar un recordatorio LISTO llega en la 121, a
-- propósito: un trigger que descuenta contra saldos inventados produce números
-- falsos con apariencia de exactitud, que es peor que no tener nada.
--
-- Decisiones tomadas con David el 2026-08-26:
--   · UNA sola bodega. El saldo vive en columnas de `inventario_insumos`.
--     `inventario_movimientos.ubicacion` existe igual — es seguro barato: si
--     mañana Tenjo se cuenta aparte, el kardex ya trae el dato y solo hay que
--     mover el saldo a una tabla por (insumo, ubicación) sin reconstruir nada.
--   · Entre 20 y 60 insumos ⇒ la pantalla lleva importación por CSV.
--   · Alcance inicial: recordatorios. Tenjo, recogida y entrega van después.
--
-- Diseño completo: docs/Orbit_Context/MODULES/INVENTARIO.md
--
-- Aplicar en el VPS Contabo (archivo completo):
--   cat 120_inventario_base.sql | docker compose exec -T db psql -U postgres -d postgres
--
-- ⚠️ El archivo trae COMMIT: un ensayo envolviéndolo en ROLLBACK NO ensaya nada.
--    Todo es IF NOT EXISTS / re-ejecutable, así que es seguro correrlo de una.

BEGIN;

-- ─── 1. Proveedores ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventario_proveedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  nit             text,
  contacto_nombre text,
  telefono        text,
  email           text,
  -- Cuánto tarda en entregar. Alimenta el punto de reorden en la fase 3:
  -- no sirve avisar "queda poco" si el proveedor tarda dos semanas.
  dias_entrega    integer NOT NULL DEFAULT 7 CHECK (dias_entrega >= 0),
  notas           text,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_proveedor_nombre
  ON public.inventario_proveedores (lower(nombre));

-- ─── 2. Insumos (catálogo + saldo) ──────────────────────────────────────────
-- El saldo vive aquí porque hay una sola bodega. `stock_actual` NO se escribe
-- a mano nunca: lo mantiene el trigger de la sección 5, en la misma transacción
-- que inserta el movimiento. Por eso no puede desviarse del kardex.
CREATE TABLE IF NOT EXISTS public.inventario_insumos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text,
  nombre         text NOT NULL,
  categoria      text,          -- MADERA | IMPRESION | ARCILLA | EMPAQUE | PAPELERIA | QUIMICO | ...
  tipo           text NOT NULL DEFAULT 'INSUMO'
                 CHECK (tipo IN ('INSUMO','MATERIA_PRIMA','SERVICIO_EXTERNO')),

  -- Unidad en la que se CONSUME. La compra puede venir en otra (ver
  -- inventario_presentaciones): la arcilla se compra en bultos de 25 kg y se
  -- gasta en gramos. El kardex guarda siempre en esta unidad.
  unidad_base    text NOT NULL DEFAULT 'unidad',

  stock_actual   numeric(14,3) NOT NULL DEFAULT 0,   -- ⚠️ solo lo escribe el trigger
  stock_minimo   numeric(14,3) NOT NULL DEFAULT 0,   -- piso manual para consumo irregular
  stock_objetivo numeric(14,3),                      -- hasta dónde reponer al comprar

  -- Costo promedio ponderado por unidad_base. Se recalcula SOLO en las entradas
  -- de compra. Cada movimiento congela su propio costo, así que subir el precio
  -- de la arcilla hoy no reescribe el costo del altar que se hizo en marzo.
  costo_promedio numeric(14,4) NOT NULL DEFAULT 0,
  costo_ultimo   numeric(14,4),

  proveedor_id   uuid REFERENCES public.inventario_proveedores(id) ON DELETE SET NULL,
  dias_reposicion integer CHECK (dias_reposicion >= 0),  -- override del proveedor
  perecedero     boolean NOT NULL DEFAULT false,
  notas          text,
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_insumo_codigo
  ON public.inventario_insumos (upper(codigo)) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_insumo_nombre
  ON public.inventario_insumos (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_inv_insumo_activo
  ON public.inventario_insumos (activo, categoria);

COMMENT ON COLUMN public.inventario_insumos.stock_actual IS
  'Saldo materializado. Lo mantiene fn_inventario_aplicar_movimiento en la misma transacción que el movimiento. NUNCA escribirlo a mano: se desviaría del kardex sin aviso.';
COMMENT ON COLUMN public.inventario_insumos.unidad_base IS
  'Unidad de CONSUMO (g, ml, cm, unidad). Todo el kardex está en esta unidad; la compra se convierte al recibir la orden.';

-- ─── 3. Presentaciones de compra ────────────────────────────────────────────
-- "Bulto 25 kg" con factor 25000 sobre un insumo cuya unidad_base es 'g'.
CREATE TABLE IF NOT EXISTS public.inventario_presentaciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id         uuid NOT NULL REFERENCES public.inventario_insumos(id) ON DELETE CASCADE,
  nombre            text NOT NULL,
  factor            numeric(14,4) NOT NULL CHECK (factor > 0),  -- unidades base por presentación
  precio_referencia numeric(14,2),
  proveedor_id      uuid REFERENCES public.inventario_proveedores(id) ON DELETE SET NULL,
  es_default        boolean NOT NULL DEFAULT false,
  activo            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insumo_id, nombre)
);

-- Una sola presentación por defecto por insumo
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_presentacion_default
  ON public.inventario_presentaciones (insumo_id) WHERE es_default;

-- ─── 4. Movimientos: EL KARDEX ──────────────────────────────────────────────
-- Única fuente de verdad. `cantidad` va con signo: positivo entra, negativo sale.
CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id      uuid NOT NULL REFERENCES public.inventario_insumos(id) ON DELETE RESTRICT,
  ubicacion      text NOT NULL DEFAULT 'BOGOTA',
  tipo           text NOT NULL CHECK (tipo IN (
                   'ENTRADA_COMPRA','ENTRADA_AJUSTE','ENTRADA_DEVOLUCION','ENTRADA_TRASLADO',
                   'SALIDA_PRODUCCION','SALIDA_MERMA','SALIDA_AJUSTE','SALIDA_TRASLADO')),
  cantidad       numeric(14,3) NOT NULL CHECK (cantidad <> 0),
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0,

  -- De dónde viene el movimiento. La pareja (origen_tipo, origen_id) es lo que
  -- impide el doble descuento cuando un recordatorio va y vuelve de LISTO.
  origen_tipo    text CHECK (origen_tipo IN (
                   'SERVICIO_RECORDATORIO','ORDEN_ITEM','LOTE_TENJO','RECOGIDA',
                   'ENTREGA','CONTEO','REVERSA')),
  origen_id      uuid,

  -- Desnormalizado a propósito: el costo de materiales de un servicio sale con
  -- un GROUP BY en vez de tres joins, y Finanzas y Reportes lo van a pedir
  -- todo el tiempo.
  servicio_id    uuid REFERENCES public.servicios(id) ON DELETE SET NULL,

  motivo         text,
  registrado_por uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  revertido_en   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Coherencia de signo con el tipo: una ENTRADA no puede restar.
ALTER TABLE public.inventario_movimientos
  DROP CONSTRAINT IF EXISTS inv_mov_signo_coherente;
ALTER TABLE public.inventario_movimientos
  ADD CONSTRAINT inv_mov_signo_coherente CHECK (
    (tipo LIKE 'ENTRADA%' AND cantidad > 0) OR
    (tipo LIKE 'SALIDA%'  AND cantidad < 0)
  );

-- ⛔ LA LLAVE CONTRA EL DOBLE DESCUENTO.
-- `servicio_recordatorios.estado` no es monótono: va PENDIENTE → EN_PROCESO →
-- LISTO y vuelve a EN_PROCESO cuando se corrige un error. Sin este índice, cada
-- regreso a LISTO volvería a descontar y nadie se enteraría hasta el conteo
-- físico. Al revertir se estampa `revertido_en` y se inserta el compensatorio
-- con origen_tipo='REVERSA' — así el índice deja pasar el siguiente consumo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_origen_vivo
  ON public.inventario_movimientos (origen_tipo, origen_id, insumo_id)
  WHERE origen_tipo IS NOT NULL AND revertido_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_mov_insumo_fecha
  ON public.inventario_movimientos (insumo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_servicio
  ON public.inventario_movimientos (servicio_id) WHERE servicio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_mov_tipo_fecha
  ON public.inventario_movimientos (tipo, created_at DESC);

COMMENT ON TABLE public.inventario_movimientos IS
  'Kardex. Única fuente de verdad del inventario. cantidad con signo: + entra, − sale. costo_unitario queda CONGELADO al momento del movimiento para que los reportes históricos no se reescriban con cada compra.';

-- ─── 5. El trigger que mantiene saldo y costo promedio ──────────────────────
-- Va en dos tiempos a propósito:
--   BEFORE: estampa el costo de las salidas con el promedio vigente.
--   AFTER:  mueve el saldo y recalcula el promedio de las entradas de compra.
-- Los dos dentro de la misma transacción que el INSERT, así que el saldo no
-- puede quedar desincronizado del kardex por ningún camino.

CREATE OR REPLACE FUNCTION public.fn_inventario_movimiento_antes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_promedio numeric(14,4);
BEGIN
  -- Una salida sin costo explícito se cuesta al promedio ponderado vigente.
  -- Esto es lo que congela el costo histórico de cada pieza producida.
  IF NEW.cantidad < 0 AND COALESCE(NEW.costo_unitario, 0) = 0 THEN
    SELECT costo_promedio INTO v_promedio
      FROM public.inventario_insumos WHERE id = NEW.insumo_id;
    NEW.costo_unitario := COALESCE(v_promedio, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventario_movimiento_despues()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock  numeric(14,3);
  v_prom   numeric(14,4);
BEGIN
  SELECT stock_actual, costo_promedio INTO v_stock, v_prom
    FROM public.inventario_insumos WHERE id = NEW.insumo_id FOR UPDATE;

  IF NEW.tipo = 'ENTRADA_COMPRA' AND NEW.costo_unitario > 0 THEN
    -- Promedio ponderado. La guarda del stock <= 0 no es cosmética: con saldo
    -- negativo la fórmula da un promedio absurdo o divide por cero.
    IF v_stock <= 0 THEN
      v_prom := NEW.costo_unitario;
    ELSE
      v_prom := (v_stock * v_prom + NEW.cantidad * NEW.costo_unitario)
                / (v_stock + NEW.cantidad);
    END IF;

    UPDATE public.inventario_insumos
       SET stock_actual   = stock_actual + NEW.cantidad,
           costo_promedio = v_prom,
           costo_ultimo   = NEW.costo_unitario,
           updated_at     = now()
     WHERE id = NEW.insumo_id;
  ELSE
    -- El saldo puede quedar negativo a propósito: el inventario NUNCA bloquea
    -- la operación. Un negativo es la señal de que faltó registrar una entrada.
    UPDATE public.inventario_insumos
       SET stock_actual = stock_actual + NEW.cantidad,
           updated_at   = now()
     WHERE id = NEW.insumo_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_mov_antes ON public.inventario_movimientos;
CREATE TRIGGER trg_inv_mov_antes
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_movimiento_antes();

DROP TRIGGER IF EXISTS trg_inv_mov_despues ON public.inventario_movimientos;
CREATE TRIGGER trg_inv_mov_despues
  AFTER INSERT ON public.inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_movimiento_despues();

-- Un movimiento del kardex no se edita ni se borra: se revierte con un
-- compensatorio. Sin esto, un UPDATE de `cantidad` dejaría el saldo mintiendo.
CREATE OR REPLACE FUNCTION public.fn_inventario_movimiento_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un movimiento de inventario no se borra: registra el movimiento contrario.';
  END IF;
  IF NEW.insumo_id      IS DISTINCT FROM OLD.insumo_id
  OR NEW.cantidad       IS DISTINCT FROM OLD.cantidad
  OR NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario
  OR NEW.tipo           IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'Un movimiento de inventario es inmutable. Solo se puede marcar revertido_en o corregir el motivo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_mov_inmutable ON public.inventario_movimientos;
CREATE TRIGGER trg_inv_mov_inmutable
  BEFORE UPDATE OR DELETE ON public.inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_movimiento_inmutable();

-- ─── 6. updated_at ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_inv_proveedores_updated ON public.inventario_proveedores;
CREATE TRIGGER trg_inv_proveedores_updated
  BEFORE UPDATE ON public.inventario_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_inv_insumos_updated ON public.inventario_insumos;
CREATE TRIGGER trg_inv_insumos_updated
  BEFORE UPDATE ON public.inventario_insumos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 7. Vistas ──────────────────────────────────────────────────────────────
-- ⚠️ TODA cifra agregada del inventario se calcula AQUÍ, no en React.
-- PGRST_DB_MAX_ROWS=1000 corta cualquier consulta sin avisar, y el kardex pasa
-- las mil filas en semanas: sumar movimientos en el cliente daría saldos falsos.

-- Consumo diario real de los últimos 30 días, por insumo.
CREATE OR REPLACE VIEW public.v_inventario_consumo_30d AS
SELECT
  m.insumo_id,
  SUM(-m.cantidad)                    AS consumido_30d,
  ROUND(SUM(-m.cantidad) / 30.0, 4)   AS consumo_diario
FROM public.inventario_movimientos m
WHERE m.tipo IN ('SALIDA_PRODUCCION','SALIDA_MERMA')
  AND m.revertido_en IS NULL
  AND m.created_at >= now() - interval '30 days'
GROUP BY m.insumo_id;

-- Fila por insumo con todo lo que la pantalla necesita para decidir si comprar.
CREATE OR REPLACE VIEW public.v_inventario_stock AS
SELECT
  i.id,
  i.codigo,
  i.nombre,
  i.categoria,
  i.tipo,
  i.unidad_base,
  i.activo,
  i.stock_actual,
  i.stock_minimo,
  i.stock_objetivo,
  i.costo_promedio,
  i.costo_ultimo,
  ROUND(i.stock_actual * i.costo_promedio, 2)          AS valor_inventario,
  i.proveedor_id,
  p.nombre                                             AS proveedor_nombre,
  COALESCE(i.dias_reposicion, p.dias_entrega, 7)       AS dias_reposicion,
  COALESCE(c.consumo_diario, 0)                        AS consumo_diario,
  CASE WHEN COALESCE(c.consumo_diario, 0) > 0
       THEN ROUND(i.stock_actual / c.consumo_diario, 1)
  END                                                  AS dias_cobertura,
  -- Punto de reorden: lo que se va a consumir mientras el proveedor entrega,
  -- más un colchón del 30 %. Nunca por debajo del mínimo manual.
  GREATEST(
    i.stock_minimo,
    ROUND(COALESCE(c.consumo_diario, 0)
          * COALESCE(i.dias_reposicion, p.dias_entrega, 7) * 1.3, 3)
  )                                                    AS punto_reorden,
  CASE
    WHEN i.stock_actual < 0 THEN 'NEGATIVO'
    WHEN i.stock_actual <= GREATEST(
           i.stock_minimo,
           COALESCE(c.consumo_diario, 0)
             * COALESCE(i.dias_reposicion, p.dias_entrega, 7) * 1.3
         ) THEN 'REPONER'
    ELSE 'OK'
  END                                                  AS estado_stock
FROM public.inventario_insumos i
LEFT JOIN public.inventario_proveedores  p ON p.id = i.proveedor_id
LEFT JOIN public.v_inventario_consumo_30d c ON c.insumo_id = i.id;

-- Materiales consumidos por servicio. Es la mitad que le falta a Finanzas para
-- poder hablar de margen real.
CREATE OR REPLACE VIEW public.v_inventario_costo_servicio AS
SELECT
  m.servicio_id,
  SUM(-m.cantidad * m.costo_unitario) AS costo_materiales,
  COUNT(*)                            AS movimientos
FROM public.inventario_movimientos m
WHERE m.servicio_id IS NOT NULL
  AND m.cantidad < 0
  AND m.revertido_en IS NULL
GROUP BY m.servicio_id;

-- ─── 8. Permisos ────────────────────────────────────────────────────────────
-- ⚠️ Tablas creadas por SQL raw: sin estos GRANT el backend falla MUDO.
-- `orbit_backend` es el rol real del backend propio, no service_role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventario_proveedores','inventario_insumos',
    'inventario_presentaciones','inventario_movimientos'
  ] LOOP
    EXECUTE format(
      'GRANT ALL ON TABLE public.%I TO postgres, authenticated, service_role', t);
    -- El rol del backend puede no existir en un entorno de pruebas.
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO orbit_backend', t);
    EXCEPTION WHEN undefined_object THEN
      RAISE NOTICE 'Rol orbit_backend inexistente, se omite el GRANT en %', t;
    END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS auth_full ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_full ON public.%I FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

ALTER VIEW public.v_inventario_consumo_30d      SET (security_invoker = true);
ALTER VIEW public.v_inventario_stock            SET (security_invoker = true);
ALTER VIEW public.v_inventario_costo_servicio   SET (security_invoker = true);

GRANT SELECT ON public.v_inventario_stock,
                public.v_inventario_consumo_30d,
                public.v_inventario_costo_servicio
  TO postgres, authenticated, service_role;

DO $$
BEGIN
  GRANT SELECT ON public.v_inventario_stock,
                  public.v_inventario_consumo_30d,
                  public.v_inventario_costo_servicio
    TO orbit_backend;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Rol orbit_backend inexistente, se omiten los GRANT de vistas';
END $$;

COMMIT;

-- ─── Verificación (correr aparte, después del COMMIT) ───────────────────────
-- SELECT nombre, stock_actual, costo_promedio, estado_stock
--   FROM public.v_inventario_stock ORDER BY nombre;
--
-- Prueba de humo del trigger (deja rastro; borrar el insumo después si molesta):
--   INSERT INTO public.inventario_insumos (nombre, unidad_base) VALUES ('PRUEBA', 'unidad');
--   INSERT INTO public.inventario_movimientos (insumo_id, tipo, cantidad, costo_unitario)
--     SELECT id, 'ENTRADA_COMPRA', 10, 1500 FROM public.inventario_insumos WHERE nombre = 'PRUEBA';
--   INSERT INTO public.inventario_movimientos (insumo_id, tipo, cantidad)
--     SELECT id, 'SALIDA_PRODUCCION', -3 FROM public.inventario_insumos WHERE nombre = 'PRUEBA';
--   -- Esperado: stock_actual = 7, costo_promedio = 1500, y la salida costeada a 1500.
