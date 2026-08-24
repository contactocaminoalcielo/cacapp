// El MARCO de agentes: crear, configurar y LLEVARSE un agente.
//
// 🩸 POR QUÉ EXISTE ESTE ARCHIVO, en palabras de David y repetidas dos veces:
// *"toda configuración me la pides configurar por acá, y la idea es tener un
// agente personalizable... si mañana quiero poner un agente en otro sistema, que
// solo sea llevar la estructura y configurarla"*.
//
// Tenía razón. Las migraciones 110 y 112 volvieron DATO lo que era código —qué
// herramientas tiene cada agente, con qué motor piensa, sus catálogos— pero sin
// una puerta para tocarlo, cada cambio seguía pasando por alguien escribiendo
// SQL. Un modelo de datos configurable sin interfaz no es configurable.
//
// Aquí está esa puerta, y con ella la parte que faltaba para "llevárselo":
// EXPORTAR e IMPORTAR la definición completa de un agente como un archivo.
import { pool, log } from './db.js'
import { PROVEEDORES, estadoDeProveedores } from './motores/index.js'
import { HERRAMIENTAS_DISPONIBLES } from './agente-wa.js'

const MOD = '[agente-marco]'

const CLAVE_OK = /^[A-Z][A-Z0-9_]{2,29}$/
const CATEGORIAS = ['GENERAL', 'VENTAS', 'SOPORTE', 'GESTION', 'COBRANZAS', 'ADMINISTRATIVO', 'OPERATIVO']
const IDIOMA_OK = /^[a-z]{2}(-[A-Z]{2})?$/
const CLAVE_SECRETA = /(^|_)(password|secret|token|api_?key|authorization|credential|cookie)s?$/i

