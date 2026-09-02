-- 138 — Digitales: el envío al cliente vuelve a ser SIEMPRE con revisión humana.
--
-- La 135 encendió `envio_automatico_activo`: el job barría los servicios que
-- quedaban con todas sus piezas publicadas y mandaba la plantilla solo. En la
-- práctica eso significa que apenas se publica la última pieza sale el WhatsApp
-- al cliente sin que nadie haya visto qué se está mandando (decisión David
-- 2026-08-31). Se apaga: el coordinador revisa la plantilla en el módulo y
-- presiona "Enviar".
--
-- El job queda en el código y respeta esta bandera: para volver a encenderlo
-- basta poner `true` aquí (y mover `envio_automatico_desde` al nuevo corte, o
-- se dispararán de golpe todos los que se acumularon mientras estuvo apagado).

BEGIN;

UPDATE public.config_operativa
SET valor = 'false'::jsonb,
    descripcion = 'Envío automático del job de digitales. false = nada sale sin que una persona lo revise y presione Enviar (David 2026-08-31). Al reactivar, actualizar también envio_automatico_desde.'
WHERE modulo = 'DIGITALES' AND clave = 'envio_automatico_activo';

COMMIT;
