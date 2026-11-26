-- ============================================================================
-- 227 — Cierre de los servicios sin fotos (Ecogrupal y Básico)
-- ----------------------------------------------------------------------------
-- REPORTE ORBIT 26-nov-2026 (Producción – Diseño, propuesta de mejora): los
-- Ecogrupal y Básico cuyas familias nunca mandaron las fotos se quedan abiertos
-- en el tablero para siempre, aunque ya recibieron los tres avisos.
--
-- Medido en prod el 26-nov: 128 Ecogrupal + 69 Básico en SIN_RESPUESTA y sin
-- entregar (el más viejo del 17-jul). Todos llegaron al 3er contacto, ninguno
-- tiene los digitales enviados, y lo único que los frena es el «Memorial
-- digital» (y en el Básico, además, el Memopet).
--
-- Qué hace (job diario, `orbit-backend/src/cierre-sin-fotos.js`):
--   · 15 días CALENDARIO después del 3er contacto (el último aviso), si la
--     familia no subió fotos: manda `envio_digitales` (la plantilla del memorial)
--     con `texto_sin_foto` en el lugar del enlace del memorial. La plantilla ya
--     trae fijos audio, herramientas de duelo y tarjeta de oración.
--   · Solo si Meta lo acepta: el «Memorial digital» pasa a NA con una nota (sale
--     de Diseño) y los digitales de la plantilla a ENTREGADO.
--   · Ecogrupal: se cierra solo como ENTREGADO por `fn_cerrar_servicio_sin_ruta`
--     (migr. 148/169), que ya dispara con el cambio de los ítems.
--   · Básico: el job lo pasa a ENTREGADO si todo lo demás está entregado. El
--     Memopet del PLAN queda PENDIENTE en el tablero (decisión David 26-nov): si
--     la foto llega después, se hace y se entrega aparte. Si la cápsula, las
--     huellas o el soporte siguen en proceso, el servicio espera a que salgan.
--
-- Decisiones de David (26-nov):
--   · Solo los casos NUEVOS: el 3er contacto tiene que ser de `arranque_desde`
--     en adelante. Los 197 atrasados los resuelve coordinación a mano.
--   · Texto en lugar del memorial: «(no recibimos la foto)».
--
-- No entra (queda OMITIDO + alerta a coordinación): un servicio con OTRO ítem
-- pendiente que necesita foto — un adicional pagado (Memopet o Altar comprado
-- aparte en un Ecogrupal). Cerrarlo sería dejar sin hacer algo que se cobró.
--
-- Aplicar:
--   cat migrations/227_cierre_sin_fotos.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cierre_sin_fotos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Uno por servicio: el envío no puede salir dos veces aunque el job corra doble.
  servicio_id         uuid NOT NULL UNIQUE REFERENCES public.servicios(id),
  solicitud_id        uuid REFERENCES public.solicitudes_imagenes(id) ON DELETE SET NULL,
  plan_codigo         text,
  ultimo_aviso_en     timestamptz,
  estado              text NOT NULL DEFAULT 'ENVIANDO'
                      CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'ERROR', 'OMITIDO')),
  motivo              text,
  error               text,
  intentos            integer NOT NULL DEFAULT 0,
  digitales_envio_id  uuid,
  enviado_en          timestamptz,
  -- Cuándo el servicio quedó ENTREGADO (por este cierre o por cualquier otro camino).
  servicio_cerrado_en timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cierre_sin_fotos_abiertos ON public.cierre_sin_fotos (estado)
  WHERE servicio_cerrado_en IS NULL;

DROP TRIGGER IF EXISTS trg_cierre_sin_fotos_updated ON public.cierre_sin_fotos;
CREATE TRIGGER trg_cierre_sin_fotos_updated BEFORE UPDATE ON public.cierre_sin_fotos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.cierre_sin_fotos IS
  'Ecogrupal y Básico sin fotos: a los 15 días del 3er aviso se envían los digitales sin memorial y se cierra el servicio (migr. 227). ENVIANDO se reserva ANTES de la red: si el proceso muere ahí, nadie lo reenvía solo.';

-- Lee y escribe el backend (rol orbit_backend); el frontend solo lee.
GRANT SELECT, INSERT, UPDATE ON TABLE public.cierre_sin_fotos TO orbit_backend;
GRANT SELECT ON TABLE public.cierre_sin_fotos TO authenticated, service_role;
ALTER TABLE public.cierre_sin_fotos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read ON public.cierre_sin_fotos;
CREATE POLICY auth_read ON public.cierre_sin_fotos
  FOR SELECT TO authenticated USING (true);

-- ── Configuración ───────────────────────────────────────────────────────────
DO $do$
DECLARE v_n integer; v_memopet uuid;
BEGIN
  -- El Memopet del Básico es lo único que puede quedar pendiente al cerrar.
  -- Se resuelve UNA vez por nombre y se guarda el id; el job cruza por id.
  SELECT count(*), (array_agg(id))[1] INTO v_n, v_memopet
    FROM public.recordatorios WHERE lower(btrim(nombre)) = 'memopet';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente un recordatorio «Memopet» y hay %; revisar el catálogo antes de aplicar', v_n;
  END IF;

  INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
    ('CIERRE_SIN_FOTOS', 'activo', 'true'::jsonb,
     'Ecogrupal y Básico sin fotos: a los `dias_espera` días del 3er aviso se envían los digitales sin memorial y el servicio pasa a ENTREGADO (migr. 227).'),
    ('CIERRE_SIN_FOTOS', 'arranque_desde', to_jsonb(public.fn_hoy_bogota()::text),
     'Solo entran los casos cuyo 3er aviso salió desde esta fecha (decisión David 26-nov: solo los nuevos). Se reinicia a hoy al encender desde /automatizaciones.'),
    ('CIERRE_SIN_FOTOS', 'dias_espera', '15'::jsonb,
     'Días CALENDARIO desde el 3er aviso de fotos (el último) hasta el envío de los digitales sin memorial.'),
    ('CIERRE_SIN_FOTOS', 'planes', '["ECO_GRUPAL", "BASICO"]'::jsonb,
     'Códigos de plan a los que aplica. Deben llevar solo el memorial como pieza digital (plantilla `plantilla_memorial` de DIGITALES).'),
    ('CIERRE_SIN_FOTOS', 'max_por_corrida', '20'::jsonb,
     'Tope de envíos por corrida del job.'),
    ('CIERRE_SIN_FOTOS', 'texto_sin_foto', '"(no recibimos la foto)"'::jsonb,
     'Lo que ve la familia en el lugar del enlace del memorial. Sin saltos de línea: Meta rechaza el envío.'),
    ('CIERRE_SIN_FOTOS', 'pendientes_permitidos', jsonb_build_object('BASICO', jsonb_build_array(v_memopet)),
     'Por plan: ids de `recordatorios` del PLAN que pueden quedar pendientes al cerrar (hoy el Memopet del Básico, decisión David 26-nov). Un adicional pagado nunca entra aquí.')
  ON CONFLICT (modulo, clave) DO NOTHING;
END $do$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 🪤 ORDEN: migración → backend (scp + docker compose build) → crontab.
-- Sin la migración, el job responde «no disponible» (la tabla no existe) y la
-- tarjeta de /automatizaciones lo dice; no rompe nada más.
-- Apagar: UPDATE config_operativa SET valor='false' WHERE modulo='CIERRE_SIN_FOTOS' AND clave='activo';
