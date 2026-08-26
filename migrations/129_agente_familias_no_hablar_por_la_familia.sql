-- 129 — FAMILIAS: no hablar en primera persona por la familia, y marcar el reclamo.
--
-- Probando el caso de una familia molesta ("ya les mandé todo hace 5 días y
-- nadie me dice nada, me tienen aburrido"), el agente contestó:
--
--   "Entiendo la frustración. Llevo 5 días esperando respuesta y eso genera
--    inquietud."
--
-- "Llevo" — habla como si el que esperara fuera él. A una familia ya molesta eso
-- le suena a burla o a que el bot se enredó. Nace de repetir la queja para
-- mostrar que la entendió (regla 8) sin cambiar de sujeto.
--
-- Y ese mismo mensaje se etiquetó FAM_SERVICIO cuando era FAM_RECLAMO: la queja
-- manda sobre el tema del que se queja, porque decide quién la mira primero.

BEGIN;

INSERT INTO public.agente_wa_reglas (agente_id, texto, orden)
SELECT a.id, x.texto, x.orden
FROM public.agente_wa a
CROSS JOIN (VALUES
  (11, 'Al reconocer lo que te dicen, habla SIEMPRE de la otra persona, nunca en primera persona por ella. Se dice "entiendo que llevas cinco días esperando", jamás "llevo cinco días esperando". Repetir su queja poniéndote tú de sujeto suena a burla o a error, justo con quien ya está molesto.'),
  (12, 'Si la familia expresa molestia, reclamo o cansancio, la etiqueta es FAM_RECLAMO aunque el tema sea imágenes, entrega o cualquier otro. La queja manda sobre el asunto del que se queja: es lo que decide quién la atiende primero.')
) AS x(orden, texto)
WHERE a.clave = 'FAMILIAS'
  AND NOT EXISTS (
    SELECT 1 FROM public.agente_wa_reglas r
    WHERE r.agente_id = a.id AND r.orden = x.orden
  );

COMMIT;
