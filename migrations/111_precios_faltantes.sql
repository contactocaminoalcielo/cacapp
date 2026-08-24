-- 111 — Los precios que le faltaban al panel de costos.
--
-- 🩸 EL PANEL CONTABA DE MENOS, Y ESO ES PEOR QUE NO TENERLO: daba una cifra
-- creíble y equivocada. David lo cazó al comparar con el Console de Anthropic.
--
-- Dos agujeros, los dos del mismo tipo — se instrumentó lo que se estaba
-- construyendo (el agente de WhatsApp y la voz) y se dio por hecho que era todo
-- lo que gastaba. No lo era:
--
--   1. `cuadres-ia.js` usa **claude-opus-4-8**, que NO tenía fila de precio.
--      Es el modelo más caro que se usa en Orbit ($5/$25 por millón) y le manda
--      el cuadre entero. Cada análisis desde Finanzas cuesta de verdad.
--   2. `ia.js` (cuadres y grupales) no registraba nada. Corregido en código.
--
-- Y una trampa que dejaba en CERO lo que sí se registraba: el modelo que viaja
-- en la petición puede llevar fecha (`claude-haiku-4-5-20251001`) mientras la
-- tabla guarda la clave corta (`claude-haiku-4-5`). No casaban, así que el
-- precio salía nulo y el costo, cero. Se normaliza en el código (`costos.js`),
-- no aquí: mantener dos filas por modelo es garantizar que un día se olvide una.

BEGIN;

INSERT INTO public.costos_precios (proveedor, clave, concepto, usd, por, vigente_desde, nota) VALUES
  ('ANTHROPIC', 'claude-opus-4-8', 'ENTRADA',          5.00, 'MILLON', DATE '2026-01-01',
   'Lo usa el análisis de cuadres en Finanzas. El más caro que se usa en Orbit.'),
  ('ANTHROPIC', 'claude-opus-4-8', 'SALIDA',          25.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-opus-4-8', 'CACHE_ESCRITURA', 10.00, 'MILLON', DATE '2026-01-01', 'Caché de 1 hora'),
  ('ANTHROPIC', 'claude-opus-4-8', 'CACHE_LECTURA',    0.50, 'MILLON', DATE '2026-01-01', NULL),

  -- Por si algún día se usan desde aquí, para que no vuelvan a salir en cero.
  ('ANTHROPIC', 'claude-opus-4-7', 'ENTRADA',          5.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-opus-4-7', 'SALIDA',          25.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-sonnet-4-6', 'ENTRADA',        3.00, 'MILLON', DATE '2026-01-01', NULL),
  ('ANTHROPIC', 'claude-sonnet-4-6', 'SALIDA',        15.00, 'MILLON', DATE '2026-01-01', NULL)
ON CONFLICT DO NOTHING;

COMMIT;
