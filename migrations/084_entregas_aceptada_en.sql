-- 084 — Entregas: hora en que el mensajero salió a entregar
--
-- La entrega ya deja traza de cuándo se publicó al pool (`publicada_en`), cuándo
-- la tomó alguien (`tomada_en`, migración 083) y cuándo se completó
-- (`fecha_realizada` + `hora_realizada`), pero NO de cuándo el mensajero aceptó y
-- salió: ese paso solo movía `estado` a EN_CAMINO. Sin eso no se puede decir
-- cuánto tardó entre salir y entregar, que es lo que se quiere ver en el tablero.
--
-- Se guarda como timestamptz (no date+time como fecha/hora_realizada) porque es
-- un instante que estampa la app, no un dato que alguien escriba.

BEGIN;

ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS aceptada_en timestamptz;

COMMENT ON COLUMN public.entregas.aceptada_en IS 'Cuándo el mensajero aceptó y salió a entregar (paso a EN_CAMINO). NULL en entregas anteriores a 2026-07-31.';

COMMIT;
