-- 077_afiliaciones_descuentos.sql — Descuentos en afiliaciones pre-exequiales.
-- Reglas cerradas con David 2026-07-29:
--   · 25 % por RENOVAR ANTES del vencimiento (sin importar cuántas mascotas).
--   · 25 % por cubrir MÁS DE UNA mascota en el mismo plan (afiliación nueva).
--   · 10 % por renovar varias mascotas DESPUÉS del vencimiento.
--   · Nunca se suman: si aplican varios, se toma el MAYOR.
--   · Los tres porcentajes se editan en Configuración › Afiliaciones (0 = apagado).
--
-- Modelo del dinero (una sola fuente por cifra, como el resto del módulo):
--   · `valor`       sigue siendo lo que el cliente PAGA por mascota (todo lo que ya
--                   lee plata — lista, ficha, total, recibos — no cambia de sentido).
--   · `valor_lista` es el precio de lista unitario ANTES del descuento.
--   · `descuento_pct` / `descuento_motivo` son la traza de por qué difieren.
-- La cláusula de activación 5×/3× se calcula sobre `valor_lista` (decisión de David):
-- el descuento abarata la afiliación, no la activación.

BEGIN;

ALTER TABLE public.afiliacion_contratos
  ADD COLUMN IF NOT EXISTS descuento_pct    numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_motivo text,
  ADD COLUMN IF NOT EXISTS valor_lista      numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afil_contratos_descuento_pct_rango') THEN
    ALTER TABLE public.afiliacion_contratos
      ADD CONSTRAINT afil_contratos_descuento_pct_rango
      CHECK (descuento_pct >= 0 AND descuento_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afil_contratos_descuento_motivo_valido') THEN
    ALTER TABLE public.afiliacion_contratos
      ADD CONSTRAINT afil_contratos_descuento_motivo_valido
      CHECK (descuento_motivo IS NULL OR descuento_motivo IN (
        'RENOVACION_ANTICIPADA', 'MULTIPLES_MASCOTAS', 'RENOVACION_MULTIPLE_TARDIA', 'MANUAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afil_contratos_valor_lista_no_negativo') THEN
    ALTER TABLE public.afiliacion_contratos
      ADD CONSTRAINT afil_contratos_valor_lista_no_negativo
      CHECK (valor_lista IS NULL OR valor_lista >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.afiliacion_contratos.valor IS
  'Precio POR MASCOTA que el cliente pagó, ya con descuento aplicado. Total = valor × nº mascotas (se calcula, no se guarda).';
COMMENT ON COLUMN public.afiliacion_contratos.valor_lista IS
  'Precio de lista POR MASCOTA antes del descuento. Base de la cláusula de activación 5×/3×.';
COMMENT ON COLUMN public.afiliacion_contratos.descuento_pct IS
  'Descuento aplicado a este contrato (0 = sin descuento). Nunca se acumulan varios: se guarda el mayor.';
COMMENT ON COLUMN public.afiliacion_contratos.descuento_motivo IS
  'Por qué se dio el descuento: RENOVACION_ANTICIPADA | MULTIPLES_MASCOTAS | RENOVACION_MULTIPLE_TARDIA | MANUAL.';

-- Histórico: todos los contratos previos se firmaron sin descuento, así que su
-- precio de lista es exactamente lo que pagaron. Con esto la cláusula 5×/3× de
-- los contratos viejos sigue dando el mismo número que hoy.
UPDATE public.afiliacion_contratos
   SET valor_lista = valor
 WHERE valor_lista IS NULL;

-- ── Porcentajes editables desde Configuración › Afiliaciones ────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('AFILIACIONES', 'descuento_renovacion_anticipada', '25'::jsonb,
   'Descuento (%) por renovar el contrato en o antes de la fecha de vencimiento. 0 = desactivado.'),
  ('AFILIACIONES', 'descuento_multiples_mascotas', '25'::jsonb,
   'Descuento (%) cuando el contrato cubre más de una mascota en el mismo plan. 0 = desactivado.'),
  ('AFILIACIONES', 'descuento_renovacion_multiple_tardia', '10'::jsonb,
   'Descuento (%) por renovar un contrato de más de una mascota DESPUÉS del vencimiento. 0 = desactivado.')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;
