// Cliente frontend de Reportes Grupales (modelo formal Fase 5).
// LECTURA: directo a Supabase (PostgREST). ESCRITURA CRÍTICA: solo vía orbit-backend
// (generar/enviar/reenviar son transaccionales e idempotentes allá).
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import {
  generarHTMLCremacionGrupal, generarHTMLCompostajeGrupal, generarYSubirPDF,
} from '@/lib/certificados'

// ─── Estados (espejo del backend) ────────────────────────────────────────────
export const ESTADO_ITEM = {
  PENDIENTE: { label: 'Pendiente',  color: '#6B7280', bg: '#F3F4F6' },
  VALIDADO:  { label: 'Validado',   color: '#1D4ED8', bg: '#DBEAFE' },
  ENVIADO:   { label: 'Enviado',    color: '#065F46', bg: '#D1FAE5' },
  REENVIADO: { label: 'Reenviado',  color: '#7C3AED', bg: '#EDE9FE' },
  VENCIDO:   { label: 'Vencido',    color: '#B91C1C', bg: '#FEE2E2' },
  ERROR:     { label: 'Error',      color: '#B91C1C', bg: '#FEE2E2' },
  EXCLUIDO:  { label: 'Excluido',   color: '#92400E', bg: '#FEF3C7' },
}

export const ESTADO_REPORTE = {
  PENDIENTE:       { label: 'Pendiente',       color: '#6B7280', bg: '#F3F4F6' },
  GENERADO:        { label: 'Generado',        color: '#1D4ED8', bg: '#DBEAFE' },
  ENVIANDO:        { label: 'Enviando…',       color: '#B45309', bg: '#FEF3C7' },
  ENVIADO_PARCIAL: { label: 'Envío parcial',   color: '#B45309', bg: '#FEF3C7' },
  ENVIADO:         { label: 'Enviado',         color: '#065F46', bg: '#D1FAE5' },
  VENCIDO:         { label: 'Vencido',         color: '#B91C1C', bg: '#FEE2E2' },
  ERROR:           { label: 'Error',           color: '#B91C1C', bg: '#FEE2E2' },
}

// ─── Lectura: reportes + ítems + lote ────────────────────────────────────────
export async function obtenerReportes() {
  const { data, error } = await db
    .from('reportes_grupales')
    .select(`*,
      lotes_grupales ( numero_lote, fecha_completado, fecha_envio, entidad_externa, duracion_proceso, coordinador_id ),
      reportes_grupales_items ( * )`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── Sincronizar (re-clasifica, valida, recalcula vencimientos) ──────────────
export function sincronizar() {
  return orbitApi('/grupales/sincronizar', { method: 'POST' })
}

// Escritura crítica: agregar un servicio al flujo reportable desde Control.
export function agregarServicioALote(servicioId) {
  return orbitApi('/grupales/agregar-a-lote', {
    method: 'POST',
    body: { servicio_id: servicioId },
  })
}

// Escritura crítica: sacar manualmente un servicio de su lote/reporte grupal.
export function sacarServicioDeLote(servicioId, motivo = 'Retirado manualmente del lote') {
  return orbitApi('/grupales/desvincular', {
    method: 'POST',
    body: { servicio_id: servicioId, motivo, manual: true },
  })
}

// Mapea los ítems del reporte al shape que esperan los generadores de HTML
function itemsAServicios(items) {
  return (items || [])
    .filter(i => i.estado !== 'EXCLUIDO')
    .map(i => ({
      mascota:  i.mascota_nombre || '-',
      cliente:  i.propietario_nombre || '-',
      peso_kg:  i.peso_kg,
      // Fecha de proceso = ingreso + 3 días hábiles (calculada en el backend con
      // festivos y guardada como fecha_vencimiento del ítem). El generador usa la
      // más reciente del lote como fecha de la cremación/compostaje colectivo.
      fecha_proceso: i.fecha_vencimiento || null,
    }))
}

// ─── Generar reporte (PDF + marcar GENERADO en backend) ──────────────────────
export async function generarReporte(reporte, coordinador) {
  // Los nombres (mascota/propietario) de reportes_grupales_items son un SNAPSHOT;
  // solo se refrescan al sincronizar. Sin esto, un cambio de nombre no se reflejaba
  // en el PDF aun dándole "regenerar" (se construía del snapshot viejo). Por eso
  // re-sincronizamos y re-leemos el reporte fresco antes de armar el PDF.
  await sincronizar()
  const frescos = await obtenerReportes()
  const actual  = frescos.find(r => String(r.id) === String(reporte.id)) || reporte

  const lote = {
    numero_lote:      actual.lotes_grupales?.numero_lote,
    tipo_proceso:     actual.tipo_proceso,
    fecha_completado: actual.lotes_grupales?.fecha_completado,
    fecha_envio:      actual.lotes_grupales?.fecha_envio,
    entidad_externa:  actual.lotes_grupales?.entidad_externa,
    duracion_proceso: actual.lotes_grupales?.duracion_proceso,
  }
  const servicios = itemsAServicios(actual.reportes_grupales_items)
  const html = actual.tipo_proceso === 'CREMACION_GRUPAL'
    ? generarHTMLCremacionGrupal({ lote, servicios, coordinador })
    : generarHTMLCompostajeGrupal({ lote, servicios, coordinador })

  // Sube el PDF y obtiene la URL que enviará el backend a Zolutium
  const pdfUrl = await generarYSubirPDF(html, lote.numero_lote || 'reporte')

  await orbitApi(`/grupales/reportes/${reporte.id}/generar`, {
    method: 'POST', body: { storage_path: pdfUrl },
  })
  return { pdfUrl, html }
}

// ─── Enviar / reenviar (transaccional en backend; persiste evidencia) ────────
export function enviarReporte(reporteId, { pdfUrl, items, fromNumber, reenvio = false, motivo, mensajes } = {}) {
  return orbitApi(`/grupales/reportes/${reporteId}/enviar`, {
    method: 'POST',
    body: { pdf_url: pdfUrl, items, fromNumber, reenvio, motivo, mensajes },
  })
}

// ─── Asistente IA (sugiere; el humano confirma) ──────────────────────────────
export function resumenIA() {
  return orbitApi('/grupales/ia/resumen', { method: 'POST' })
}

export function redactarIA(itemId) {
  return orbitApi('/grupales/ia/redactar', { method: 'POST', body: { item_id: itemId } })
}

// Alerta de vencimientos para la tabla de Control (IA + buckets)
export function alertaControlIA() {
  return orbitApi('/grupales/ia/control', { method: 'POST' })
}
