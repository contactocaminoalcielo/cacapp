-- 132 — FAMILIAS: español de Colombia, sin voseo.
--
-- Detectado en el tráfico real de la primera media hora en vivo: 2 de 8
-- respuestas salieron con voseo rioplatense — "cuando estés lista, ingresás al
-- enlace y cargás las fotos". A una familia bogotana eso le suena a que la
-- atiende alguien de otro país, y en un momento de duelo el detalle pesa.
--
-- Las instrucciones ya decían "habla de tú", pero en abstracto. Igual que con la
-- regla de apertura: escrita como la lista literal de las formas prohibidas y
-- sus reemplazos, se cumple; dicha en general, se cumple a ratos.

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (13, 'Escribes en español de COLOMBIA y siempre de TÚ. Está prohibido el voseo: se dice "ingresas", "cargas", "puedes", "tienes", "quieres", "necesitas", "cuéntame", "escríbeme", "dime" — nunca "ingresás", "cargás", "podés", "tenés", "querés", "necesitás", "contame", "escribime", "decime" ni "vos". Tampoco uses "ustedes" para hablarle a una sola persona.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.orden = x.orden
  );

COMMIT;
