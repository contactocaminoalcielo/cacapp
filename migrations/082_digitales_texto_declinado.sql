-- 082 — Digitales: texto que reemplaza el enlace de una pieza que el cliente declinó
--
-- Hasta ahora, si el cliente marcaba "no deseo este recordatorio" en el portal de
-- imágenes (fila en servicio_recordatorios.estado = 'NA'), la combinación de piezas
-- dejaba de encajar en las dos plantillas aprobadas (3 digitales / solo memorial) y
-- el servicio caía al envío MANUAL — pasó con ZEUS (16-jul) y MISSI (23-jul).
--
-- Decisión David 2026-07-31: no crear plantillas nuevas en Meta. El plan no cambió
-- por que el cliente declinara una pieza, así que se manda LA MISMA plantilla y en
-- el parámetro de esa pieza va este texto en vez del enlace. Meta acepta cualquier
-- texto en un parámetro; lo que rechaza es un parámetro VACÍO.
--
-- ⚠️ El texto no puede llevar saltos de línea ni tabs (el backend los colapsa) y
--    debe leerse bien después de la frase fija de la plantilla:
--      «👉 Ver video: (no lo solicitaste)»
-- ⚠️ Es MÁS CORTO que una URL, así que no acerca la plantilla al límite de 1024
--    chars de Meta (ver 040 y el fix del #132005 de 2026-07-14).
--
-- Si esta fila no existe, el backend usa el mismo valor por defecto: vive aquí
-- para poder ajustar el tono sin desplegar.

BEGIN;

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion)
VALUES (
  'DIGITALES',
  'texto_declinado',
  '"(no lo solicitaste)"'::jsonb,
  'Texto que ve el cliente donde iría el enlace de un digital que él mismo declinó en el portal de imágenes. Permite usar la plantilla del plan completo aunque falte una pieza. Sin saltos de línea (Meta rechaza el parámetro).'
)
ON CONFLICT (modulo, clave) DO UPDATE
SET valor = EXCLUDED.valor,
    descripcion = EXCLUDED.descripcion;

COMMIT;
