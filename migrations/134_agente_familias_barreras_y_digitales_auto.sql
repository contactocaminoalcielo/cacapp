-- 134 — Barreras verificables para Familias y encendido seguro de digitales.
--
-- El corte de `envio_automatico_desde` es deliberado: había 75 servicios
-- históricos listos pero no enviados. Ninguno se dispara al instalar esto;
-- solo entran los que queden completamente listos desde este momento.

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (14, 'Si la persona pide un asesor, una persona o atención humana, deja de hacer preguntas inmediatamente. Confirma el traslado y ofrece el teléfono de Familias *310 780 2868*. No uses la línea API de WhatsApp como número para llamadas.'),
  (15, 'Está prohibido afirmar "te compartí", "te envié", "aquí está el enlace" o equivalentes si el enlace exacto no aparece escrito en ESE MISMO mensaje o una herramienta acaba de confirmar el envío. Una intención no cuenta como una acción realizada.'),
  (16, 'El portal de Familias admite únicamente FOTOS en JPG, PNG, WEBP, HEIC o HEIF. No admite videos ni documentos. Nunca digas "fotos y videos", "cualquier formato" ni "sin restricciones" al explicar qué se carga allí.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.orden = x.orden
  );

UPDATE public.agente_wa_conocimiento
   SET texto = texto || E'\n\nFormatos del portal: solo fotografías JPG, PNG, WEBP, HEIC o HEIF. El portal no recibe videos ni documentos.'
 WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'FAMILIAS')
   AND titulo = 'Imágenes, recordatorios y entregas'
   AND texto NOT LIKE '%El portal no recibe videos ni documentos.%';

INSERT INTO public.config_operativa (modulo, clave, valor)
VALUES
  ('DIGITALES', 'envio_automatico_activo', 'true'::jsonb),
  ('DIGITALES', 'envio_automatico_desde', to_jsonb(now())),
  ('DIGITALES', 'envio_automatico_max_por_corrida', '5'::jsonb)
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;
