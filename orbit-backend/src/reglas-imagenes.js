// Reglas de negocio del flujo asistido de solicitud de imágenes.
// Canónicas server-side: el frontend (bandeja + portal) solo muestra/valida.
// Decisiones David 2026-06-19: fecha base = fecha_ingreso; excluir ANGEL/DESAMPARADO
// salvo adicional que requiera imagen; canal Zolutium/GHL con plantilla HSM
// (aún no aprobada → el flujo para en POR_VALIDAR); línea por defecto 315 989 1247.

export const CONFIG_DEFAULTS_IMAGENES = {
  fecha_base:        'fecha_ingreso',
  planes_excluidos:  ['ANGEL', 'DESAMPARADO'],
  // Ventana en la que el JOB proactivamente pide imágenes (solo cuarto frío).
  estados_elegibles: ['EN_CUARTO_FRIO'],
  // Ventana en la que el PORTAL acepta cargas del cliente. Más amplia que la del
  // job: si el servicio ya salió del cuarto frío (el técnico lo procesó antes de
  // que el cliente subiera las fotos), el cliente todavía puede enviarlas hasta
  // que se produzca/entregue. Evita el falso "ya recibimos todo".
  estados_portal:    ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION'],
  linea_default:     '+573159891247',
  recuperar_vencidos: true,
  max_mb:            8,
  mimes_permitidos:  ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  // Plantilla HSM (fuera de la ventana de 24h). Activar cuando Meta apruebe.
  usar_plantilla:    false,
  plantilla_nombre:  'solicitud_imagenes_cliente',
  plantilla_idioma:  'es_MX',
  plantilla_categoria: 'UTILITY',   // debe coincidir con la categoría aprobada en Meta (UTILITY o MARKETING)

  // ─── Seguimiento automático: 2º y 3er contacto (migración 044) ────────────
  // Ancla ÚNICA = fecha de envío del contacto 1 (no encadenado): recalcular la
  // fecha de cualquier contacto siempre da el mismo resultado.
  seguimiento_activo:     true,
  dias_contacto_2:        3,     // días hábiles desde el contacto 1
  dias_contacto_3:        15,    // días hábiles desde el contacto 1 (NO desde el 2º)
  dias_cierre:            3,     // días hábiles tras el 3º sin respuesta → SIN_RESPUESTA
  arranque_desde:         null,  // no perseguir contactos 1 anteriores a esta fecha (anti-blast del backlog)
  max_envios_por_corrida: 40,
  // Plantillas aprobadas en Zolutium. null → el job NO envía (deja el contacto
  // programado y lo reporta). Sembrarlas es el acto que arma la automatización.
  // Forma: { nombre, idioma, categoria, vars:[tokens] } — ver TOKENS_PLANTILLA.
  plantilla_contacto_2:   null,
  plantilla_contacto_3:   null,
}

/** Tokens permitidos en `vars` de las plantillas de seguimiento. */
export const TOKENS_PLANTILLA = ['nombre', 'propietario', 'mascota', 'enlace', 'codigo']

// Meta rechaza el mensaje si plantilla + parámetros superan 1024 caracteres
// (error #132005). GHL responde 201 igual y el rechazo solo se ve al consultar
// el estado del mensaje. Ver el fix del módulo Digitales (2026-07-14).
export const LIMITE_META_CHARS = 1024

/**
 * Normaliza la config de plantilla de un contacto (2 ó 3). Devuelve null si no
 * está sembrada o le falta el nombre → quien llama NO debe enviar.
 */
export function plantillaContacto(config, numero) {
  const raw = config[`plantilla_contacto_${numero}`]
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  const vars = Array.isArray(p.vars) ? p.vars.filter(v => TOKENS_PLANTILLA.includes(v)) : ['mascota', 'enlace']
  return {
    nombre:    p.nombre,
    idioma:    p.idioma    || config.plantilla_idioma    || 'es_MX',
    categoria: p.categoria || config.plantilla_categoria || 'UTILITY',
    vars,
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

/**
 * Resuelve los parámetros posicionales del cuerpo según el orden declarado en
 * `vars`. Un token desconocido nunca llega aquí (plantillaContacto lo filtra),
 * pero un valor vacío se manda como '' — Meta rechaza el parámetro ausente.
 */
export function resolverBodyParams(vars, datos) {
  const dic = {
    nombre:      (datos.cliente_nombre || datos.propietario || '').split(' ')[0] || '',
    propietario: datos.propietario || datos.cliente_nombre || '',
    mascota:     datos.mascota || 'tu mascota',
    enlace:      datos.enlace || '',
    codigo:      datos.codigo || '',
  }
  return vars.map(v => String(dic[v] ?? ''))
}

/** Texto del recordatorio (lo que queda registrado como "lo que vio el cliente"). */
export function mensajeRecordatorio({ nombre, mascota, enlace, numero }) {
  const n = (nombre || '').split(' ')[0] || nombre || ''
  const cortesia = numero === 3
    ? 'Queremos asegurarnos de no continuar sin tus fotografías'
    : 'Aún no hemos recibido las fotografías'
  return `Hola, ${n}. ${cortesia} para los recordatorios de ${mascota || 'tu mascota'}. ` +
    `Puedes adjuntarlas aquí: ${enlace}. Si necesitas ayuda, respóndenos por este medio. — Camino al Cielo`
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

/** Mensaje por defecto (espejo del cuerpo de la plantilla aprobada `solicitud_imagenes_cliente`,
 *  2 variables: mascota + enlace directo, sin código). */
export function mensajeSolicitud({ nombre, mascota, enlace }) {
  const n = (nombre || '').split(' ')[0] || nombre || ''
  return `Hola, ${n}. Recibe un saludo de Camino al Cielo. Para continuar con los ` +
    `recordatorios de ${mascota || 'tu mascota'}, por favor adjunta las fotografías ` +
    `solicitadas en el siguiente enlace: ${enlace}. Gracias por confiar en nosotros.`
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
