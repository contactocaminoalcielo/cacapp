import { useEffect, useRef } from 'react'
import { lecturaSerial } from './lecturas'

// Función estable para cargas disparadas por botones, polling y realtime.
// Los cambios que llegan durante una carga provocan solo una vuelta adicional.
export function useLecturaSerial(fn) {
  const actual = useRef(fn)
  const montado = useRef(true)
  actual.current = fn
  const serial = useRef(null)
  if (!serial.current) serial.current = lecturaSerial((...args) => montado.current ? actual.current(...args) : undefined)
  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])
  return serial.current
}
