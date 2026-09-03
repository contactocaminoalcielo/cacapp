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
-- 🩸 2026-09-03 — ESTE ARCHIVO YA MINTIÓ UNA VEZ. La versión del 2-sep espejaba
--    un texto REDACTADO A PROPÓSITO para esta migración (823 UTF-16, títulos en
--    *_negrita cursiva_*, enlaces de Drive sin `?usp=sharing`, cierre con el
--    teléfono 3193585508) que NUNCA se subió a Meta. Lo aprobado era —y sigue
--    siendo— otro cuerpo distinto. Se reemplazó copiándolo carácter por carácter
--    desde `GET /{waba}/message_templates?name=envio_digitales_individual`.
--    🔑 El espejo se COPIA de Meta, no se escribe a mano. Fuente de verdad:
--    WABA 1048633974692786 (familias) · plantilla id 905396532645818 · APPROVED.
--
-- Presupuesto de Meta (1024 de cuerpo con los parámetros ya resueltos, el
-- rechazo asíncrono #132005 de la 040) — recalculado sobre el cuerpo APROBADO:
--   cuerpo crudo                                863 chars (879 en unidades UTF-16)
--   {{1}} video   https://www.youtube.com/watch?v=…   43
--   {{2}} short   https://www.youtube.com/shorts/…    42
--   {{3}} memorial https://www.instagram.com/reel/…/  43
--   resuelto, peor caso                         992 UTF-16 → solo 32 de margen
-- ⚠️ Los enlaces de Drive del cuerpo aprobado SÍ llevan `?usp=sharing`. Quitarlos
--    libera 24, pero eso hay que cambiarlo EN META primero, no aquí.
-- Antes de alargar el texto en Meta, rehacer esta cuenta: quedan 32 caracteres.
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
      'texto', $txt$🌷 Buen día, te habla ValerIA de Camino al Cielo

Con mucho respeto y cariño, queremos entregarte los recuerdos digitales correspondientes a tu plan personalizado, preparados para honrar la memoria de tu mascotica 🤍🐾.

🎬 *Video conmemorativo:*
👉 Ver video: {{1}}

▶️ *Short de YouTube:*
👉 Ver short: {{2}}

🕊️ *Memorial digital:*
👉 Ver memorial: {{3}}

🎶 *Audio de despedida:*
👉 Escuchar audio: https://drive.google.com/drive/folders/1mxrnBgjKZSZofe_vA9azlUjcf1w46UEH?usp=sharing

📖 *Herramientas de apoyo para el proceso de duelo:*
👉 Ver recursos: https://drive.google.com/drive/folders/1cct2JVjDert-VS0MNVnpGRAhkt0SSCiZ?usp=sharing

🙏 *Tarjeta de oración:*
👉 Ver tarjeta: https://vt.tiktok.com/ZSMXPYkf8/

Esperamos que estos recuerdos sean una forma especial de conservar su amor y su huella en el corazón.
Gracias por permitirnos acompañarte en este proceso 🤍🐾$txt$,
      'cubre', jsonb_build_array(
        'a1cd8abf-f6e5-4c8e-a307-de91feb60866',  -- Audio de despedida
        'c74becc1-df53-489a-aeb4-73ca73e1da15',  -- Herramientas de superación de duelo
        'cdc44e4e-7c28-463a-8f7b-62af99af6cd9'   -- Tarjeta de oración
      )
    ),
    descripcion = 'Plantilla HSM para servicios con los 3 digitales. {{1}} video · {{2}} short · {{3}} memorial. `texto` es espejo del cuerpo aprobado en Meta (evidencia y vista previa) y `cubre` los recordatorios de enlace fijo que entrega — AMBOS deben editarse a la par de la plantilla en Meta.'
WHERE modulo = 'DIGITALES' AND clave = 'plantilla_completos';

COMMIT;
