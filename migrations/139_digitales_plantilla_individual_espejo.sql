-- 139 — Digitales: cuerpo de `envio_digitales_individual` (los 3 digitales).
--
-- La 040 dejó esta plantilla con solo nombre/idioma/categoría: sin `texto`, el
-- backend cae a `construirMensajeCliente` y tanto la vista previa del módulo
-- como la evidencia de `digitales_envios.mensaje` muestran "• Video: … • Short:
-- … • Memorial: …" en vez de la plantilla que de verdad recibe el cliente. Es
-- el mismo hueco que la 055 cerró para `envio_digitales` (memorial solo).
--
-- ⚠️ APLICAR SOLO DESPUÉS de que este mismo texto esté APROBADO en Meta, y
--    carácter por carácter: `texto` es un espejo manual (la API de GHL no expone
--    el cuerpo, 401 en /businesses/templates). Si difiere, la evidencia miente.
--
-- Presupuesto de Meta (1024 chars de cuerpo + parámetros ya resueltos, el
-- rechazo asíncrono #132005 de la 040):
--   cuerpo crudo                                807 chars (823 en unidades UTF-16)
--   {{1}} video   https://www.youtube.com/watch?v=…   43
--   {{2}} short   https://www.youtube.com/shorts/…    42
--   {{3}} memorial https://www.instagram.com/reel/…/  43
--   resuelto, peor caso                         920 chars (936 UTF-16) → 88 de margen
-- Los enlaces de Drive van SIN `?usp=sharing` (−24 chars): la carpeta abre igual.
-- Antes de alargar el texto en Meta, rehacer esta cuenta.
--
-- `cubre`: los tres recordatorios de enlace fijo que la plantilla entrega en su
-- propio cuerpo, igual que en la 055. Los planes de 3 digitales llevan audio y
-- tarjeta de oración; los que no lleven herramientas de superación simplemente
-- no tienen la fila y el UPDATE no los toca.
--
-- Sin backfill a propósito: no sabemos qué decía el cuerpo anterior aprobado en
-- Meta, así que marcar como ENTREGADOS los envíos históricos de esta plantilla
-- sería inventar evidencia. Los que ya salieron se revisan a mano si hace falta.

BEGIN;

UPDATE public.config_operativa
SET valor = jsonb_build_object(
      'nombre',    'envio_digitales_individual',
      'idioma',    'es_MX',
      'categoria', 'UTILITY',
      'texto', $txt$🌷 Buen día, te habla ValerIA de *Camino al Cielo*
Me complace entregarte los recordatorios digitales de tu plan, preparados con todo el respeto y cariño para honrar la memoria de tu mascota🤍🐾.

🎬 *_Video conmemorativo:_*
👉 {{1}}

✨ *_Short:_*
👉 {{2}}

🌸 *_Memorial digital:_*
👉 {{3}}

🎶 *_Audio de despedida:_*
👉 https://drive.google.com/drive/folders/1mxrnBgjKZSZofe_vA9azlUjcf1w46UEH

📖 *_Herramientas de superación de duelo:_*
👉 https://drive.google.com/drive/folders/1cct2JVjDert-VS0MNVnpGRAhkt0SSCiZ

🙏 *_Tarjeta de oración:_*
👉 https://vt.tiktok.com/ZSMXPYkf8/

Con esto damos por finalizada la entrega de los recordatorios digitales incluidos en tu plan.
Gracias de corazón por permitirnos acompañarte en este momento tan especial 💜🐾.

Para cualquier información adicional, comunícate al *3193585508*$txt$,
      'cubre', jsonb_build_array(
        'a1cd8abf-f6e5-4c8e-a307-de91feb60866',  -- Audio de despedida
        'c74becc1-df53-489a-aeb4-73ca73e1da15',  -- Herramientas de superación de duelo
        'cdc44e4e-7c28-463a-8f7b-62af99af6cd9'   -- Tarjeta de oración
      )
    ),
    descripcion = 'Plantilla HSM para servicios con los 3 digitales. {{1}} video · {{2}} short · {{3}} memorial. `texto` es espejo del cuerpo aprobado en Meta (evidencia y vista previa) y `cubre` los recordatorios de enlace fijo que entrega — AMBOS deben editarse a la par de la plantilla en Meta.'
WHERE modulo = 'DIGITALES' AND clave = 'plantilla_completos';

COMMIT;
