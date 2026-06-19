// Reglas de negocio del flujo asistido de solicitud de imágenes.
// Canónicas server-side: el frontend (bandeja + portal) solo muestra/valida.
// Decisiones David 2026-06-19: fecha base = fecha_ingreso; excluir ANGEL/DESAMPARADO
// salvo adicional que requiera imagen; canal Zolutium/GHL con plantilla HSM
// (aún no aprobada → el flujo para en POR_VALIDAR); línea por defecto 315 989 1247.

export const CONFIG_DEFAULTS_IMAGENES = {
  fecha_base:        'fecha_ingreso',
  planes_excluidos:  ['ANGEL', 'DESAMPARADO'],
  estados_elegibles: ['EN_CUARTO_FRIO'],
  linea_default:     '+573159891247',
  recuperar_vencidos: true,
  max_mb:            8,
  mimes_permitidos:  ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  // Plantilla HSM (fuera de la ventana de 24h). Activar cuando Meta apruebe.
  usar_plantilla:    false,
  plantilla_nombre:  'solicitud_imagenes',
  plantilla_idioma:  'es_MX',
}

export async function cargarConfigImagenes(client) {
  const cfg = { ...CONFIG_DEFAULTS_IMAGENES }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'SOLICITUDES_IMAGENES'`
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/** Enlace público del portal (HashRouter). base sin barra final + '#/fotos/CODIGO'. */
export function construirEnlace(codigo) {
  const base = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')
  return `${base}/#/fotos/${codigo}`
}

/** Mensaje por defecto (espejo del cuerpo de la plantilla aprobada). */
export function mensajeSolicitud({ nombre, mascota, enlace, codigo }) {
  const n = (nombre || '').split(' ')[0] || nombre || ''
  return `Hola, ${n}. Recibe un saludo de Camino al Cielo. Para continuar con los ` +
    `recordatorios de ${mascota || 'tu mascota'}, por favor adjunta las fotografías ` +
    `solicitadas en el siguiente enlace: ${enlace}. Tu código de acceso es: ${codigo}. ` +
    `Gracias por confiar en nosotros.`
}

/** ¿El recordatorio requiere imagen? (gate de selección del flujo) */
export function requiereImagen(rec) {
  return !!rec && rec.requiere_imagen === true && rec.solo_nombre !== true && (rec.max_fotos || 0) > 0
}

/** ¿El recordatorio pide algún dato del cliente (imagen o texto)? (qué mostrar en el portal) */
export function pideDatosCliente(rec) {
  if (!rec) return false
  if (rec.solo_nombre === true) return false
  const campos = Array.isArray(rec.campos_texto) ? rec.campos_texto : []
  return requiereImagen(rec) || campos.length > 0
}

/**
 * Items del servicio que el portal debe mostrar (curados server-side).
 * Respeta solo_adicional (Ángel/Desamparado con adicional): solo origen ADICIONAL.
 * Devuelve [{ sr_id, origen, estado, recordatorio:{...}, requiere_imagen, max_fotos, campos_texto }].
 */
export async function itemsPortal(client, servicioId, soloAdicional) {
  const { rows } = await client.query(
    `SELECT sr.id AS sr_id, sr.origen, sr.estado,
            sr.imagen_cliente_url, sr.imagenes_cliente_urls, sr.datos_cliente,
            r.id AS rec_id, r.nombre, r.solo_nombre, r.requiere_imagen, r.max_fotos, r.campos_texto
     FROM public.servicio_recordatorios sr
     JOIN public.recordatorios r ON r.id = sr.recordatorio_id
     WHERE sr.servicio_id = $1
       AND COALESCE(sr.origen,'') <> 'REMOVIDO'
       AND sr.estado <> 'NA'`,
    [servicioId]
  )
  return rows
    .filter(row => {
      const rec = { solo_nombre: row.solo_nombre, requiere_imagen: row.requiere_imagen,
                    max_fotos: row.max_fotos, campos_texto: row.campos_texto }
      if (!pideDatosCliente(rec)) return false
      if (soloAdicional && row.origen !== 'ADICIONAL') return false
      return true
    })
    .map(row => ({
      sr_id: row.sr_id, origen: row.origen, estado: row.estado,
      imagen_cliente_url: row.imagen_cliente_url,
      imagenes_cliente_urls: row.imagenes_cliente_urls,
      datos_cliente: row.datos_cliente,
      recordatorio: {
        id: row.rec_id, nombre: row.nombre, solo_nombre: row.solo_nombre,
        requiere_imagen: row.requiere_imagen, max_fotos: row.max_fotos,
        campos_texto: Array.isArray(row.campos_texto) ? row.campos_texto : [],
      },
    }))
}
