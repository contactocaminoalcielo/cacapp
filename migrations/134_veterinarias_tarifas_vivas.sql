-- 134 — VETERINARIAS deja de llevar las tarifas escritas en el prompt.
--
-- El agente de veterinarias cargaba una tabla de precios ESTÁTICA dentro de su
-- base de conocimiento: 965 tokens en cada turno, y —lo que de verdad importa—
-- **un precio que se queda viejo en silencio**. Si alguien cambia una tarifa en
-- el catálogo, el agente sigue diciendo la anterior hasta que un humano se
-- acuerde de editar el texto. Es la misma trampa que ya nos mordió con las
-- tarifas por especie: el precio vivía en dos sitios y uno de los dos mentía.
--
-- FAMILIAS nunca tuvo ese problema porque consulta el catálogo con
-- `consultar_tarifas`. Aquí se le da la misma herramienta.
--
-- Comprobado antes de tocar nada: el catálogo vivo (`v_precios_por_peso`)
-- devuelve HOY exactamente los mismos números que la tabla escrita —Eco-grupal
-- 79/99/109/139/169/229, Básico 139/169/189/219/289/389—, así que esto no
-- cambia ni un precio: cambia de dónde salen.
--
-- Lo que SÍ se queda en el prompt es "Cómo se calcula el precio": qué especie
-- paga por rango de peso, cuál paga tarifa FELINO y cuál PETIT. Eso es criterio,
-- no dato: la herramienta lo necesita para saber qué preguntar.

BEGIN;

INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, orden)
SELECT a.id, 'consultar_tarifas', true, 0
FROM public.agente_wa a
WHERE a.clave = 'VETERINARIAS'
ON CONFLICT (agente_id, clave) DO UPDATE SET activa = true;

-- Corta el texto justo antes de "## Tarifas por plan" y deja solo el criterio.
UPDATE public.agente_wa_conocimiento
   SET titulo = 'Cómo se calcula el precio',
       texto  = rtrim(substring(texto FROM 1 FOR position('## Tarifas por plan' IN texto) - 1), E' \n-')
              || E'\n\nLos precios NO están escritos aquí: se consultan con `consultar_tarifas`, que lee el\n'
              || E'catálogo vivo. Necesita la especie y el peso aproximado. Nunca cites un valor de\n'
              || E'memoria ni lo estimes — si la herramienta no devuelve tarifa, dilo y escala.'
 WHERE agente_id = (SELECT id FROM public.agente_wa WHERE clave = 'VETERINARIAS')
   AND titulo = 'Planes y tarifas'
   AND position('## Tarifas por plan' IN texto) > 0;

COMMIT;
