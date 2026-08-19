// orbit-backend — servicio backend propio de ORBIT en Contabo (Fase 2).
// Jobs programados (cron del VPS → /jobs/*) + API con permisos en backend.
import express from 'express'
import { pool, log } from './db.js'
import { requireJob, requireAuth, requireRol } from './auth.js'
import { generarPropuesta } from './jobs/propuesta.js'
import { motorAlertas } from './jobs/alertas.js'
import { confirmarLote, cerrarLote } from './lotes.js'
import { jobReportesGrupales } from './jobs/grupales.js'
import { marcarGenerado, enviarReporte, desvincularServicioDeGrupal, agregarServicioAReporteGrupal } from './grupales.js'
import { resumenPendientes, redactarMensaje, alertaVencimientos } from './grupales-ia.js'
import { jobContactosImagenes } from './jobs/imagenes.js'
import { enviarSolicitud, cancelarSolicitud, datosPortal, recibirImagenesPortal } from './imagenes.js'
import { jobSeguimientoImagenes } from './jobs/seguimiento-imagenes.js'
import { jobAfiliaciones } from './jobs/afiliaciones.js'
import { enviarContratoEmail } from './afiliaciones-envio.js'
import { forzarContacto, pausarSeguimiento, resumenSeguimiento } from './seguimiento-imagenes.js'
import { validarTokenPortal, crearSolicitudAliado, registrarAfiliacion, aprobarAliado } from './aliados.js'
import {
  listarCandidatos, listarServicios, generarMemorial, aprobarMemorial,
  publicarManual, registrarEnlace, registrarEnvio, enviarZolutium, descartarPieza, servirArchivo,
} from './digitales.js'
import { publicarInstagram } from './digitales-ig.js'
import { analizarCuadre } from './cuadres-ia.js'
import { verificarWebhook, recibirWebhook, listarEventos } from './whatsapp-cloud-webhook.js'
import {
  listarConversaciones, hilo, marcarLeido, enviarTexto, enviarSobre,
  listarEtiquetas, etiquetar, desetiquetar, cambiarAgente,
} from './whatsapp-cloud.js'
import { leerMedia, enviarArchivo } from './whatsapp-media.js'
import { listarInteractivos, enviarInteractivo, guardarInteractivo, borrarInteractivo } from './whatsapp-interactivos.js'
import {
  listarMateriales, leerMaterial, enviarMaterial, guardarMaterial, borrarMaterial,
} from './whatsapp-materiales.js'
import {
  listarPlantillas, crearPlantilla, editarPlantilla, borrarPlantilla, enviarPlantilla,
  camposDisponibles, variablesDe, guardarVariables, valoresPara,
  subirCabecera, buscarServicios,
} from './whatsapp-plantillas.js'
import {
  obtenerAgente, guardarAgente, agregarConocimiento, actualizarConocimiento,
  borrarConocimiento, archivoConocimiento, listarEjecuciones,
  valorarRespuesta, listarValoraciones, aplicarValoracion, descartarValoracion,
  listarReglas, crearRegla, guardarRegla, borrarRegla,
} from './agente-config.js'
import { probar as probarAgente, arrancarSeguimientos } from './agente-wa.js'
import {
  listarAudiencias, previsualizar, crearCampana, listarCampanas,
  detalleCampana, accionCampana, borrarCampana, arrancarCampanas,
} from './whatsapp-campanas.js'

const app = express()

// ⚠️ ORDEN CRÍTICO — va ANTES del express.json() global.
// El webhook de WhatsApp Cloud API firma el cuerpo CRUDO de la petición; si
// express.json() lo parsea primero, el buffer original se pierde y la firma solo
// podría validarse contra un JSON reserializado (que no coincide byte a byte).
// express.raw() marca el body como leído, así que el express.json() de abajo lo
// salta solo y el resto de Orbit no se entera.
app.use('/webhook/whatsapp', express.raw({ type: '*/*', limit: '1mb' }))

// La base de conocimiento del agente admite imágenes de hasta 5 MB, que viajan
// en base64 (≈ +33 %). Con el límite por defecto de express.json() (100 kB) la
// subida fallaría con un 413 sin mensaje útil. Va ANTES del json global, igual
// que el webhook: el primer parser que coincide gana y el global lo salta.
app.use('/agente/conocimiento', express.json({ limit: '12mb' }))

