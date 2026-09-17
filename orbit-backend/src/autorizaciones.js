// Prueba de la autorización de tratamiento de datos (Ley 1581 de 2012, art. 9).
// Tabla: public.autorizaciones_datos — migración 161.
//
// La VERSIÓN de la política la manda el frontend, no la fija este archivo. Es a
// propósito: lo que hay que probar es qué texto vio la persona, y quien lo
// mostró fue su navegador. Un cliente con el build viejo en caché manda la
// versión vieja, que es exactamente lo que aceptó.
//
// Solo se inserta. Nunca se actualiza ni se borra: una revocación es otra fila
// con accion='REVOCA'.

// Una IP sirve como prueba solo si el que la manda no puede escribirla.
const IP_VALIDA = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,45})$/i
const ipLimpia = v => {
  const s = String(v || '').trim().replace(/^::ffff:/i, '')
  return s && s.length <= 45 && IP_VALIDA.test(s) ? s : null
}

/**
 * IP real detrás de nginx, y el navegador. Los dos son prueba, no adorno.
 *
 * 🩸 `x-forwarded-for` NO sirve para esto: nginx la arma con
 * `$proxy_add_x_forwarded_for`, que AÑADE la IP real a lo que el cliente haya
 * mandado. O sea que el primer valor lo escribe quien llama, y tomarlo dejaba
 * que cualquiera firmara su autorización con la IP que quisiera. `x-real-ip` la
 * pone nginx desde el socket y no se puede falsificar; del `x-forwarded-for`
 * solo vale el ÚLTIMO valor, que es el que agregó nginx.
 *
 * Y se valida el formato: la columna es `inet`, así que una cabecera con basura
 * reventaba el INSERT y con él toda la petición de la familia.
 */
export function contextoPeticion(req) {
  const cadena = String(req?.headers?.['x-forwarded-for'] || '').split(',')
  const ip = ipLimpia(req?.headers?.['x-real-ip'])
    || ipLimpia(cadena[cadena.length - 1])
    || ipLimpia(req?.socket?.remoteAddress)
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 500) || null
  return { ip, userAgent: ua }
}

/**
 * ¿El cuerpo trae una autorización utilizable? Devuelve la versión aceptada o
 * null. Se exige la versión: sin ella la fila no prueba nada.
 * Forma esperada: { autorizacion: { aceptada: true, politica_version: '1.0' } }
 */
export function autorizacionDelPayload(payload) {
  const a = payload?.autorizacion
  if (!a || a.aceptada !== true) return null
  const v = String(a.politica_version || '').trim()
  return v ? v.slice(0, 20) : null
}

/**
 * Deja la constancia. `client` debe ser el de la transacción que está creando
 * lo demás: la autorización y el dato que ampara se guardan juntos o no se
 * guarda ninguno.
 */
export async function registrarAutorizacion(client, {
  origen, medio, politicaVersion, finalidades = ['SERVICIO'],
  titular = {}, servicioId = null, clienteId = null, solicitudId = null,
  aliadoId = null, declaradaPor = null, contexto = {}, notas = null,
}) {
  const t = v => {
    const s = String(v ?? '').trim()
    return s ? s.slice(0, 200) : null
  }
  await client.query(
    `INSERT INTO public.autorizaciones_datos
       (origen, medio, politica_version, finalidades,
        titular_nombre, titular_documento, titular_telefono, titular_email,
        servicio_id, cliente_id, solicitud_id, aliado_id, declarada_por,
        ip, user_agent, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      origen, medio, politicaVersion, finalidades,
      t([titular.nombre, titular.apellido].filter(Boolean).join(' ')),
      t(titular.documento), t(titular.telefono), t(titular.email),
      servicioId, clienteId, solicitudId, aliadoId, declaradaPor,
      contexto.ip || null, contexto.userAgent || null, notas,
    ]
  )
}

/**
 * El titular detrás de un servicio: servicio → mascota → cliente. Los portales
 * de fotos, planta y visita los abre la familia con su código, así que quien
 * autoriza es el dueño del servicio, no quien figure como «recibe» (ese puede
 * ser el vecino que abre la puerta).
 */
export async function titularDeServicio(client, servicioId) {
  const { rows } = await client.query(
    `SELECT c.id_cliente, c.nombre, c.apellido, c.cedula_nit,
            COALESCE(c.whatsapp, c.telefono) AS telefono, c.email
       FROM public.servicios s
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE s.id = $1`,
    [servicioId]
  )
  const c = rows[0]
  if (!c) return { clienteId: null, titular: {} }
  return {
    clienteId: c.id_cliente,
    titular: {
      nombre: c.nombre, apellido: c.apellido, documento: c.cedula_nit,
      telefono: c.telefono, email: c.email,
    },
  }
}

/** Respuesta única para cuando falta la autorización, en todos los portales. */
export const FALTA_AUTORIZACION = {
  status: 422,
  body: {
    ok: false,
    error: 'falta_autorizacion',
    mensaje: 'Falta aceptar la Política de Tratamiento de Datos. Recarga la página e inténtalo de nuevo.',
  },
}