function rutaDeSecreto(valor, ruta = []) {
  if (!valor || typeof valor !== 'object') return null
  for (const [clave, hijo] of Object.entries(valor)) {
    const siguiente = [...ruta, clave]
    if (CLAVE_SECRETA.test(clave) && hijo != null && hijo !== '') return siguiente.join('.')
    const dentro = rutaDeSecreto(hijo, siguiente)
    if (dentro) return dentro
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Motores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los motores del catálogo, con el estado REAL de cada proveedor.
 *
 * ⚠️ El estado no es cosmético: un desplegable que ofrece un motor sin llave
 * configurada no es una opción, es una trampa que solo se descubre cuando una
 * clínica escribe y el agente no contesta.
 */
export async function listarMotores() {
  const { rows } = await pool.query(
    `SELECT id, proveedor, modelo, etiqueta, ayuda, razona, cachea, ve, activo, orden
       FROM public.ia_motores ORDER BY proveedor, orden, etiqueta`
  )
  return {
    status: 200,
    body: { ok: true, motores: rows, proveedores: await estadoDeProveedores() },
  }
}

export async function guardarMotor({ id, datos = {} }) {
  const d = datos
  const proveedor = String(d.proveedor || '').toUpperCase()
  if (!PROVEEDORES.includes(proveedor)) {
    return { status: 400, body: { ok: false, error: `El proveedor debe ser uno de: ${PROVEEDORES.join(', ')}` } }
  }
  const modelo = String(d.modelo || '').trim()
  if (!modelo) return { status: 400, body: { ok: false, error: 'Falta el identificador del modelo' } }

  if (id) {
    const { rows } = await pool.query(
      `UPDATE public.ia_motores
          SET proveedor=$2, modelo=$3, etiqueta=$4, ayuda=$5,
              razona=$6, cachea=$7, ve=$8, activo=$9, orden=$10
        WHERE id=$1 RETURNING *`,
      [id, proveedor, modelo, d.etiqueta || modelo, d.ayuda || null,
       !!d.razona, !!d.cachea, d.ve !== false, d.activo !== false, Number(d.orden) || 0]
    )
    if (!rows.length) return { status: 404, body: { ok: false, error: 'No existe ese motor' } }
    return { status: 200, body: { ok: true, motor: rows[0] } }
  }

  const { rows } = await pool.query(
    `INSERT INTO public.ia_motores (proveedor, modelo, etiqueta, ayuda, razona, cachea, ve, activo, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (proveedor, modelo) DO UPDATE SET
       etiqueta=EXCLUDED.etiqueta, ayuda=EXCLUDED.ayuda, razona=EXCLUDED.razona,
       cachea=EXCLUDED.cachea, ve=EXCLUDED.ve, activo=EXCLUDED.activo, orden=EXCLUDED.orden
     RETURNING *`,
    [proveedor, modelo, d.etiqueta || modelo, d.ayuda || null,
     !!d.razona, !!d.cachea, d.ve !== false, d.activo !== false, Number(d.orden) || 0]
  )
  return { status: 200, body: { ok: true, motor: rows[0] } }
}

export async function borrarMotor(id) {
  const { rowCount } = await pool.query(`DELETE FROM public.ia_motores WHERE id = $1`, [id])
  return { status: 200, body: { ok: true, borrados: rowCount } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Herramientas de un agente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué herramientas puede tener este agente y cuáles tiene encendidas.
 *
 * 🩸 LO QUE UNA HERRAMIENTA **HACE** ES CÓDIGO Y VA A SEGUIR SIÉNDOLO: registrar
 * una solicitud escribe en la operación. Lo que se configura es CUÁLES tiene
 * cada agente y CÓMO se le explican al modelo — y eso último es lo que permite
 * que la misma herramienta se le describa distinto a dos empresas.
 *
 * Las marcadas `propia_del_negocio` escriben en la operación de Camino al Cielo:
 * un agente de otra empresa NO debería encenderlas. La pantalla lo avisa.
 */
export async function herramientasDeAgente(agenteId) {
  const { rows } = await pool.query(
    `SELECT clave, activa, descripcion, config, orden
       FROM public.agente_wa_herramientas WHERE agente_id = $1`,
    [agenteId]
  )
  const puestas = new Map(rows.map(r => [r.clave, r]))
  return {
    status: 200,
    body: {
      ok: true,
      herramientas: HERRAMIENTAS_DISPONIBLES.map(h => ({
        ...h,
        activa: puestas.get(h.clave)?.activa ?? false,
        descripcion: puestas.get(h.clave)?.descripcion ?? null,
        config: puestas.get(h.clave)?.config ?? {},
        orden: puestas.get(h.clave)?.orden ?? h.orden,
      })),
    },
  }
}

export async function guardarHerramientasDeAgente({ agenteId, herramientas = [] }) {
  const conocidas = new Set(HERRAMIENTAS_DISPONIBLES.map(h => h.clave))
  const secreto = rutaDeSecreto(herramientas)
  if (secreto) {
    return { status: 400, body: { ok: false, error: `La configuración contiene un posible secreto en ${secreto}. Las credenciales no pertenecen al agente.` } }
  }
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    for (const h of herramientas) {
      // Una clave que no casa con ninguna implementación no se guarda: sería una
      // herramienta que el motor ofrece al modelo y nadie sabe ejecutar.
      if (!conocidas.has(h.clave)) continue
      if (h.activa) {
        await cliente.query(
          `INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, descripcion, config, orden)
           VALUES ($1,$2,true,$3,$4::jsonb,$5)
           ON CONFLICT (agente_id, clave) DO UPDATE
             SET activa = true, descripcion = EXCLUDED.descripcion,
                 config = EXCLUDED.config, orden = EXCLUDED.orden`,
          [agenteId, h.clave, (h.descripcion || '').trim().slice(0, 4000) || null,
           JSON.stringify(h.config && typeof h.config === 'object' ? h.config : {}), Number(h.orden) || 0]
        )
      } else {
        await cliente.query(
          `DELETE FROM public.agente_wa_herramientas WHERE agente_id = $1 AND clave = $2`,
          [agenteId, h.clave]
        )
      }
    }
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  } finally {
    cliente.release()
  }
  return herramientasDeAgente(agenteId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Crear un agente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un agente nuevo, desde la pantalla.
 *
 * ⚠️ Nace APAGADO y SIN LÍNEAS, siempre. Un agente que se enciende al crearse
 * empezaría a contestarle a clínicas reales con un contexto a medio escribir, y
 * eso sale a nombre de la empresa. Encenderlo es un acto aparte y deliberado.
 *
 * Y nace SIN HERRAMIENTAS: se le van dando las que necesite. Es la opción segura
 * por defecto — ver `construirHerramientas`.
 */
export async function crearAgente({ datos = {}, personalId }) {
  const clave = String(datos.clave || '').trim().toUpperCase()
  if (!CLAVE_OK.test(clave)) {
    return {
      status: 400,
      body: { ok: false, error: 'La clave va en MAYÚSCULAS, sin espacios, de 3 a 30 caracteres. Ej: DISENO, FAMILIAS' },
    }
  }
  const nombre = String(datos.nombre || '').trim()
  if (!nombre) return { status: 400, body: { ok: false, error: 'Falta el nombre del agente' } }

  const categoria = String(datos.categoria || 'GENERAL').toUpperCase()
  if (!CATEGORIAS.includes(categoria)) {
    return { status: 400, body: { ok: false, error: `La categoría debe ser una de: ${CATEGORIAS.join(', ')}` } }
  }
  const objetivo = String(datos.objetivo || '').trim()
  if (!objetivo) return { status: 400, body: { ok: false, error: 'Falta definir el objetivo del agente' } }
  if (objetivo.length > 1200) return { status: 400, body: { ok: false, error: 'El objetivo es demasiado largo' } }
  const idioma = String(datos.idioma || 'es').trim()
  if (!IDIOMA_OK.test(idioma)) return { status: 400, body: { ok: false, error: 'El idioma debe verse como es o es-CO' } }

  const proveedor = String(datos.proveedor || 'ANTHROPIC').toUpperCase()
  if (!PROVEEDORES.includes(proveedor)) {
    return { status: 400, body: { ok: false, error: `El motor debe ser uno de: ${PROVEEDORES.join(', ')}` } }
  }
  const modelo = String(datos.modelo || '').trim()
  if (!modelo) return { status: 400, body: { ok: false, error: 'Falta elegir el modelo' } }
  const { rows: [motor] } = await pool.query(
    `SELECT 1 FROM public.ia_motores WHERE proveedor = $1 AND modelo = $2 AND activo`,
    [proveedor, modelo]
  )
  if (!motor) {
    return { status: 400, body: { ok: false, error: `El modelo ${modelo} no está activo para ${proveedor}` } }
  }

  const { rows: [existe] } = await pool.query(
    `SELECT 1 FROM public.agente_wa WHERE clave = $1`, [clave])
  if (existe) return { status: 409, body: { ok: false, error: `Ya existe un agente con la clave ${clave}` } }

  const { rows } = await pool.query(
    `INSERT INTO public.agente_wa
       (clave, nombre, etiqueta_menu, categoria, objetivo, idioma, activo, instrucciones,
        proveedor, modelo, effort, memoria_mensajes, phone_number_ids, actualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,'{}',$12)
     RETURNING id, clave, nombre, categoria, objetivo, idioma, activo, proveedor, modelo`,
    [clave, nombre, String(datos.etiqueta_menu || nombre).slice(0, 40),
     categoria, objetivo, idioma,
     String(datos.instrucciones || '').trim() || 'Responde solo con la información autorizada en tu base de conocimiento. Si no sabes algo, dilo y ofrece escalarlo a una persona.',
     proveedor, modelo, datos.effort || 'medium',
     Math.max(2, Math.min(Number(datos.memoria_mensajes) || 20, 100)), personalId || null]
  )
  log(MOD, `agente ${clave} creado (apagado, sin líneas) por personal=${personalId || '?'}`)
  return { status: 200, body: { ok: true, agente: rows[0] } }
}

export async function borrarAgente({ clave, personalId }) {
  const { rows: [a] } = await pool.query(
    `SELECT id, activo, phone_number_ids FROM public.agente_wa WHERE clave = $1`, [clave])
  if (!a) return { status: 404, body: { ok: false, error: 'No existe ese agente' } }
  // Borrar un agente encendido dejaría su línea sin nadie que conteste, y nadie
  // se enteraría hasta que una clínica escribiera al vacío.
  if (a.activo || (a.phone_number_ids || []).length) {
    return {
      status: 409,
      body: { ok: false, error: 'Apágalo y quítale las líneas antes de borrarlo.' },
    }
  }
  await pool.query(`DELETE FROM public.agente_wa WHERE id = $1`, [a.id])
  log(MOD, `agente ${clave} BORRADO por personal=${personalId || '?'}`)
  return { status: 200, body: { ok: true } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Llevarse el agente
// ─────────────────────────────────────────────────────────────────────────────

/** La versión del formato. Si cambia la forma, esto sube y el import lo sabe. */
const FORMATO = 1
const SCHEMA = 'orbit-agent/v1'

/**
 * La definición COMPLETA de un agente, en un archivo.
 *
 * 🩸 ESTO ES LO QUE DAVID PEDÍA CUANDO DECÍA "LLEVAR LA ESTRUCTURA". Sin esto,
 * montar el mismo agente en otro sitio era volver a escribirlo todo a mano y
 * rezar por no olvidar una regla.
 *
 * Va TODO lo que define su comportamiento: instrucciones, base de conocimiento,
 * reglas, herramientas con sus descripciones propias, catálogos y motor.
 *
 * ⚠️ Lo que NO va, a propósito:
 *   · Los `phone_number_ids` — son de ESTE Meta, no del sistema de destino, y
 *     copiarlos haría que dos agentes se pelearan por la misma línea.
 *   · `activo` — llega apagado, siempre. Ver `crearAgente`.
 *   · La bitácora y los costos: son historia de este sistema, no definición.
 *   · Los archivos binarios de los materiales, que pueden pesar megas. Van sus
 *     claves y descripciones para que se vea qué falta subir.
 */
export async function exportarAgente(clave) {
  const { rows: [a] } = await pool.query(
    `SELECT id, clave, nombre, etiqueta_menu, categoria, objetivo, idioma, instrucciones,
            proveedor, modelo, effort, max_turnos, memoria_mensajes,
            espera_ms, espera_max_ms, seguimiento_enlace_minutos,
            seguimiento_enlace_texto, voz_id, voz_modelo, saludo_voz
       FROM public.agente_wa WHERE clave = $1`, [clave])
  if (!a) return { status: 404, body: { ok: false, error: 'No existe ese agente' } }

  const q = async (sql) => (await pool.query(sql, [a.id])).rows
  const [conocimiento, reglas, herramientas, materiales, interactivos, etiquetas] = await Promise.all([
    q(`SELECT tipo, titulo, texto, mime, bytes,
              CASE WHEN archivo IS NULL THEN NULL ELSE encode(archivo, 'base64') END AS archivo_base64,
              orden, activo FROM public.agente_wa_conocimiento
        WHERE agente_id = $1 ORDER BY orden, id`),
    q(`SELECT texto, orden, activo FROM public.agente_wa_reglas
        WHERE agente_id = $1 ORDER BY orden, id`),
    q(`SELECT clave, activa, descripcion, config, orden FROM public.agente_wa_herramientas
        WHERE agente_id = $1 ORDER BY orden, id`),
    q(`SELECT clave, nombre, descripcion, pie, usa_agente, activo, orden FROM public.whatsapp_materiales
        WHERE agente_id = $1 ORDER BY orden, id`),
    q(`SELECT clave, nombre, descripcion, tipo, encabezado, cuerpo, pie, boton_texto,
              opciones, url, usa_agente, activo, orden FROM public.whatsapp_interactivos
        WHERE agente_id = $1 ORDER BY orden, id`),
    q(`SELECT clave, nombre, descripcion, grupo, color, activo, orden FROM public.whatsapp_etiquetas
        WHERE agente_id = $1 ORDER BY orden, id`),
  ])

  const secreto = rutaDeSecreto(herramientas)
  if (secreto) {
    return {
      status: 409,
      body: { ok: false, error: `No se exportó: la configuración contiene un posible secreto en ${secreto}. Muévelo a las credenciales locales del sistema.` },
    }
  }

  const { id, ...agente } = a
  return {
    status: 200,
    body: {
      ok: true,
      definicion: {
        schema: SCHEMA,
        formato: FORMATO,
        exportado_en: new Date().toISOString(),
        agente,
        conocimiento, reglas, herramientas,
        catalogos: { materiales, interactivos, etiquetas },
        // Se dice lo que NO viaja, para que quien lo importe no lo dé por hecho.
        no_incluye: [
          'phone_number_ids (son de este Meta)',
          'activo (llega apagado)',
          'archivos binarios de los materiales (solo sus claves)',
          'imágenes de la base de conocimiento (solo su título)',
          'bitácora y costos (historia, no definición)',
          'credenciales, tokens y llaves de proveedores',
        ],
      },
    },
  }
}

/**
 * Monta un agente a partir de una definición exportada.
 *
 * Nace apagado y sin líneas, igual que uno creado a mano. `clave` permite
 * traerlo con otro nombre —para no chocar con el original si es el mismo
 * sistema— sin tocar el archivo.
 */
export async function importarAgente({ definicion, clave = null, personalId }) {
  const d = definicion || {}
  if (d.formato !== FORMATO || (d.schema && d.schema !== SCHEMA)) {
    return {
      status: 400,
      body: { ok: false, error: `Formato de definición desconocido; este servidor entiende ${SCHEMA}` },
    }
  }
  const secreto = rutaDeSecreto(d)
  if (secreto) {
    return { status: 400, body: { ok: false, error: `El paquete contiene un posible secreto en ${secreto} y no es seguro importarlo.` } }
  }
  const base = d.agente || {}
  const nueva = String(clave || base.clave || '').trim().toUpperCase()

  const creado = await crearAgente({
    datos: { ...base, clave: nueva, etiqueta_menu: base.etiqueta_menu || base.nombre },
    personalId,
  })
  if (!creado.body?.ok) return creado
  const agenteId = creado.body.agente.id

  // Las piezas de IMAGEN no viajan en la definición: se apuntan aquí para
  // avisar al final. Va FUERA del try porque los avisos se arman después.
  const imagenesPendientes = []
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    // Los ajustes que `crearAgente` no toma (nace con lo mínimo a propósito).
    await cliente.query(
      `UPDATE public.agente_wa SET max_turnos=COALESCE($2,max_turnos), espera_ms=COALESCE($3,espera_ms),
              espera_max_ms=COALESCE($4,espera_max_ms),
              seguimiento_enlace_minutos=COALESCE($5,seguimiento_enlace_minutos),
              seguimiento_enlace_texto=COALESCE($6,seguimiento_enlace_texto),
              voz_id=COALESCE($7,voz_id), voz_modelo=COALESCE($8,voz_modelo),
              saludo_voz=COALESCE($9,saludo_voz),
              memoria_mensajes=COALESCE($10,memoria_mensajes)
        WHERE id=$1`,
      [agenteId, base.max_turnos, base.espera_ms, base.espera_max_ms,
       base.seguimiento_enlace_minutos, base.seguimiento_enlace_texto,
       base.voz_id, base.voz_modelo, base.saludo_voz, base.memoria_mensajes]
    )

    for (const k of d.conocimiento || []) {
      if (!['TEXTO', 'TABLA', 'IMAGEN', 'DOCUMENTO'].includes(k.tipo)) continue
      // ⚠️ Las piezas de IMAGEN se saltan: el binario NO viaja en la definición
      // (igual que los materiales), así que crearlas aquí dejaría al agente con
      // una imagen vacía en su base de conocimiento — peor que no tenerla,
      // porque parece que está. Se listan en los avisos para volver a subirlas.
      if (k.tipo === 'IMAGEN') { imagenesPendientes.push(k.titulo || 'sin título'); continue }
      await cliente.query(
        `INSERT INTO public.agente_wa_conocimiento
           (agente_id, tipo, titulo, texto, orden, activo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [agenteId, k.tipo, String(k.titulo || 'Sin título').slice(0, 200),
         String(k.texto || ''), k.orden || 0, k.activo !== false])
    }
    for (const r of d.reglas || []) {
      await cliente.query(
        `INSERT INTO public.agente_wa_reglas (agente_id, texto, orden, activo)
         VALUES ($1,$2,$3,$4)`,
        [agenteId, r.texto, r.orden || 0, r.activo !== false])
    }
    const conocidas = new Set(HERRAMIENTAS_DISPONIBLES.map(h => h.clave))
    for (const h of d.herramientas || []) {
      if (!conocidas.has(h.clave)) continue
      await cliente.query(
        `INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, descripcion, config, orden)
         VALUES ($1,$2,$3,$4,COALESCE($5::jsonb,'{}'::jsonb),$6)
         ON CONFLICT (agente_id, clave) DO NOTHING`,
        [agenteId, h.clave, h.activa !== false, h.descripcion || null,
         // 🩸 Se serializa a mano y se castea. `node-pg` convierte un OBJETO a
         // JSON, pero un ARRAY a literal de array de PostgreSQL —que no es JSON
         // válido— y la columna jsonb lo rechaza con "invalid input syntax for
         // type json", sin decir cuál de los INSERT fue.
         JSON.stringify(h.config && typeof h.config === 'object' ? h.config : {}),
         h.orden || 0])
    }
    const cat = d.catalogos || {}
    for (const e of cat.etiquetas || []) {
      await cliente.query(
        `INSERT INTO public.whatsapp_etiquetas (agente_id, clave, nombre, descripcion, grupo, color, activo, orden, solo_sistema)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
         ON CONFLICT (agente_id, clave) DO NOTHING`,
        [agenteId, e.clave, e.nombre, e.descripcion, e.grupo, e.color, e.activo !== false, e.orden || 0])
    }
    for (const i of cat.interactivos || []) {
      await cliente.query(
        `INSERT INTO public.whatsapp_interactivos
           (agente_id, clave, nombre, descripcion, tipo, encabezado, cuerpo, pie, boton_texto, opciones, url, usa_agente, activo, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)
         ON CONFLICT (agente_id, clave) DO NOTHING`,
        [agenteId, i.clave, i.nombre, i.descripcion, i.tipo, i.encabezado, i.cuerpo, i.pie,
         // Mismo motivo que arriba: `opciones` es un ARRAY.
         i.boton_texto, JSON.stringify(i.opciones ?? []), i.url,
         i.usa_agente !== false, i.activo !== false, i.orden || 0])
    }
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    // El agente ya se creó fuera de la transacción; si el resto falla, se
    // deshace entero para no dejar media definición puesta.
    await pool.query(`DELETE FROM public.agente_wa WHERE id = $1`, [agenteId]).catch(() => {})
    return { status: 500, body: { ok: false, error: `No se pudo importar: ${e.message}` } }
  } finally {
    cliente.release()
  }

  // Los materiales llevan archivo, y el archivo no viaja. Se dice cuáles hay que
  // volver a subir en vez de dejar al agente prometiendo un PDF que no existe.
  const faltanArchivos = (d.catalogos?.materiales || []).map(m => m.clave)
  log(MOD, `agente ${nueva} importado (apagado, sin líneas) por personal=${personalId || '?'}`)
  return {
    status: 200,
    body: {
      ok: true,
      agente: creado.body.agente,
      avisos: [
        'Nace APAGADO y sin líneas: asígnale su número de Meta y enciéndelo cuando esté listo.',
        ...(faltanArchivos.length
          ? [`Hay que volver a subir estos materiales (el archivo no viaja): ${faltanArchivos.join(', ')}`]
          : []),
        ...(imagenesPendientes.length
          ? [`Hay que volver a subir estas imágenes de la base de conocimiento: ${imagenesPendientes.join(', ')}`]
          : []),
      ],
    },
  }
}
