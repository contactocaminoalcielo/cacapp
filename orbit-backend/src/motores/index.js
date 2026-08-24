// El MOTOR de un agente: con qué IA piensa.
//
// Hasta la migración 112, `agente_wa.modelo` guardaba un id y el código daba por
// hecho que era de Anthropic. No era una suposición inocente: la forma de las
// herramientas, la caché de contexto, el razonamiento y hasta los campos de
// consumo son propios de esa API. Cambiar de proveedor no era cambiar un texto,
// era otro dialecto entero.
//
// Aquí vive la traducción. El resto del agente —el bucle de herramientas, la
// bitácora, el registro de costos— no sabe con qué IA está hablando.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🩸 LA FORMA CANÓNICA INTERNA ES LA DE ANTHROPIC, Y ES UNA DECISIÓN, NO UN
// DESCUIDO.
//
// Lo "limpio" sería inventar un formato neutro y traducir a los dos lados. Se
// descartó: el historial, las fotos y el bucle de herramientas ya hablan
// Anthropic y llevan meses en producción atendiendo clínicas reales. Reescribir
// todo eso para estrenar un formato neutro es arriesgar el camino que funciona
// para beneficiar al que todavía no existe.
//
// Así, el adaptador de Anthropic es la identidad —cero riesgo— y los demás
// traducen en el borde. El día que Anthropic deje de ser el principal, se
// revisa; hoy sería optimizar para un futuro que no ha llegado.
// ─────────────────────────────────────────────────────────────────────────────
//
// Cada adaptador expone lo mismo:
//
//   pensar({ agente, system, messages, herramientas, maxTokens })
//     → { texto, llamadas: [{id, nombre, entrada}], uso, fin, nativo }
//
//   mensajeAsistente(resultado)        → qué empujar al historial como assistant
//   mensajeResultados([{id, contenido, error}]) → cómo devolverle lo que dieron
//
// `uso` viene normalizado a lo que necesita el libro de cuentas:
//   { entrada, salida, cacheEscritura, cacheLectura }
import { log } from '../db.js'

const MOD = '[motor]'

const ADAPTADORES = {
  ANTHROPIC: () => import('./anthropic.js'),
  OPENAI:    () => import('./openai.js'),
}

/** Los proveedores que el código sabe manejar. La pantalla no ofrece otros. */
export const PROVEEDORES = Object.keys(ADAPTADORES)

export async function motorDe(agente) {
  const clave = String(agente?.proveedor || 'ANTHROPIC').toUpperCase()
  const cargar = ADAPTADORES[clave]
  if (!cargar) {
    throw new Error(
      `El agente está configurado con el motor "${clave}", que este servidor no sabe manejar. ` +
      `Los que hay son: ${PROVEEDORES.join(', ')}.`
    )
  }
  return cargar()
}

/**
 * ¿Está listo para usarse este proveedor?
 *
 * Se pregunta ANTES de dejar elegirlo en la pantalla. Un desplegable que ofrece
 * un motor sin llave configurada no es una opción: es una trampa que solo se
 * descubre cuando una clínica escribe y el agente no contesta.
 */
export async function estadoDeProveedores() {
  const estado = []
  for (const clave of PROVEEDORES) {
    try {
      const m = await ADAPTADORES[clave]()
      estado.push({ proveedor: clave, ...m.estado() })
    } catch (e) {
      estado.push({ proveedor: clave, listo: false, motivo: e.message })
    }
  }
  return estado
}

/** Pensar, con el motor que tenga configurado este agente. */
export async function pensar(opciones) {
  const m = await motorDe(opciones.agente)
  const r = await m.pensar(opciones)
  if (!r?.nativo) log(MOD, `${opciones.agente?.proveedor}: respuesta sin contenido nativo`)
  return r
}

export async function mensajeAsistente(agente, resultado) {
  return (await motorDe(agente)).mensajeAsistente(resultado)
}

export async function mensajeResultados(agente, items) {
  return (await motorDe(agente)).mensajeResultados(items)
}
