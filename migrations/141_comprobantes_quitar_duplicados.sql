-- 141 — Comprobantes de pago: que coordinación pueda QUITAR los duplicados.
-- Fecha: 2026-09-03 · pedido de David
--
-- El problema: un servicio acumula comprobantes que nadie puede quitar. Hoy hay
-- 70 servicios con 2 o más, y hasta con 4. Salen de tres sitios:
--   1. El técnico guarda el recibo varias veces (34 servicios tienen más de un
--      recibo) y cada intento sube su propia foto.
--   2. "Reemplazar" del técnico marca la vieja `estado='RECHAZADO'` con
--      `error='Reemplazado por el tecnico'`… pero NADIE filtra por estado, así
--      que la reemplazada se sigue viendo al lado de la nueva (15 servicios).
--   3. El comprobante vive SOLO en el jsonb `recibos_tecnico.medios_pago[]
--      .comprobanteUrl` — 51 casos — porque el insert en `recibo_comprobantes`
--      es best-effort y a veces falla mudo. La pantalla los mezcla con los de la
--      tabla, deduplicando por `storage_path`.
--
-- ⚠️ Por eso quitar un comprobante NO puede ser un DELETE de la fila: si el
--    puntero del jsonb sobrevive, la pantalla lo resucita en el siguiente
--    render y parece que el botón no sirvió. Hay que apagar LAS DOS fuentes.
--
-- Qué hace esta migración:
--   · Marca de borrado en `recibo_comprobantes` (quién, cuándo, por qué). Es
--     REVERSIBLE y el archivo NUNCA se toca en storage: se puede recuperar.
--     No se reusó `estado='RECHAZADO'` a propósito — ese valor ya significa
--     "reemplazado / revisado y rechazado" (23 filas) y mezclarlos borraría esa
--     distinción.
--   · El índice único de "un comprobante activo por medio de pago" pasa a
--     ignorar los eliminados, para que se pueda volver a subir uno bueno.
--   · RPC `eliminar_comprobante_pago`: apaga la fila Y limpia el
--     `comprobanteUrl` del jsonb. Solo COORDINADOR/ADMIN, con rastro en la
--     bitácora del servicio. El elemento del jsonb NO se borra —lleva `metodo`
--     y `monto`, borrarlo se llevaría por delante el medio de pago—: solo se
--     vacía su `comprobanteUrl`.

BEGIN;

-- ─── 1. Marca de borrado ────────────────────────────────────────────────────
ALTER TABLE public.recibo_comprobantes
  ADD COLUMN IF NOT EXISTS eliminado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS eliminado_por    uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS eliminado_motivo text;

COMMENT ON COLUMN public.recibo_comprobantes.eliminado_en
  IS 'Quitado por coordinación (migr. 141). NULL = vigente. El archivo sigue en storage: es reversible poniendo esto en NULL.';

CREATE INDEX IF NOT EXISTS recibo_comprobantes_vigentes_idx
  ON public.recibo_comprobantes (servicio_id) WHERE eliminado_en IS NULL;

-- ─── 2. El índice de unicidad ignora los eliminados ─────────────────────────
-- Si no, un comprobante quitado sigue ocupando el cupo de su medio de pago y el
-- técnico no puede subir el bueno: el insert choca contra el índice.
DROP INDEX IF EXISTS public.recibo_comprobantes_medio_activo_uidx;
CREATE UNIQUE INDEX recibo_comprobantes_medio_activo_uidx
  ON public.recibo_comprobantes (medio_pago_id)
  WHERE medio_pago_id IS NOT NULL
    AND eliminado_en IS NULL
    AND estado = ANY (ARRAY['PENDIENTE','SUBIDO','PENDIENTE_REVISION','APROBADO']);