// Las imágenes que se envían viajan en base64 (≈ +33 %) y no caben en el
// límite por defecto. Ruta PLANA con el contacto en el cuerpo a propósito: con
// el contacto en la URL, el prefijo no se podría acotar y este límite acabaría
// aplicándose a todo /whatsapp/conversaciones.
// 90 MB porque el tope de un documento son 64 MB y en base64 pesa un tercio
// más: con 30 MB, un PDF de 25 MB se caía con un 413 que no dice nada.
app.use('/whatsapp/imagen',  express.json({ limit: '90mb' }))
app.use('/whatsapp/archivo', express.json({ limit: '90mb' }))
// Los materiales del catálogo (101) se suben por aquí, también en base64.
app.use('/whatsapp/materiales', express.json({ limit: '90mb' }))
// La imagen/PDF de la cabecera de una plantilla se sube a Meta antes de crearla
// (Resumable Upload API) y viaja en base64, igual que lo anterior.
app.use('/whatsapp/plantillas-cabecera', express.json({ limit: '30mb' }))

app.use(express.json())

// CORS para el frontend (mismo criterio que las funciones existentes)
const ALLOWED = ['https://orbit.orbitacac.com', 'https://localhost:5173']
app.use((req, res, next) => {
  const origin = req.headers.origin || ''
  res.set('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0])
  res.set('Access-Control-Allow-Headers', 'authorization, content-type')
  res.set('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// En los portales públicos el cliente NO debe ver el error real (filtra esquema
// de la DB), pero "Error interno" a secas es indiagnosticable: hubo 3 días de
// fallos silenciosos en el portal de fotos sin que nadie supiera la causa.
// Solución: un `ref` corto que se imprime en el log JUNTO al error real y viaja
// al navegador. El cliente lo lee por WhatsApp y `docker logs | grep <ref>` da
// la causa exacta.
function errorInterno(res, tag, e) {
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase()
  log(`[${tag}] ERROR ref=${ref}`, e?.message, e?.stack?.split('\n')[1]?.trim() || '')
  res.status(500).json({ ok: false, error: 'Error interno', ref })
}

// ── Salud ──
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, ts: new Date().toISOString(), tz: process.env.TZ || 'UTC' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── WhatsApp Cloud API — receptor de webhooks (línea de veterinarias) ──
// Público a propósito: lo llama Meta, no un usuario. La autenticación es la
// firma HMAC del cuerpo (POST) y el verify token (GET). Ver migración 086.
// Lo que ya opera en Zolutium NO se toca: el filtro por phone_number_id
// descarta en silencio cualquier número que no esté en WHATSAPP_ALLOWED_PHONE_IDS.
app.get('/webhook/whatsapp', verificarWebhook)
app.post('/webhook/whatsapp', recibirWebhook)

// Ventana de diagnóstico mientras se conecta el número: ver qué está llegando
// sin entrar a la base de datos. Solo lectura.
app.get('/webhook/whatsapp/eventos', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    res.json(await listarEventos({ limite: req.query.limite, numero: req.query.numero || null }))
  } catch (e) {
    log('[wa-webhook/eventos] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Bandeja de WhatsApp (migración 087) ──
// La línea de vets es de coordinación: mismo rol que el resto de la operación.
const rolBandeja = requireRol('COORDINADOR', 'ADMIN')

app.get('/whatsapp/conversaciones', requireAuth, rolBandeja, async (req, res) => {
  try {
    res.json(await listarConversaciones({ q: req.query.q || null }))
  } catch (e) {
    log('[wa-bandeja/conversaciones] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/whatsapp/conversaciones/:contacto', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await hilo({ contacto: req.params.contacto, limite: req.query.limite })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[wa-bandeja/hilo] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/whatsapp/conversaciones/:contacto/leido', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await marcarLeido({ contacto: req.params.contacto })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[wa-bandeja/leido] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/whatsapp/conversaciones/:contacto/enviar', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await enviarTexto({
      contacto: req.params.contacto, texto: req.body?.texto, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[wa-bandeja/enviar] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Etiquetas de conversación (migración 090) ──
// Son las listas de trabajo de la bandeja: con el agente respondiendo solo, el
// badge de no leídos no basta para saber qué necesita a una persona.
app.get('/whatsapp/etiquetas', requireAuth, rolBandeja, async (_req, res) => {
  try {
    res.json(await listarEtiquetas())
  } catch (e) {
    log('[wa-bandeja/etiquetas] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/whatsapp/conversaciones/:contacto/etiquetas', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await etiquetar({
      contacto: req.params.contacto, clave: req.body?.clave,
      origen: 'MANUAL', motivo: req.body?.motivo || null, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[wa-bandeja/etiquetar] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.delete('/whatsapp/conversaciones/:contacto/etiquetas/:clave', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await desetiquetar({ contacto: req.params.contacto, clave: req.params.clave })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[wa-bandeja/desetiquetar] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Encender o apagar el agente en UNA conversación (migración 105). Manda sobre
// las reglas automáticas: "de esta clínica me encargo yo" no dura doce horas.
app.post('/whatsapp/conversaciones/:contacto/agente', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await cambiarAgente({
      contacto: req.params.contacto, activo: req.body?.activo === true,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-bandeja/agente', e) }
})

// ── Plantillas de WhatsApp ──
// Son el único modo de escribirle a alguien fuera de la ventana de 24h. Viven
// en la WABA (`WHATSAPP_WABA_ID`), no en Orbit: la lista siempre viene de Meta,
// que es quien manda sobre el estado de aprobación.
app.get('/whatsapp/plantillas', requireAuth, rolBandeja, async (_req, res) => {
  try {
    const r = await listarPlantillas()
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/listar', e) }
})

app.post('/whatsapp/plantillas', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await crearPlantilla({
      nombre: req.body?.nombre, idioma: req.body?.idioma,
      categoria: req.body?.categoria, componentes: req.body?.componentes,
      formato: req.body?.formato,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/crear', e) }
})

// Cambiar el texto de una que ya existe. Se creía imposible —"Meta no deja
// editar una aprobada"— y por eso el módulo solo sabía borrar y recrear.
// Comprobado el 2026-08-19: se puede. Vuelve a revisión, pero conserva el
// nombre, y con él el mapeo de datos.
app.post('/whatsapp/plantillas/:nombre/editar', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await editarPlantilla({
      id: req.body?.id, nombre: req.params.nombre, categoria: req.body?.categoria,
      componentes: req.body?.componentes, formato: req.body?.formato,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/editar', e) }
})

app.delete('/whatsapp/plantillas/:nombre', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await borrarPlantilla({ nombre: req.params.nombre })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/borrar', e) }
})

// Qué dato de Orbit va en cada {{n}} (migración 097). El catálogo es cerrado:
// se guarda una clave, nunca una expresión escrita desde la pantalla.
app.get('/whatsapp/plantillas-campos', requireAuth, rolBandeja, (_req, res) => {
  const r = camposDisponibles()
  res.status(r.status).json(r.body)
})

// El archivo de una cabecera de imagen/video/PDF. Meta NO acepta una URL al dar
// de alta la plantilla (`error_subcode 2388273`): hay que subirlo antes y pasar
// el `handle` que devuelve.
app.post('/whatsapp/plantillas-cabecera', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await subirCabecera({
      base64: req.body?.base64, mime: req.body?.mime, nombre: req.body?.nombre,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/cabecera', e) }
})

// Buscar el servicio del que salen los datos, por mascota/familia/código. Sin
// esto, enviar empieza por pegar un UUID y acaba escribiéndose todo a mano.
app.get('/whatsapp/plantillas-servicios', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await buscarServicios({ q: req.query.q })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/servicios', e) }
})

app.get('/whatsapp/plantillas/:nombre/variables', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await variablesDe({ plantilla: req.params.nombre, idioma: req.query.idioma })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/variables', e) }
})

app.put('/whatsapp/plantillas/:nombre/variables', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await guardarVariables({
      plantilla: req.params.nombre, idioma: req.body?.idioma,
      variables: Array.isArray(req.body?.variables) ? req.body.variables : [],
      // `undefined` = no se habla de la cabecera y no se toca; `null` = se quita.
      cabecera: 'cabecera' in (req.body || {}) ? req.body.cabecera : undefined,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/guardar-variables', e) }
})

app.get('/whatsapp/plantillas/:nombre/valores/:servicioId', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await valoresPara({
      plantilla: req.params.nombre, idioma: req.query.idioma, servicioId: req.params.servicioId,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/valores', e) }
})

app.post('/whatsapp/plantillas/:nombre/enviar', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await enviarPlantilla({
      nombre: req.params.nombre,
      contacto: req.body?.contacto,
      idioma: req.body?.idioma,
      // Diccionario por hueco ("BODY:1", "HEADER:mascota"). Los arrays son la
      // forma vieja y siguen valiendo.
      valores: req.body?.valores && typeof req.body.valores === 'object' ? req.body.valores : {},
      servicioId: req.body?.servicioId || null,
      variables: Array.isArray(req.body?.variables) ? req.body.variables : null,
      variablesBoton: Array.isArray(req.body?.variablesBoton) ? req.body.variablesBoton : null,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-plantillas/enviar', e) }
})

// ── Envíos masivos: campañas (migración 104) ──
// Mandar una plantilla a 203 clínicas no es un bucle: no se puede deshacer,
// Meta tiene cupo, y el backend se reinicia. Ver whatsapp-campanas.js.
app.get('/whatsapp/audiencias', requireAuth, rolBandeja, (_req, res) => {
  const r = listarAudiencias()
  res.status(r.status).json(r.body)
})

// A cuántos iría y qué huecos quedarían en blanco — SIN mandar nada. Es lo
// único que se mira antes de apretar el botón, así que tiene que ser exacto.
app.post('/whatsapp/campanas/previsualizar', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await previsualizar({
      audiencia: req.body?.audiencia, filtros: req.body?.filtros,
      plantilla: req.body?.plantilla, idioma: req.body?.idioma,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/previsualizar', e) }
})

app.get('/whatsapp/campanas', requireAuth, rolBandeja, async (_req, res) => {
  try {
    const r = await listarCampanas()
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/listar', e) }
})

// Crear NO envía: deja la campaña en BORRADOR con su lista armada, para poder
// mirarla antes.
app.post('/whatsapp/campanas', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await crearCampana({
      nombre: req.body?.nombre, plantilla: req.body?.plantilla, idioma: req.body?.idioma,
      audiencia: req.body?.audiencia, filtros: req.body?.filtros,
      // Los números marcados en la tabla. Solo pueden QUITAR gente: la lista se
      // recalcula en el servidor.
      seleccion: Array.isArray(req.body?.seleccion) ? req.body.seleccion : null,
      valoresFijos: req.body?.valoresFijos, porHora: req.body?.porHora,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/crear', e) }
})

app.get('/whatsapp/campanas/:id', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await detalleCampana({ id: req.params.id, estado: req.query.estado || null })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/detalle', e) }
})

app.post('/whatsapp/campanas/:id/:accion', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await accionCampana({
      id: req.params.id, accion: req.params.accion, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/accion', e) }
})

app.delete('/whatsapp/campanas/:id', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await borrarCampana({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa-campanas/borrar', e) }
})

// ── Archivos recibidos por WhatsApp (migración 094) ──
// Los bytes NO salen por PostgREST ni por una URL pública: son fotos de
// conversaciones con clínicas y familias. Se sirven aquí, con sesión y rol, y
// por eso la bandeja los pide con fetch + Bearer y los pinta desde un blob (un
// <img src> no puede mandar cabeceras).
app.get('/whatsapp/media/:mensajeId', requireAuth, rolBandeja, async (req, res) => {
  try {
    const m = await leerMedia(req.params.mensajeId)
    if (!m) return res.status(404).json({ ok: false, error: 'No hay archivo para ese mensaje' })
    if (!m.archivo) {
      // Se intentó y no se pudo. El motivo viaja para que la bandeja lo muestre
      // en vez de dejar un hueco que parece un error de la pantalla.
      return res.status(410).json({ ok: false, error: m.error || 'El archivo no se pudo descargar' })
    }
    res.set('Content-Type', m.mime || 'application/octet-stream')
    // Privado: es contenido de una conversación, no debe quedar en caches
    // intermedias. En el navegador sí se puede reusar mientras dure la sesión.
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(m.archivo)
  } catch (e) {
    log('[wa-bandeja/media] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Mensajes interactivos: botones, menus y boton de enlace (migracion 100) ──
// El catalogo lo edita David; aqui solo se lista y se envia.

app.get('/whatsapp/interactivos', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await listarInteractivos()
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/interactivos', e) }
})

// Imagen, audio, video o documento: el tipo lo decide el MIME del archivo.
// `/whatsapp/imagen` se mantiene porque la PWA cacheada sigue llamándolo.
async function rutaArchivo(req, res) {
  try {
    const r = await enviarArchivo({
      contacto: req.body?.contacto, base64: req.body?.base64, mime: req.body?.mime,
      nombre: req.body?.nombre, pie: req.body?.pie,
      personalId: req.personal.id, enviarSobre,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/archivo', e) }
}
app.post('/whatsapp/archivo', requireAuth, rolBandeja, rutaArchivo)
app.post('/whatsapp/imagen',  requireAuth, rolBandeja, rutaArchivo)

app.post('/whatsapp/interactivos', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await guardarInteractivo({ id: req.body?.id || null, datos: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/interactivo-guardar', e) }
})

app.delete('/whatsapp/interactivos/:id', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await borrarInteractivo({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/interactivo-borrar', e) }
})

app.post('/whatsapp/conversaciones/:contacto/interactivo', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await enviarInteractivo({
      contacto: req.params.contacto, clave: req.body?.clave,
      personalId: req.personal.id, enviarSobre,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/interactivo-enviar', e) }
})

// ── Materiales: brochure, tarifario, instructivos (migración 101) ──
// El catálogo lo edita David y el agente manda de él. Salió de una vet pidiendo
// el brochure, que hubo que mandarle a mano por la otra línea.

app.get('/whatsapp/materiales', requireAuth, rolBandeja, async (_req, res) => {
  try {
    const r = await listarMateriales()
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/materiales', e) }
})

// Los bytes, para poder ver el archivo antes de mandárselo a una clínica. Con
// sesión y rol, igual que los adjuntos: no hay URL pública de nada que salga
// por esta línea.
app.get('/whatsapp/materiales/:id/archivo', requireAuth, rolBandeja, async (req, res) => {
  try {
    const m = await leerMaterial(req.params.id)
    if (!m) return res.status(404).json({ ok: false, error: 'Ese material ya no existe' })
    res.set('Content-Type', m.mime || 'application/octet-stream')
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(m.nombre_archivo)}"`)
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(m.archivo)
  } catch (e) { errorInterno(res, 'wa/material-archivo', e) }
})

app.post('/whatsapp/materiales', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await guardarMaterial({ id: req.body?.id || null, datos: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/material-guardar', e) }
})

app.delete('/whatsapp/materiales/:id', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await borrarMaterial({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/material-borrar', e) }
})

app.post('/whatsapp/conversaciones/:contacto/material', requireAuth, rolBandeja, async (req, res) => {
  try {
    const r = await enviarMaterial({
      contacto: req.params.contacto, clave: req.body?.clave,
      personalId: req.personal.id, enviarSobre,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'wa/material-enviar', e) }
})

// ── Configuración del agente de WhatsApp (migración 088) ──
// Las tablas del agente NO están expuestas por PostgREST: esta es la única
// puerta. Mismo rol que la bandeja — quien atiende la línea es quien la ajusta.
const rolAgente = requireRol('COORDINADOR', 'ADMIN')

app.get('/agente/:clave', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await obtenerAgente({ clave: req.params.clave })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/obtener', e) }
})

app.post('/agente/:clave', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await guardarAgente({
      clave: req.params.clave, datos: req.body || {}, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/guardar', e) }
})

// ── Valoraciones y reglas (migración 099) ──
// ⚠️ TODAS cuelgan de dos segmentos a propósito: `GET /agente/:clave` y
// `POST /agente/:clave` son de un solo segmento y se comerían cualquier ruta
// nueva tipo `/agente/valoraciones` — Express resuelve por orden de registro y
// el fallo sería mudo (leería "valoraciones" como el nombre del agente).

app.post('/agente/valoraciones/nueva', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await valorarRespuesta({
      mensajeId: req.body?.mensaje_id, buena: req.body?.buena,
      correccion: req.body?.correccion, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/valorar', e) }
})

app.get('/agente/valoraciones/:agenteId', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await listarValoraciones({
      agenteId: Number(req.params.agenteId), estado: req.query.estado || 'NUEVA',
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/valoraciones', e) }
})

app.post('/agente/valoraciones/:id/aplicar', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await aplicarValoracion({
      id: req.params.id, texto: req.body?.texto, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/valoracion-aplicar', e) }
})

app.post('/agente/valoraciones/:id/descartar', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await descartarValoracion({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/valoracion-descartar', e) }
})

app.get('/agente/reglas/:agenteId', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await listarReglas({ agenteId: Number(req.params.agenteId) })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/reglas', e) }
})

app.post('/agente/reglas/:agenteId', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await crearRegla({
      agenteId: Number(req.params.agenteId), texto: req.body?.texto, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/regla-crear', e) }
})

app.patch('/agente/reglas/regla/:id', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await guardarRegla({ id: req.params.id, datos: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/regla-guardar', e) }
})

app.delete('/agente/reglas/regla/:id', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await borrarRegla({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/regla-borrar', e) }
})

app.post('/agente/conocimiento/:agenteId', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await agregarConocimiento({
      agenteId: Number(req.params.agenteId), datos: req.body || {}, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/kb-agregar', e) }
})

app.patch('/agente/conocimiento/pieza/:id', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await actualizarConocimiento({ id: Number(req.params.id), datos: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/kb-actualizar', e) }
})

app.delete('/agente/conocimiento/pieza/:id', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await borrarConocimiento({ id: Number(req.params.id) })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/kb-borrar', e) }
})

app.get('/agente/conocimiento/pieza/:id/archivo', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await archivoConocimiento({ id: Number(req.params.id) })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/kb-archivo', e) }
})

// Probar sin enviar nada por WhatsApp. No comprueba si el agente está activo:
// probar es justo lo que se hace ANTES de encenderlo.
app.post('/agente/:clave/probar', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await probarAgente({ clave: req.params.clave, mensaje: req.body?.mensaje })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/probar', e) }
})

app.get('/agente/:agenteId/ejecuciones', requireAuth, rolAgente, async (req, res) => {
  try {
    const r = await listarEjecuciones({
      agenteId: Number(req.params.agenteId), limite: req.query.limite,
    })
    res.status(r.status).json(r.body)
  } catch (e) { errorInterno(res, 'agente/ejecuciones', e) }
})

// ── Jobs (los dispara el cron del VPS a diario; cada job decide si aplica) ──
app.post('/jobs/generar-propuesta', requireJob, async (req, res) => {
  try {
    res.json(await generarPropuesta({ force: req.query.force === '1' }))
  } catch (e) {
    log('[propuesta] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/jobs/alertas', requireJob, async (_req, res) => {
  try {
    res.json(await motorAlertas())
  } catch (e) {
    log('[alertas] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/jobs/grupales', requireJob, async (_req, res) => {
  try {
    res.json(await jobReportesGrupales())
  } catch (e) {
    log('[grupales] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Job: preparar contactos de solicitud de imágenes (NO envía) ──
app.post('/jobs/contactos-imagenes', requireJob, async (_req, res) => {
  try {
    res.json(await jobContactosImagenes())
  } catch (e) {
    log('[imagenes/job] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Job: cadencia automática del 2º y 3er contacto (migración 044) ──
// ?dry=1 → simula (no envía, no cierra): sirve para ver a quién le tocaría hoy.
app.post('/jobs/seguimiento-imagenes', requireJob, async (req, res) => {
  try {
    res.json(await jobSeguimientoImagenes({ dryRun: req.query.dry === '1' }))
  } catch (e) {
    log('[seguimiento-imagenes/job] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Job: vencimientos de afiliaciones pre-exequiales (VENCIDA / CANCELADA) ──
app.post('/jobs/afiliaciones', requireJob, async (_req, res) => {
  try {
    res.json(await jobAfiliaciones())
  } catch (e) {
    log('[afiliaciones] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Afiliaciones: enviar el contrato PDF por correo (SMTP del hosting) ──
app.post('/afiliaciones/contratos/:id/enviar-email', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarContratoEmail({
      contratoId: req.params.id,
      email: req.body?.email,
      signedUrl: req.body?.signed_url,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[afiliaciones/enviar-email] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Solicitud de imágenes — el coordinador valida y autoriza el envío ──
app.post('/imagenes/preparar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (_req, res) => {
  try {
    res.json(await jobContactosImagenes())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/enviar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id, body: { fromNumber: req.body.fromNumber } })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/enviar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/reintentar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id, body: { fromNumber: req.body.fromNumber, reintentar: true } })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/reintentar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/cancelar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await cancelarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/cancelar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Bitácora de contactos + fecha del próximo (días hábiles calculados en la DB).
app.get('/imagenes/seguimiento', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (_req, res) => {
  try {
    res.json({ ok: true, seguimiento: await resumenSeguimiento() })
  } catch (e) {
    log('[imagenes/seguimiento] ERROR', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Adelantar el 2º/3er contacto sin esperar al cron (lo decide una persona).
app.post('/imagenes/forzar-contacto', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await forzarContacto({
      solicitudId: req.body.solicitud_id, numero: req.body.numero, personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/forzar-contacto] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Sacar un caso de la cadencia automática (cliente sensible, ya se habló por teléfono).
app.post('/imagenes/pausar-seguimiento', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await pausarSeguimiento({ solicitudId: req.body.solicitud_id, pausado: req.body.pausado })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/pausar-seguimiento] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Portal público de imágenes (el código de acceso es el secreto; sin JWT) ──
app.get('/portal/imagenes/:codigo', async (req, res) => {
  try {
    const r = await datosPortal({ codigo: req.params.codigo })
    res.status(r.status).json(r.body)
  } catch (e) {
    errorInterno(res, 'portal/imagenes GET', e)
  }
})

app.post('/portal/imagenes/:codigo', async (req, res) => {
  try {
    const r = await recibirImagenesPortal({ codigo: req.params.codigo, payload: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) {
    errorInterno(res, 'portal/imagenes POST', e)
  }
})

// ── Portal de aliados (público; el token del enlace es el secreto, sin JWT) ──
// Flujo A: el aliado validado confirma su vet y envía la solicitud de servicio.
app.post('/portal/aliado/validar', async (req, res) => {
  try {
    const r = await validarTokenPortal({ token: req.body?.token })
    res.status(r.status).json(r.body)
  } catch (e) {
    errorInterno(res, 'portal/aliado/validar', e)
  }
})

app.post('/portal/aliado/solicitud', async (req, res) => {
  try {
    const r = await crearSolicitudAliado({ token: req.body?.token, payload: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) {
    errorInterno(res, 'portal/aliado/solicitud', e)
  }
})

// Flujo B: una veterinaria NO aliada solicita afiliación (queda pendiente_validacion).
app.post('/portal/aliado/afiliacion', async (req, res) => {
  try {
    const r = await registrarAfiliacion({ payload: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) {
    errorInterno(res, 'portal/aliado/afiliacion', e)
  }
})

// Coordinador/Admin aprueba una vet pendiente: genera token y devuelve el enlace.
app.post('/aliados/:id/aprobar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await aprobarAliado({ aliadoId: req.params.id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[aliados/aprobar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Reportes Grupales — escrituras críticas, transaccionales (solo backend) ──
app.post('/grupales/sincronizar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (_req, res) => {
  try {
    res.json(await jobReportesGrupales())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/agregar-a-lote', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await agregarServicioAReporteGrupal({
      servicioId: req.body.servicio_id,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/agregar-a-lote] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/reportes/:id/generar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await marcarGenerado({ reporteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/generar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/reportes/:id/enviar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarReporte({ reporteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/enviar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/desvincular', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await desvincularServicioDeGrupal({
      servicioId: req.body.servicio_id, personalId: req.personal.id,
      motivo: req.body.motivo, manual: req.body.manual === true,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/desvincular] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Asistente IA (solo sugiere; el humano confirma) ──
app.post('/grupales/ia/resumen', requireAuth, async (_req, res) => {
  try {
    res.json(await resumenPendientes())
  } catch (e) {
    log('[grupales/ia/resumen] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/ia/redactar', requireAuth, async (req, res) => {
  try {
    res.json(await redactarMensaje({ itemId: req.body.item_id }))
  } catch (e) {
    log('[grupales/ia/redactar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/ia/control', requireAuth, async (_req, res) => {
  try {
    res.json(await alertaVencimientos())
  } catch (e) {
    log('[grupales/ia/control] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Asistente IA del cuadre de técnicos (Finanzas; solo sugiere, no escribe) ──
app.post('/cuadres/ia/analizar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await analizarCuadre({ cuadreId: req.body?.cuadre_id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[cuadres/ia/analizar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Tenjo (primeros endpoints; la migración desde PostgREST será gradual) ──
app.get('/tenjo/candidatos', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.v_candidatos_tenjo ORDER BY fecha_ingreso ASC`
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/tenjo/generar-propuesta', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    res.json(await generarPropuesta({ force: true }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Escrituras críticas — transaccionales, solo vía backend (Fase 3)
app.post('/tenjo/lotes/:id/confirmar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await confirmarLote({ loteId: req.params.id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[confirmar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/tenjo/lotes/:id/cerrar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await cerrarLote({ loteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[cerrar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Digitales (memorial + video + short: publicación y envío al cliente) ──
// El PRODUCTOR gestiona las piezas digitales igual que coordinación.
const rolDigitales = requireRol('COORDINADOR', 'ADMIN', 'PRODUCTOR')

app.get('/digitales/candidatos', requireAuth, rolDigitales, async (_req, res) => {
  try {
    res.json(await listarCandidatos())
  } catch (e) {
    log('[digitales/candidatos] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/digitales/servicios', requireAuth, rolDigitales, async (_req, res) => {
  try {
    res.json(await listarServicios())
  } catch (e) {
    log('[digitales/servicios] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/digitales/generar', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await generarMemorial({ servicioId: req.body.servicio_id, personalId: req.personal.id, formato: req.body.formato, ajuste: req.body.ajuste })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/generar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// VIDEO/SHORT hechos en Canva: registrar el enlace de YouTube.
app.post('/digitales/enlace', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await registrarEnlace({ servicioId: req.body.servicio_id, tipo: req.body.tipo, url: req.body.url, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/enlace] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Envío de enlaces al cliente: registro + marca ENTREGADO en servicio_recordatorios.
app.post('/digitales/:servicioId/envio', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await registrarEnvio({ servicioId: req.params.servicioId, personalId: req.personal.id, telefono: req.body.telefono, mensaje: req.body.mensaje, canal: req.body.canal })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/envio] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Envío automático por Zolutium (plantilla HSM aprobada): red + evidencia en el backend.
app.post('/digitales/:servicioId/enviar-zolutium', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await enviarZolutium({ servicioId: req.params.servicioId, personalId: req.personal.id, telefono: req.body.telefono })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/enviar-zolutium] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/digitales/:id/aprobar', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await aprobarMemorial({ id: req.params.id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/aprobar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Registro manual del enlace (fallback del memorial / corrección).
app.post('/digitales/:id/publicar', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await publicarManual({ id: req.params.id, personalId: req.personal.id, url: req.body.url ?? req.body.instagram_url })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/publicar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Publicación automática en Instagram (Meta Graph API, Reels).
app.post('/digitales/:id/publicar-instagram', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await publicarInstagram({ id: req.params.id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/publicar-instagram] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/digitales/:id/descartar', requireAuth, rolDigitales, async (req, res) => {
  try {
    const r = await descartarPieza({ id: req.params.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[digitales/descartar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Archivo del memorial — enlace firmado (sin JWT) para <video>, descarga y Meta.
// Se mantiene el alias /memoriales/:id/archivo por enlaces firmados aún vigentes.
app.get(['/digitales/:id/archivo', '/memoriales/:id/archivo'], async (req, res) => {
  try {
    await servirArchivo(req, res)
  } catch (e) {
    log('[digitales/archivo] ERROR', e.message)
    if (!res.headersSent) res.status(500).end('Error interno')
  }
})

const PORT = parseInt(process.env.PORT) || 8787
app.listen(PORT, () => {
  log(`orbit-backend escuchando en :${PORT} (TZ=${process.env.TZ || 'UTC'})`)
  // Se arranca DESPUÉS de escuchar: si el barrido tuviera un problema, que no
  // impida levantar el servidor. Ver migración 098.
  arrancarSeguimientos()
  // Los envíos masivos también: el estado vive en la tabla, así que retomar
  // una campaña a medias tras un reinicio es justo lo que tiene que pasar.
  arrancarCampanas()
})
