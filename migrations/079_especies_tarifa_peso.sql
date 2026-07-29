-- 079 · Categoría de tarifa por especie (2026-07-29)
--
-- El precio de un plan sale de `planes_precios` por rango de peso, con una
-- excepción: el rango FELINO es una tarifa fija de mamífero pequeño desde 1 kg,
-- más barata que la de perro. Hasta hoy quién entraba a ese rango estaba
-- ESCRITO EN EL CÓDIGO (`src/lib/precios.js`: `especieId === 2 || especieId === 3`),
-- así que agregar una especie desde Configuración → Catálogos no cambiaba nada:
-- la especie nueva cobraba tarifa de perro.
--
-- Caso que lo destapó: un cobayo (curí, 0,7–1,5 kg) que se venía registrando
-- como "Hámster" y, por pasar de 1 kg, pagaba el rango 1-10KG de perro
-- ($109.000 en ECO_GRUPAL en vez de $99.000).
--
-- Ahora la categoría vive en el catálogo y se edita desde la app.
-- OJO: por debajo de 1 kg SIEMPRE manda PETIT, que es aún más barata — esta
-- columna solo decide qué pasa de 1 kg en adelante.

BEGIN;

ALTER TABLE public.especies
  ADD COLUMN IF NOT EXISTS tarifa_peso text NOT NULL DEFAULT 'ESTANDAR';

ALTER TABLE public.especies DROP CONSTRAINT IF EXISTS especies_tarifa_peso_check;
ALTER TABLE public.especies
  ADD CONSTRAINT especies_tarifa_peso_check CHECK (tarifa_peso IN ('ESTANDAR', 'FELINO'));

COMMENT ON COLUMN public.especies.tarifa_peso IS
  'ESTANDAR = precio por rango de peso (tarifa perro). FELINO = tarifa fija de mamífero pequeño de 1 kg en adelante. Por debajo de 1 kg siempre manda PETIT.';

-- Lo que hacía el hardcode: Gato y Conejo.
-- Reptil se suma por decisión de David (2026-07-29). Hámster, Ave y Pez se
-- quedan por peso: los registrados pesan menos de 1 kg y caen en PETIT.
UPDATE public.especies SET tarifa_peso = 'FELINO' WHERE nombre IN ('Gato', 'Conejo', 'Reptil');

INSERT INTO public.especies (nombre, tarifa_peso) VALUES ('Cobayo', 'FELINO')
  ON CONFLICT (nombre) DO UPDATE SET tarifa_peso = 'FELINO';

COMMIT;

-- Verificación:
--   SELECT id, nombre, tarifa_peso FROM especies ORDER BY id;
