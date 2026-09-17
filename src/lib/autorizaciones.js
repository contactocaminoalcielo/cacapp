// Prueba de la autorización de datos, desde el lado del navegador.
//
// La usan los dos formularios que escriben directo a la base: el portal público
// /solicitud (rol anon, solo puede INSERTAR) y el registro interno (rol
// authenticated). Los portales de fotos, planta y visita y el portal de aliados
// pasan por orbit-backend, que la graba él mismo y además guarda la IP.
//
// Se guarda la VERSIÓN de la política aceptada: sin eso, una autorización no
// prueba nada el día que el texto cambie. Migración 161.
import { db } from '@/lib/supabase'
import { VERSION } from '@/lib/privacidad'

/**
 * Deja constancia de una autorización. Lanza si no se pudo guardar: quien la
 * llama debe decidir si eso detiene el formulario (en /solicitud y en el
 * registro interno, sí — sin prueba no deberíamos quedarnos con los datos).
 */
export async function registrarAutorizacion({
  origen, medio, titular = {}, servicioId = null, clienteId = null,
  solicitudId = null, aliadoId = null, declaradaPor = null, notas = null,
}) {
  // Los topes son los mismos que la migración 162 exige en la base: recortar
  // aquí evita que un correo larguísimo tumbe el formulario con un error de
  // constraint que la familia no puede entender ni arreglar.
  const t = (v, max = 200) => {
    const s = String(v ?? '').trim()
    return s ? s.slice(0, max) : null
  }
  const { error } = await db.from('autorizaciones_datos').insert({
    origen,
    medio,
    politica_version:  VERSION,
    titular_nombre:    t([titular.nombre, titular.apellido].filter(Boolean).join(' ')),
    titular_documento: t(titular.documento, 60),
    titular_telefono:  t(titular.telefono, 60),
    titular_email:     t(titular.email),
    servicio_id:       servicioId,
    cliente_id:        clienteId,
    solicitud_id:      solicitudId,
    aliado_id:         aliadoId,
    declarada_por:     declaradaPor,
    notas:             t(notas, 2000),
  })
  if (error) throw new Error(error.message || 'No se pudo registrar la autorización')
}
