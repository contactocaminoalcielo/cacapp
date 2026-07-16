-- 055 — Digitales: espejo del cuerpo de la plantilla + recordatorios de enlace fijo
--
-- Dos problemas, misma raíz: el módulo solo conoce MEMORIAL/VIDEO/SHORT, pero la
-- plantilla `envio_digitales` (grupales) entrega además tres recordatorios con
-- enlace FIJO escrito en su propio cuerpo (audio de despedida, herramientas de
-- superación de duelo, tarjeta de oración).
--
--   1. EVIDENCIA: digitales_envios.mensaje guardaba un texto que arma Orbit
--      listando solo las piezas de piezas_digitales → "• Memorial: <url>".
--      El cliente recibe la plantilla completa (verificado 2026-07-16: la ventana
--      de 24 h estaba cerrada y el mensaje quedó `delivered`, cosa que Meta solo
--      hace con plantilla), pero en Orbit/Zolutium se leía como si se hubiera
--      enviado solo el memorial. Ahora `texto` es espejo del cuerpo aprobado.
--
--   2. ENTREGA: marcarDigitalesEntregados solo marcaba los 3 tipos conocidos →
--      ~80 servicios por recordatorio quedaron PENDIENTE en Producción y en el
--      certificado de entrega pese a que el cliente ya los recibió. Ahora `cubre`
--      declara los ids de enlace fijo y el backend los marca junto al memorial.
--
-- ⚠️ `texto` y `cubre` describen la plantilla APROBADA EN META y NO se pueden
--    derivar (la API de GHL no expone el cuerpo: 401 sobre /businesses/templates).
--    Si se edita la plantilla en Meta, hay que editarlos aquí a la par.
--
-- ⚠️ Margen de Meta: el cuerpo son 970 chars; con la URL del reel resuelta en
--    {{1}} queda en 1008 de los 1024 permitidos — 16 chars de margen. Un enlace
--    más y vuelve el rechazo asíncrono #132005 (ver 040 y el fix de 2026-07-14).
BEGIN;

-- ── 1. Espejo del cuerpo aprobado + recordatorios que la plantilla entrega ────
-- cubre = SOLO los de enlace fijo. El memorial NO va: es {{1}}, variable, y ya
-- se marca por `recordatorios_tipo`.
UPDATE public.config_operativa
SET valor = jsonb_build_object(
      'nombre',    'envio_digitales',
      'idioma',    'es',
      'categoria', 'UTILITY',
      'texto', $txt$🌷 Buen día, te habla ValerIA de *Camino al Cielo*
Me complace entregarte los recordatorios faltantes de tu plan, preparados con todo el respeto y cariño para honrar la memoria de tu mascota🤍🐾.

🎶 *_Compartimos el audio de despedida:_*
👉 Escuchar audio: https://drive.google.com/drive/folders/1mxrnBgjKZSZofe_vA9azlUjcf1w46UEH?usp=sharing

📖 *_Para apoyarte en este proceso de duelo, te dejamos estas herramientas de superación:_*
👉 Ver recursos: https://drive.google.com/drive/folders/1cct2JVjDert-VS0MNVnpGRAhkt0SSCiZ?usp=sharing

🙏 *_Aquí está la tarjeta de oración:_*
👉 Ver tarjeta: https://vt.tiktok.com/ZSMXPYkf8/

🌸 *_Y finalmente, con todo nuestro cariño, te entregamos el memorial digital:_*
👉 Ver memorial: {{1}}

Con esto damos por finalizada la entrega de los recordatorios incluidos en tu plan.
Gracias de corazón por permitirnos acompañarte en este momento tan especial 💜🐾.

Para cualquier información adicional, comunícate con al *3193585508*$txt$,
      'cubre', jsonb_build_array(
        'a1cd8abf-f6e5-4c8e-a307-de91feb60866',  -- Audio de despedida
        'c74becc1-df53-489a-aeb4-73ca73e1da15',  -- Herramientas de superación de duelo
        'cdc44e4e-7c28-463a-8f7b-62af99af6cd9'   -- Tarjeta de oración
      )
    ),
    descripcion = 'Plantilla HSM para servicios con solo memorial (básicos y ecogrupales). {{1}} = memorial. `texto` es espejo del cuerpo aprobado en Meta (evidencia) y `cubre` los recordatorios de enlace fijo que entrega — AMBOS deben editarse a la par de la plantilla en Meta.'
WHERE modulo = 'DIGITALES' AND clave = 'plantilla_memorial';

-- ── 2. Backfill: los que ya recibieron la plantilla y quedaron PENDIENTE ──────
-- Solo servicios con un envío ENVIADO de esta plantilla: el cliente ya tiene los
-- tres enlaces fijos en su WhatsApp. No se tocan NA ni REMOVIDO.
UPDATE public.servicio_recordatorios sr
SET estado = 'ENTREGADO'
WHERE sr.recordatorio_id IN (
        'a1cd8abf-f6e5-4c8e-a307-de91feb60866',
        'c74becc1-df53-489a-aeb4-73ca73e1da15',
        'cdc44e4e-7c28-463a-8f7b-62af99af6cd9')
  AND sr.estado NOT IN ('NA', 'ENTREGADO')
  AND COALESCE(sr.origen, '') <> 'REMOVIDO'
  AND EXISTS (
        SELECT 1 FROM public.digitales_envios de
        WHERE de.servicio_id = sr.servicio_id
          AND de.plantilla = 'envio_digitales'
          AND de.estado = 'ENVIADO');

COMMIT;
