-- 108 — Control de costos de la IA y de la mensajería.
--
-- 🩸 POR QUÉ EXISTE ESTO: el 2026-08-21 se agotó el saldo de la API de Claude y
-- nadie se enteró hasta que una clínica escribió y el agente no contestó. No
-- había forma de ver cuánto se estaba gastando ni en qué — el Console de
-- Anthropic dice el total, pero no si se fue en el chat, en una llamada o en una
-- campaña. Esta tabla es el libro de cuentas propio.
--
-- Son DOS tablas a propósito:
--   · `costos_precios` — la lista de precios, editable sin desplegar. Los
--     precios de los modelos cambian (Sonnet 5 tiene tarifa de lanzamiento
--     hasta el 31-ago) y no se puede depender de un número quemado en el
--     código para calcular plata.
--   · `costos_uso`    — un renglón por cada cosa que costó dinero, con las
--     cantidades REALES que devolvió el proveedor, no estimadas.
--
-- El costo se calcula y se GUARDA en el renglón. Recalcularlo al consultar
-- sería más elegante y estaría mal: si mañana sube el precio, lo que ya se
-- gastó no cambia de valor.

BEGIN;

-- ── Lista de precios ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.costos_precios (
  id            serial PRIMARY KEY,
  -- ANTHROPIC | ELEVENLABS | META
  proveedor     text NOT NULL,
  -- El modelo (`claude-sonnet-5`), la voz, o la categoría de Meta.
  clave         text NOT NULL,
  -- ENTRADA | SALIDA | CACHE_ESCRITURA | CACHE_LECTURA | CARACTER | MENSAJE
  concepto      text NOT NULL,
  usd           numeric(14,6) NOT NULL,
  -- Si el precio es por millón de unidades (tokens, caracteres) o por unidad.
  por           text NOT NULL DEFAULT 'MILLON'
                CHECK (por IN ('MILLON', 'UNIDAD')),
  -- Un precio no se edita: se añade otro con fecha posterior. Así el gasto de
  -- ayer se sigue explicando con el precio de ayer.
  vigente_desde date NOT NULL DEFAULT DATE '2026-01-01',
  nota          text,
  UNIQUE (proveedor, clave, concepto, vigente_desde)
);

-- ── Lo que se ha consumido ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.costos_uso (
  id              bigserial PRIMARY KEY,
  ocurrido_en     timestamptz NOT NULL DEFAULT now(),
  proveedor       text NOT NULL,
  -- CHAT | VOZ | CAMPANA | PRUEBA | SISTEMA — sin esto el total no dice nada
  -- accionable: lo que importa es si el gasto se va en atender clínicas o en
  -- una llamada de tres minutos.
  canal           text NOT NULL,
  agente_id       integer REFERENCES public.agente_wa(id) ON DELETE SET NULL,
  -- El contacto de WhatsApp, o el id de la llamada. Para poder ir del número
  -- caro a la conversación concreta.
  referencia      text,
  clave           text,
  tokens_entrada  integer       NOT NULL DEFAULT 0,
  tokens_salida   integer       NOT NULL DEFAULT 0,
  cache_escritura integer       NOT NULL DEFAULT 0,
  cache_lectura   integer       NOT NULL DEFAULT 0,
  caracteres      integer       NOT NULL DEFAULT 0,
  -- Mensajes de Meta, o cualquier cosa que se cobre por pieza.
  unidades        numeric(14,4) NOT NULL DEFAULT 0,
  costo_usd       numeric(14,6) NOT NULL DEFAULT 0,
  detalle         jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Para lo que se trae de una API por días (Meta) y hay que poder repetir la
  -- consulta sin duplicar el renglón. Nulo en lo que se registra al vuelo.
  origen_unico    text UNIQUE
);

