-- 080 · OREO: era un cobayo registrado como "Hámster" (2026-07-29)
--
-- Ingresó el 29-jul con 2,00 kg y especie Hámster. Un hámster no llega a 2 kg;
-- es un cobayo. Con la especie vieja no entraba al rango FELINO y pagaba el
-- rango 1-10KG de perro: ECO_GRUPAL $109.000 en vez de $99.000.
--
-- Va con la migración 079, que crea la especie Cobayo con tarifa FELINO.
-- Servicio 160c30ea-ebd6-4706-b4af-2364b3a35263 (EN_CUARTO_FRIO, sin aliado,
-- sin pagos: valor_pagado = 0, así que `estado_pago` sigue en PENDIENTE).

BEGIN;

UPDATE public.mascotas
   SET especie_id = (SELECT id FROM public.especies WHERE nombre = 'Cobayo')
 WHERE id_mascota = '45229965-192c-4977-862d-9411922e0056';

UPDATE public.servicios
   SET valor_plan  = 99000,
       valor_total = 99000
 WHERE id = '160c30ea-ebd6-4706-b4af-2364b3a35263'
   AND valor_total = 109000;   -- no tocar si ya lo movieron a mano

INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT '160c30ea-ebd6-4706-b4af-2364b3a35263', 'RECATEGORIZACION_PESO',
       chr(240) || chr(159) || chr(144) || chr(190) ||
       ' Precio recategorizado por cambio de especie (Cremacion Grupal Eco, 2 kg): ' ||
       'especie Hamster -> Cobayo, valor $109.000 -> $99.000.'
WHERE EXISTS (SELECT 1 FROM public.servicios
               WHERE id = '160c30ea-ebd6-4706-b4af-2364b3a35263' AND valor_total = 99000);

COMMIT;

-- Verificación:
--   SELECT m.nombre, e.nombre AS especie, m.peso_kg, s.valor_plan, s.valor_total, s.estado_pago
--     FROM servicios s JOIN mascotas m ON m.id_mascota = s.mascota_id
--     JOIN especies e ON e.id = m.especie_id
--    WHERE s.id = '160c30ea-ebd6-4706-b4af-2364b3a35263';
