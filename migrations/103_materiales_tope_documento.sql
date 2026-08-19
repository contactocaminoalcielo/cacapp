-- 103 — El tope de un material sube de 16 a 64 MB
--
-- La 101 dejó el tope escrito en un CHECK: `bytes <= 16777216`. Al subir el
-- tope de documento a 64 MB (porque el de 16 era nuestro y no de Meta, que
-- admite 100), este CHECK quedó siendo el más bajo de la cadena y devolvía un
-- "Error interno" — la peor forma de rechazar algo, porque no dice qué pasó.
--
-- 🩸 LA LECCIÓN: **un archivo atraviesa CINCO topes** y el más bajo manda:
--   1. Cloudflare (100 MB)
--   2. nginx `client_max_body_size`   ← estaba en el defecto: 1 MB
--   3. `express.json` por prefijo
--   4. `CLASES.document` en whatsapp-media.js  ← el único que da un mensaje claro
--   5. **este CHECK**
-- Subir uno solo no sirve de nada. Ver la nota `tope_subida_archivos_413`.
--
-- Se deja en 64 MB, igual que `CLASES.document`, y NO en los 100 que admite
-- Meta: un PDF enorme por WhatsApp es un PDF que la clínica no descarga con
-- datos móviles. Si algún día se mueve el de arriba, hay que mover este.

BEGIN;

ALTER TABLE public.whatsapp_materiales
  DROP CONSTRAINT IF EXISTS whatsapp_materiales_bytes_chk;

ALTER TABLE public.whatsapp_materiales
  ADD CONSTRAINT whatsapp_materiales_bytes_chk
  -- 64 MB. Tiene que coincidir con `CLASES.document` en whatsapp-media.js.
  CHECK (bytes > 0 AND bytes <= 67108864);

COMMIT;