CREATE INDEX IF NOT EXISTS ix_costos_uso_cuando    ON public.costos_uso (ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS ix_costos_uso_proveedor ON public.costos_uso (proveedor, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS ix_costos_uso_canal     ON public.costos_uso (canal, ocurrido_en DESC);

-- ── Precios de arranque ───────────────────────────────────────────────────
--
-- Tarifas oficiales de Anthropic. Dos cosas que no son obvias y que si se
-- quedan fuera desvían la cuenta un 30-40 %:
--
--   · La CACHÉ no es gratis. Escribir en caché con vida de 1 hora —que es la
--     que usa el agente— cuesta el DOBLE que la entrada normal; leerla cuesta
--     la décima parte. Como el contexto son 24 KB y se relee en cada turno, la
--     lectura de caché es la mayor parte del gasto real del chat.
--   · Sonnet 5 tiene tarifa de lanzamiento hasta el 31-ago-2026. Por eso van
--     dos juegos de precios con fecha: el 1-sept sube solo, sin tocar nada.
INSERT INTO public.costos_precios (proveedor, clave, concepto, usd, por, vigente_desde, nota) VALUES
  ('ANTHROPIC', 'claude-sonnet-5', 'ENTRADA',         2.00, 'MILLON', DATE '2026-01-01', 'Tarifa de lanzamiento, hasta el 31-ago-2026'),
  ('ANTHROPIC', 'claude-sonnet-5', 'SALIDA',         10.00, 'MILLON', DATE '2026-01-01', 'Tarifa de lanzamiento, hasta el 31-ago-2026'),
  ('ANTHROPIC', 'claude-sonnet-5', 'CACHE_ESCRITURA', 4.00, 'MILLON', DATE '2026-01-01', 'Caché de 1 hora: el doble de la entrada'),
  ('ANTHROPIC', 'claude-sonnet-5', 'CACHE_LECTURA',   0.20, 'MILLON', DATE '2026-01-01', 'Una décima parte de la entrada'),
  ('ANTHROPIC', 'claude-sonnet-5', 'ENTRADA',         3.00, 'MILLON', DATE '2026-09-01', 'Precio de lista'),
  ('ANTHROPIC', 'claude-sonnet-5', 'SALIDA',         15.00, 'MILLON', DATE '2026-09-01', 'Precio de lista'),
  ('ANTHROPIC', 'claude-sonnet-5', 'CACHE_ESCRITURA', 6.00, 'MILLON', DATE '2026-09-01', 'Caché de 1 hora: el doble de la entrada'),
  ('ANTHROPIC', 'claude-sonnet-5', 'CACHE_LECTURA',   0.30, 'MILLON', DATE '2026-09-01', 'Una décima parte de la entrada'),

  ('ANTHROPIC', 'claude-opus-5',   'ENTRADA',         5.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-opus-5',   'SALIDA',         25.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-opus-5',   'CACHE_ESCRITURA',10.00, 'MILLON', DATE '2026-01-01', 'Caché de 1 hora'),
  ('ANTHROPIC', 'claude-opus-5',   'CACHE_LECTURA',   0.50, 'MILLON', DATE '2026-01-01', NULL),

  ('ANTHROPIC', 'claude-haiku-4-5','ENTRADA',         1.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-haiku-4-5','SALIDA',          5.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-haiku-4-5','CACHE_ESCRITURA', 2.00, 'MILLON', DATE '2026-01-01', 'Caché de 1 hora'),
  ('ANTHROPIC', 'claude-haiku-4-5','CACHE_LECTURA',   0.10, 'MILLON', DATE '2026-01-01', NULL)
ON CONFLICT DO NOTHING;

-- ⚠️ ELEVENLABS VA EN CERO A PROPÓSITO. Su facturación es por créditos de un
-- plan, no por caracteres sueltos, y el precio depende del plan contratado. Un
-- número inventado aquí saldría en la pantalla como si fuera dinero de verdad.
-- Los caracteres SÍ se cuentan desde el primer día; el panel muestra además la
-- cuota real que devuelve su API. Cuando David ponga el precio de su plan, el
-- gasto de ahí en adelante queda valorado.
INSERT INTO public.costos_precios (proveedor, clave, concepto, usd, por, vigente_desde, nota) VALUES
  ('ELEVENLABS', 'eleven_flash_v2_5', 'CARACTER', 0, 'MILLON', DATE '2026-01-01',
   'Sin precio todavía: depende del plan. Los caracteres se cuentan igual.')
ON CONFLICT DO NOTHING;

-- ⚠️ META FACTURA EN PESOS COLOMBIANOS, no en dólares (comprobado: el campo
-- `currency` de la WABA dice COP). Su API devuelve el costo ya calculado, así
-- que no hace falta lista de precios — pero SÍ hace falta convertirlo, porque
-- `costos_uso.costo_usd` es una sola moneda y meter pesos ahí sumaría peras con
-- manzanas y daría un total falso por miles de veces.
--
-- La tasa vive aquí para que sea UNA sola en todo el sistema (la pantalla del
-- agente tenía su propio 4000 quemado en el código) y para que David la pueda
-- corregir sin desplegar. El importe original en pesos se guarda igual en el
-- detalle del renglón: convertir no debe perder el dato de partida.
INSERT INTO public.costos_precios (proveedor, clave, concepto, usd, por, vigente_desde, nota) VALUES
  ('SISTEMA', 'TRM', 'COP_POR_USD', 4000, 'UNIDAD', DATE '2026-01-01',
   'Pesos por dólar. Aproximada: sirve para dar magnitud, no para contabilidad.')
ON CONFLICT DO NOTHING;

-- ── Permisos ──────────────────────────────────────────────────────────────
-- El backend escribe como `orbit_backend`, NO como `postgres`. Sin esto el
-- INSERT falla en silencio y el panel sale vacío sin decir por qué.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.costos_uso     TO orbit_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.costos_precios TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.costos_uso_id_seq            TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.costos_precios_id_seq        TO orbit_backend;

-- Nadie más entra: estas tablas no se exponen por PostgREST, solo por el
-- backend, que ya autentica y comprueba el rol.
REVOKE ALL ON TABLE public.costos_uso     FROM anon, authenticated;
REVOKE ALL ON TABLE public.costos_precios FROM anon, authenticated;

COMMIT;
