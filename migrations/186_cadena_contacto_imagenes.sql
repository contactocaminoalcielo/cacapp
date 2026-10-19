-- ============================================================================
-- 186 — Cadena de contacto cuando la solicitud de imágenes NO le llega al cliente
-- ----------------------------------------------------------------------------
-- Reporte de Producción y Diseño (15-oct-2026): el 1er contacto de Muñeca salió
-- a un número «en experimento de Meta» (130472), quedó en rojo en la bandeja y
-- nadie siguió intentando. Pedido: registrar la novedad, probar el otro número
-- del cliente y, si tampoco, escalar a la veterinaria que remitió el servicio.
--
-- Lo que se midió antes de diseñar (19-oct, 60 días):
--   · 76 contactos 1 «ENVIADO» en la bitácora con acuse `failed` de Meta. El
--     rechazo llega DESPUÉS, por el webhook: Orbit nunca se enteraba.
--   · Errores DEL NÚMERO (otro número sí puede servir): 130472 experimento (17),
--     131026 sin WhatsApp (13), 131049 tope de marketing del usuario (22).
--   · Error DE LA CUENTA, no del número: 131042 pago de la cuenta de Meta (24).
--     Probar otro número o escribirle a la vet no arregla eso → NO entra.
--   · De los 52 de número: 14 tenían otro teléfono, 44 tenían veterinaria.
--
-- Modelo:
--   · `solicitud_imagenes_cadena`: un paso por fila. PRINCIPAL (el fallo que
--     arrancó la cadena, para el registro), CLIENTE_ALTERNO (otro número del
--     cliente, misma plantilla del contacto 1), VETERINARIA (plantilla de
--     apoyo por la línea de veterinarias), COORDINACION (nadie más a quién
--     escribir → alerta para llamar). UNIQUE (solicitud, canal, destino): un
--     paso no puede salir dos veces aunque el job corra doble.
--   · `solicitudes_imagenes.wa_fallido` / `wa_alterno`: el número que falló y
--     el que sí funcionó. El 2º y 3er contacto van al alterno mientras el
--     cliente siga con el número que falló en su ficha.
--   · Cada paso deja una novedad (NOTA) en el servicio: número, fecha/hora y
--     resultado — lo que pidió el reporte.
--
-- Config (SOLICITUDES_IMAGENES):
--   · cadena_contacto_activa = true. Solo actúa sobre fallos desde
--     `cadena_contacto_desde` (= cuando se aplica esto): encenderla no le
--     escribe a nadie por los fallos viejos.
--   · plantilla_apoyo_vet = null hasta que Meta apruebe la plantilla de la
--     línea de veterinarias. Mientras sea null, el paso VETERINARIA no envía:
--     deja la alerta a coordinación con el número de la clínica.
--   · errores_numero: códigos de Meta que disparan la cadena (editable).
--   cat migrations/186_cadena_contacto_imagenes.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.solicitud_imagenes_cadena (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id    uuid NOT NULL REFERENCES public.solicitudes_imagenes(id) ON DELETE CASCADE,
  servicio_id     uuid NOT NULL REFERENCES public.servicios(id),
  canal           text NOT NULL CHECK (canal IN ('PRINCIPAL', 'CLIENTE_ALTERNO', 'VETERINARIA', 'COORDINACION')),
  destino         text NOT NULL DEFAULT '',
  estado          text NOT NULL DEFAULT 'ENVIANDO'
                  CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'LLEGO', 'ERROR', 'SIN_PLANTILLA', 'REGISTRADO')),
  -- El wamid que falló y su error: por qué se dio este paso.
  disparo_message_id text,
  disparo_error   text,
  plantilla       text,
  message_id      text,
  ultimo_error    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  enviado_en      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (solicitud_id, canal, destino)
);

CREATE INDEX IF NOT EXISTS idx_sic_cadena_solicitud ON public.solicitud_imagenes_cadena (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_sic_cadena_pendiente ON public.solicitud_imagenes_cadena (estado)
  WHERE estado = 'ENVIADO';

DROP TRIGGER IF EXISTS trg_sic_cadena_updated ON public.solicitud_imagenes_cadena;
CREATE TRIGGER trg_sic_cadena_updated BEFORE UPDATE ON public.solicitud_imagenes_cadena
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.solicitud_imagenes_cadena IS
  'Cadena de contacto cuando la solicitud de imágenes no le llega al cliente (migr. 186): PRINCIPAL (el fallo) → CLIENTE_ALTERNO → VETERINARIA → COORDINACION.';

ALTER TABLE public.solicitudes_imagenes
  ADD COLUMN IF NOT EXISTS wa_fallido text,
  ADD COLUMN IF NOT EXISTS wa_alterno text;
COMMENT ON COLUMN public.solicitudes_imagenes.wa_fallido IS
  'Número del cliente que Meta rechazó por un error del número (migr. 186).';
COMMENT ON COLUMN public.solicitudes_imagenes.wa_alterno IS
  'Otro número del cliente al que SÍ le llegó la solicitud: el 2º y 3er contacto van ahí mientras la ficha siga con wa_fallido (migr. 186).';

-- Lee y escribe el backend (rol orbit_backend); el frontend solo lee.
GRANT SELECT, INSERT, UPDATE ON TABLE public.solicitud_imagenes_cadena TO orbit_backend;
GRANT SELECT ON TABLE public.solicitud_imagenes_cadena TO authenticated, service_role;
ALTER TABLE public.solicitud_imagenes_cadena ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read ON public.solicitud_imagenes_cadena;
CREATE POLICY auth_read ON public.solicitud_imagenes_cadena
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('SOLICITUDES_IMAGENES', 'cadena_contacto_activa', 'true'::jsonb,
   'Si la solicitud de imágenes no le llega al cliente por un error del número, Orbit prueba su otro número y luego escala a la veterinaria (migr. 186).'),
  ('SOLICITUDES_IMAGENES', 'cadena_contacto_desde', to_jsonb(now()),
   'Solo los fallos posteriores a este momento disparan la cadena: encenderla no persigue fallos viejos.'),
  ('SOLICITUDES_IMAGENES', 'errores_numero', '["130472", "131026", "131049"]'::jsonb,
   'Códigos de Meta que son culpa del NÚMERO (otro número o la vet sí pueden servir). 131042 (pago de la cuenta) NO va aquí; 131050 (el usuario pidió no recibir marketing) tampoco: buscarlo por otro número sería saltarse su decisión.'),
  ('SOLICITUDES_IMAGENES', 'plantilla_apoyo_vet', 'null'::jsonb,
   'Plantilla APROBADA en la línea de veterinarias para pedirle a la clínica que nos ayude a contactar al propietario. {nombre, idioma, vars:[clinica, propietario, mascota]}. null = no se envía y queda la alerta a coordinación.')
ON CONFLICT (modulo, clave) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 🪤 ORDEN: migración → backend (scp + docker compose build) → crontab → frontend.
-- El backend nuevo lee `wa_fallido`/`wa_alterno` en enviarContacto: sin la
-- migración, el 2º/3er contacto fallarían por columna inexistente.
-- Apagar: UPDATE config_operativa SET valor='false' WHERE modulo='SOLICITUDES_IMAGENES' AND clave='cadena_contacto_activa';
