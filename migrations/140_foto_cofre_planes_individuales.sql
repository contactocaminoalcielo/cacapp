-- 140 — Foto del cofre (cenizario) en TODOS los planes de cremación individual.
-- Fecha: 2026-09-02
--
-- La 052 modeló la foto del cofre como el recordatorio de catálogo "Foto para el
-- cofre", y el job de imágenes lo adjunta a los planes de `planes_foto_cofre`.
-- Esa lista quedó solo con los exclusivos SIN_REC, porque el caso que se estaba
-- resolviendo era "planes sin recordatorios que igual deben entrar al primer
-- contacto". Pero el cenizario lo llevan también EXCLUSIVO_PRESENCIAL,
-- EXCLUSIVO_VIDEOLLAMADA y PREMIUM (ver 121): esos servicios sí entraban al
-- portal —sus otras piezas ya lo hacían entrar— pero nunca se les pedía la foto
-- del cofre, y nadie lo notaba porque el portal se veía "completo".
--
-- Por qué así y no marcando `requiere_imagen` en el recordatorio "Cenizario":
-- eso aplicaría hacia atrás a TODOS los servicios que ya lo tienen, y Producción
-- empezaría a marcar como "falta foto" servicios ya producidos o entregados.
-- Adjuntar la pieza al crear la solicitud solo afecta lo que viene.
--
-- ALCANCE (David 2026-09-02): SOLO los enlaces que se generen de aquí en
-- adelante. Los servicios que ya tienen solicitud creada NO se tocan. El
-- backfill quedó escrito y comentado al final por si algún día se quiere.
--
-- El job lee la lista desde config_operativa, así que con aplicar esto ya
-- empieza a pedir la foto: NO hace falta desplegar el backend.
--
-- APLICAR (el psql del host pega contra Supavisor y pide tenant — va por el
-- contenedor, como el resto de migraciones):
--   cd /opt/supabase/docker && docker compose exec -T db psql -U postgres --     -d postgres --pset pager=off -v ON_ERROR_STOP=1 -f - < 140_foto_cofre_planes_individuales.sql

BEGIN;

-- ── 1. La lista de planes cuyo cofre lleva foto ──────────────────────────────
-- Espejo de CONFIG_DEFAULTS_IMAGENES.planes_foto_cofre en reglas-imagenes.js:
-- si hay fila en config_operativa, esta gana sobre el default del código.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion)
VALUES ('SOLICITUDES_IMAGENES', 'planes_foto_cofre',
        '["EXCLUSIVO_PRESENCIAL","EXCLUSIVO_VIDEOLLAMADA","PREMIUM","EXCLUSIVO_PRESENCIAL_SIN_REC","EXCLUSIVO_VIDEOLLAMADA_SIN_REC"]'::jsonb,
        'Planes cuyo cenizario (cofre) lleva foto de la mascota: el job adjunta el recordatorio "Foto para el cofre" (052) al crear la solicitud y el portal la pide.')
ON CONFLICT (modulo, clave) DO UPDATE
  SET valor = EXCLUDED.valor, descripcion = EXCLUDED.descripcion;

COMMIT;

-- ── Backfill de los que ya están en vuelo — NO se ejecuta ───────────────────
-- Fuera de alcance por decisión de David: solo interesan los enlaces nuevos.
-- Si algún día hace falta, esto adjunta la pieza a los servicios que todavía
-- no han enviado imágenes (nunca a los ya producidos o entregados):
-- -- Si falta el recordatorio de la 052 esto sería un no-op silencioso: mejor que
-- -- reviente y se aplique la 052 primero.
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM public.recordatorios WHERE nombre = 'Foto para el cofre') THEN
--     RAISE EXCEPTION 'Falta el recordatorio "Foto para el cofre" — aplicar la migración 052 antes que esta.';
--   END IF;
-- END $$;
--
-- -- ── 2. Los que ya están en vuelo ─────────────────────────────────────────────
-- -- Sin esto, la foto solo se pediría en servicios nuevos y los que hoy están
-- -- esperando imágenes se quedarían sin el cofre. Acotado a propósito:
-- --   · solo planes de la lista,
-- --   · solo los que AÚN no han enviado imágenes (fecha_imagenes_recibidas NULL),
-- --   · solo en estados en los que el portal todavía acepta cargas,
-- --   · nunca duplica (ni resucita un REMOVIDO: si alguien lo quitó, se respeta).
-- -- No toca servicios ya producidos o entregados.
-- INSERT INTO public.servicio_recordatorios
--   (servicio_id, recordatorio_id, cantidad, origen, estado, precio_cobrado)
-- SELECT s.id, r.id, 1, 'PLAN', 'PENDIENTE', 0
-- FROM public.servicios s
-- JOIN public.planes p        ON p.id = s.plan_id
-- CROSS JOIN LATERAL (
--   SELECT id FROM public.recordatorios WHERE nombre = 'Foto para el cofre' LIMIT 1
-- ) r
-- WHERE p.codigo IN ('EXCLUSIVO_PRESENCIAL','EXCLUSIVO_VIDEOLLAMADA','PREMIUM',
--                    'EXCLUSIVO_PRESENCIAL_SIN_REC','EXCLUSIVO_VIDEOLLAMADA_SIN_REC')
--   AND s.estado IN ('EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION')
--   AND s.fecha_imagenes_recibidas IS NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM public.servicio_recordatorios sr
--     WHERE sr.servicio_id = s.id AND sr.recordatorio_id = r.id);

-- Verificación (correr aparte):
--   SELECT p.codigo, count(*)
--   FROM public.servicio_recordatorios sr
--   JOIN public.recordatorios r ON r.id = sr.recordatorio_id AND r.nombre = 'Foto para el cofre'
--   JOIN public.servicios s ON s.id = sr.servicio_id
--   JOIN public.planes p ON p.id = s.plan_id
--   GROUP BY p.codigo ORDER BY 1;