-- ─── 3. La RPC ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eliminar_comprobante_pago(
  p_servicio_id    uuid,
  p_comprobante_id uuid   DEFAULT NULL,
  p_storage_path   text   DEFAULT NULL,
  p_url            text   DEFAULT NULL,
  p_actor_id       uuid   DEFAULT NULL,
  p_actor_rol      text   DEFAULT NULL,
  p_motivo         text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_filas    int    := 0;
  v_recibos  int    := 0;
  v_path     text;
  v_mascota  text;
  v_motivo   text   := NULLIF(TRIM(p_motivo), '');
BEGIN
  IF p_servicio_id IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio_id es obligatorio';
  END IF;

  IF p_comprobante_id IS NULL
     AND COALESCE(p_storage_path,'') = ''
     AND COALESCE(p_url,'') = '' THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: hay que decir cuál comprobante se quita';
  END IF;

  -- Mismo cerrojo que `revertir_cobro_recibo` (migr. 114): un técnico no borra
  -- la evidencia del dinero que él mismo reportó.
  IF p_actor_rol IS NULL OR upper(p_actor_rol) NOT IN ('COORDINADOR','ADMIN') THEN
    RAISE EXCEPTION 'NO_AUTORIZADO: solo coordinación o gerencia puede quitar un comprobante';
  END IF;

  -- ── a) La fila de la tabla formal, si la hay ──────────────────────────────
  UPDATE public.recibo_comprobantes
     SET eliminado_en     = now(),
         eliminado_por    = p_actor_id,
         eliminado_motivo = v_motivo
   WHERE servicio_id  = p_servicio_id
     AND eliminado_en IS NULL
     AND (
          (p_comprobante_id IS NOT NULL AND id = p_comprobante_id)
       OR (p_comprobante_id IS NULL AND COALESCE(p_storage_path,'') <> ''
           AND storage_path = p_storage_path)
     )
  RETURNING storage_path INTO v_path;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- La ruta con la que buscar en el jsonb: la de la fila si la encontramos, y
  -- si no la que mandó la pantalla (caso "solo vive en el jsonb").
  v_path := COALESCE(v_path, NULLIF(p_storage_path,''));

  -- ── b) El puntero dentro de recibos_tecnico.medios_pago ───────────────────
  -- Se vacía `comprobanteUrl`, no se quita el elemento: ahí viven `metodo` y
  -- `monto` del medio de pago.
  WITH nuevo AS (
    SELECT rt.id,
           jsonb_agg(
             CASE
               WHEN COALESCE(e->>'comprobanteUrl','') <> ''
                    AND (
                         (COALESCE(p_url,'') <> '' AND e->>'comprobanteUrl' = p_url)
                      OR (v_path IS NOT NULL AND e->>'comprobanteUrl' LIKE '%' || v_path)
                    )
               THEN jsonb_set(e, '{comprobanteUrl}', '""'::jsonb)
               ELSE e
             END
             ORDER BY t.ord
           ) AS medios
      FROM public.recibos_tecnico rt,
           LATERAL jsonb_array_elements(COALESCE(rt.medios_pago, '[]'::jsonb))
                   WITH ORDINALITY AS t(e, ord)
     WHERE rt.servicio_id = p_servicio_id
     GROUP BY rt.id
  )
  UPDATE public.recibos_tecnico rt
     SET medios_pago = nuevo.medios
    FROM nuevo
   WHERE nuevo.id = rt.id
     AND rt.medios_pago IS DISTINCT FROM nuevo.medios;
  GET DIAGNOSTICS v_recibos = ROW_COUNT;

  IF v_filas = 0 AND v_recibos = 0 THEN
    RETURN jsonb_build_object(
      'servicio_id', p_servicio_id, 'quitado', false,
      'motivo_no', 'Ese comprobante ya no estaba activo en este servicio.'
    );
  END IF;

  -- ── c) Rastro ─────────────────────────────────────────────────────────────
  SELECT m.nombre INTO v_mascota
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
   WHERE s.id = p_servicio_id;

  INSERT INTO public.novedades_servicio
    (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
  VALUES (
    p_servicio_id, 'NOTA',
    'Comprobante de pago quitado por coordinación'
      || CASE WHEN v_path IS NOT NULL THEN ' (' || v_path || ')' ELSE '' END
      || CASE WHEN v_motivo IS NOT NULL THEN ' — ' || v_motivo ELSE '' END
      || '. El archivo NO se borró: sigue en storage y se puede recuperar.',
    0, p_actor_id
  );

  RETURN jsonb_build_object(
    'servicio_id',       p_servicio_id,
    'quitado',           true,
    'filas_marcadas',    v_filas,
    'recibos_limpiados', v_recibos,
    'storage_path',      v_path,
    'mascota',           v_mascota
  );
END;
$$;

-- La función decide la autorización por p_actor_rol; nadie anónimo la ejecuta.
REVOKE ALL ON FUNCTION public.eliminar_comprobante_pago(uuid, uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_comprobante_pago(uuid, uuid, text, text, uuid, text, text) TO authenticated, service_role;

COMMIT;
