-- 097 — Qué dato de Orbit va en cada variable de una plantilla
--
-- Una plantilla de WhatsApp tiene huecos numerados: {{1}}, {{2}}… Meta solo
-- sabe que son huecos; **qué se mete en cada uno es cosa nuestra**. Sin esta
-- tabla hay que teclear los valores a mano en cada envío, que es justo lo que
-- lleva a la gente a crear una plantilla por mascota con el texto quemado.
--
-- Aquí se guarda esa correspondencia: plantilla `recordatorios_listos`,
-- variable {{1}} → el nombre de la mascota. Con eso, enviarla es elegir el
-- servicio y ya.
--
-- La plantilla se identifica por NOMBRE + IDIOMA y no por el id de Meta: si se
-- borra y se vuelve a crear (que es lo que toca hacer para cambiarle el texto,
-- porque Meta no deja editar una aprobada), el id cambia pero el nombre no, y
-- el mapeo sobrevive.
--
-- `campo` NO es SQL ni un nombre de columna: es una clave de un catálogo fijo
-- que vive en el backend (`CAMPOS` en whatsapp-plantillas.js). Guardar aquí una
-- expresión libre sería dejar que quien edite una plantilla escriba consultas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_plantilla_variables (
  plantilla  text    NOT NULL,
  idioma     text    NOT NULL DEFAULT 'es_MX',
  -- Dónde está el hueco: en el cuerpo, en el título o en el enlace del botón.
  -- El mismo número puede repetirse en dos sitios y significar cosas distintas.
  destino    text    NOT NULL DEFAULT 'BODY'
             CHECK (destino IN ('BODY', 'HEADER', 'BUTTON')),
  posicion   integer NOT NULL CHECK (posicion >= 1),
  campo      text    NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  PRIMARY KEY (plantilla, idioma, destino, posicion)
);

COMMENT ON TABLE public.whatsapp_plantilla_variables IS
  'Qué dato de Orbit rellena cada {{n}} de una plantilla de WhatsApp. `campo` es una clave del catálogo del backend, nunca SQL.';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- El rol del backend es `orbit_backend`, NO `postgres`.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_plantilla_variables TO orbit_backend;

-- La UI pasa por el backend, no por PostgREST.
REVOKE ALL ON TABLE public.whatsapp_plantilla_variables FROM anon, authenticated;

COMMIT;
