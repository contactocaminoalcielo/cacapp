-- 212 · Nombre del recordatorio para la familia
--
-- La portada del portal de fotos ("lo que incluye tu plan") muestra cada
-- recordatorio con el nombre de las piezas de cada plan, que es el que la
-- familia conoce. En el catálogo algunos tienen nombre interno. Confirmados
-- por David el 2026-11-19:
--   Huella corazón     → Amuleto huellita
--   Portarretrato      → Cristal con fotografía y dedicatoria
--   Planta compostaje  → Planta con el abono de tu mascotica
--   Photobook          → Mi foto aventura (photobook)
-- `nombre` NO se toca: lo usan producción, Kanban, recibos y certificados.
-- Vacío = se muestra `nombre`.
--
-- El backend lo lee con to_jsonb(r)->>'nombre_cliente', así que puede
-- desplegarse antes o después de esta migración sin romperse.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.recordatorios ADD COLUMN IF NOT EXISTS nombre_cliente text;

UPDATE public.recordatorios r SET nombre_cliente = v.cliente
  FROM (VALUES
    ('Huella corazón',    'Amuleto huellita'),
    ('Portarretrato',     'Cristal con fotografía y dedicatoria'),
    ('Planta compostaje', 'Planta con el abono de tu mascotica'),
    ('Photobook',         'Mi foto aventura (photobook)'),
    -- Mismo criterio: el nombre (y las tildes) de las piezas de cada plan
    ('Capsula de recuerdos',    'Cápsula de recuerdos'),
    ('Huella y mechon',         'Huellita y mechón'),
    ('Dia de amor y milagrino', 'Día de amor milagrinos'),
    ('Memorial digital',        'Memorial Camino al Cielo'),
    ('Short YouTube',           'Short de YouTube'),
    ('Postal personalizada',    'Dos postales personalizadas'),
    ('Planta bonsái',           'Bonsái'),
    ('Huella 3D',               'Huella en relieve 3D'),
    ('Asesoría duelo',          'Consulta de asesoría psicológica en duelo'),
    ('Certificado compostaje',  'Certificado de compostaje digital')
  ) AS v(interno, cliente)
 WHERE r.nombre = v.interno AND r.nombre_cliente IS NULL;

-- Descripciones: ahora las lee la familia (portada del portal, catálogo
-- público, ofertas). Estas siete estaban escritas para uso interno
-- ("se toma en el ingreso al cuarto frío"). Textos aprobados por David 2026-11-19.
UPDATE public.recordatorios r SET descripcion = v.texto
  FROM (VALUES
    ('Capsula de recuerdos',                'Una caja especial para guardar juntos todos sus recuerdos.'),
    ('Huella y mechon',                     'Tomamos su huellita y guardamos un mechón de su pelo en un frasquito de vidrio.'),
    ('Huella corazón',                      'Su huellita en madera, en forma de amuleto para llevarla siempre contigo.'),
    ('Soporte lazos de amor',               'Un soporte decorativo para el frasquito con su mechón.'),
    ('Dia de amor y milagrino',             'Un folleto con la información de nuestra fundación aliada.'),
    ('Herramientas de superación de duelo', 'Audios, textos e imágenes para acompañarte en el duelo.'),
    ('Evidencias de conservación',          'Una imagen que confirma que recibimos y cuidamos a tu mascotica en nuestras instalaciones.')
  ) AS v(interno, texto)
 WHERE r.nombre = v.interno;

-- Verificación: deben salir las 14 filas.
SELECT nombre, nombre_cliente FROM public.recordatorios WHERE nombre_cliente IS NOT NULL ORDER BY nombre;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- ROLLBACK manual:
--   ALTER TABLE public.recordatorios DROP COLUMN nombre_cliente;
