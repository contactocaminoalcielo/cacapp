/**
 * Agrupa las ráfagas de eventos realtime en una sola recarga.
 *
 * Una sola acción del usuario (cambiar de plan, cerrar un servicio) escribe en
 * varias tablas y dispara varios `postgres_changes` seguidos. Sin agrupar, cada
 * evento lanza su propia consulta completa: el tablero se recarga 3–4 veces por
 * cada cambio que hace cualquier usuario conectado.
 *
 * Devuelve la función a enganchar en el `.on(...)`; hay que llamar a
 * `refrescar.cancelar()` en el cleanup del efecto para no dejar un timer vivo
 * que recargue una página ya desmontada.
 */
export function agruparRefresco(fn, ms = 400) {
  let timer = null
  const refrescar = () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
  refrescar.cancelar = () => clearTimeout(timer)
  return refrescar
}
