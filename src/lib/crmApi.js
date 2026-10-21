// CRM comercial de veterinarias (migración 180). Todo pasa por el backend:
// el navegador no escribe en las tablas `crm_*`.
import { orbitApi, orbitApiBlob } from '@/lib/orbitApi'

const q = obj => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj || {})) if (v !== null && v !== undefined && v !== '') p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const crm = {
  resumen:      () => orbitApi('/crm/resumen'),
  cartera:      () => orbitApi('/crm/cartera'),
  alertas:      () => orbitApi('/crm/alertas'),
  equipo:       () => orbitApi('/crm/equipo'),
  config:       () => orbitApi('/crm/config'),
  guardarConfig: datos => orbitApi('/crm/config', { method: 'PUT', body: datos }),
  servicios:    filtros => orbitApi(`/crm/servicios${q(filtros)}`),

  ficha:        id => orbitApi(`/crm/aliados/${id}`),
  guardarFicha: (id, datos) => orbitApi(`/crm/aliados/${id}`, { method: 'PUT', body: datos }),
  plantillaAliado: (id, cuerpo) => orbitApi(`/crm/aliados/${id}/plantilla`, { method: 'POST', body: cuerpo }),
  materialAliado:  (id, cuerpo) => orbitApi(`/crm/aliados/${id}/material`, { method: 'POST', body: cuerpo }),

  prospectos:   filtros => orbitApi(`/crm/prospectos${q(filtros)}`),
  prospecto:    id => orbitApi(`/crm/prospectos/${id}`),
  crearProspecto: datos => orbitApi('/crm/prospectos', { method: 'POST', body: datos }),
  guardarProspecto: (id, datos) => orbitApi(`/crm/prospectos/${id}`, { method: 'PUT', body: datos }),
  moverProspecto: (id, datos) => orbitApi(`/crm/prospectos/${id}/mover`, { method: 'POST', body: datos }),
  convertirProspecto: (id, datos = {}) => orbitApi(`/crm/prospectos/${id}/convertir`, { method: 'POST', body: datos }),
  importar:     datos => orbitApi('/crm/prospectos/importar', { method: 'POST', body: datos }),
  plantillaProspecto: (id, cuerpo) => orbitApi(`/crm/prospectos/${id}/plantilla`, { method: 'POST', body: cuerpo }),
  materialProspecto:  (id, cuerpo) => orbitApi(`/crm/prospectos/${id}/material`, { method: 'POST', body: cuerpo }),

  registrarGestion: datos => orbitApi('/crm/actividades', { method: 'POST', body: datos }),

  seguimientos: (rango = 'pendientes', mios = false, extras = {}) => orbitApi(`/crm/seguimientos${q({ rango, mios: mios ? 1 : null, ...extras })}`),
  crearSeguimiento: datos => orbitApi('/crm/seguimientos', { method: 'POST', body: datos }),
  cambiarSeguimiento: (id, datos) => orbitApi(`/crm/seguimientos/${id}`, { method: 'PUT', body: datos }),

  tickets:      filtros => orbitApi(`/crm/tickets${q(filtros)}`),
  ticket:       id => orbitApi(`/crm/tickets/${id}`),
  crearTicket:  datos => orbitApi('/crm/tickets', { method: 'POST', body: datos }),
  cambiarTicket: (id, datos) => orbitApi(`/crm/tickets/${id}`, { method: 'PUT', body: datos }),

  subirFoto:    datos => orbitApi('/crm/fotos', { method: 'POST', body: datos }),
  foto:         (id, mini = false) => orbitApiBlob(`/crm/fotos/${id}${mini ? '?mini=1' : ''}`),
  borrarFoto:   id => orbitApi(`/crm/fotos/${id}`, { method: 'DELETE' }),
  portadaFoto:  id => orbitApi(`/crm/fotos/${id}/portada`, { method: 'POST' }),

  reglasHitos:  () => orbitApi('/crm/hitos/reglas'),
  guardarRegla: (id, datos) => id
    ? orbitApi(`/crm/hitos/reglas/${id}`, { method: 'PUT', body: datos })
    : orbitApi('/crm/hitos/reglas', { method: 'POST', body: datos }),
  borrarRegla:  id => orbitApi(`/crm/hitos/reglas/${id}`, { method: 'DELETE' }),
  enviosHitos:  estado => orbitApi(`/crm/hitos/envios${q({ estado })}`),
  evaluarHitos: () => orbitApi('/crm/hitos/evaluar', { method: 'POST' }),
  enviarHito:   id => orbitApi(`/crm/hitos/envios/${id}/enviar`, { method: 'POST' }),
  descartarHito: id => orbitApi(`/crm/hitos/envios/${id}/descartar`, { method: 'POST' }),

  copiloto:     datos => orbitApi('/crm/copiloto', { method: 'POST', body: datos }),
  agentes:      () => orbitApi('/crm/agentes'),

  campanas:         () => orbitApi('/crm/campanas'),
  campana:          id => orbitApi(`/crm/campanas/${id}`),
  crearCampana:     datos => orbitApi('/crm/campanas', { method: 'POST', body: datos }),
  guardarCampana:   (id, datos) => orbitApi(`/crm/campanas/${id}`, { method: 'PUT', body: datos }),
  borrarCampana:    id => orbitApi(`/crm/campanas/${id}`, { method: 'DELETE' }),
  enviarCampana:    id => orbitApi(`/crm/campanas/${id}/enviar`, { method: 'POST' }),
  previaCampana:    id => orbitApi(`/crm/campanas/${id}/previa`, { method: 'POST' }),
  crearContacto:    (aliadoId, datos) => orbitApi(`/crm/aliados/${aliadoId}/contactos`, { method: 'POST', body: datos }),
  editarContacto:   (aliadoId, cid, datos) => orbitApi(`/crm/aliados/${aliadoId}/contactos/${cid}`, { method: 'PUT', body: datos }),
  borrarContacto:   (aliadoId, cid) => orbitApi(`/crm/aliados/${aliadoId}/contactos/${cid}`, { method: 'DELETE' }),
  bloqueoAliado:    (id, datos) => orbitApi(`/crm/aliados/${id}/bloqueo`, { method: 'POST', body: datos }),
  bloqueoProspecto: (id, datos) => orbitApi(`/crm/prospectos/${id}/bloqueo`, { method: 'POST', body: datos }),
}

// ─── Catálogos y etiquetas ──────────────────────────────────────────────────
export const SEGMENTOS = {
  ACTIVA:        { label: 'Activa',        color: '#059669', bg: '#ECFDF5', orden: 1, ayuda: 'Manda servicios con normalidad' },
  NUEVA:         { label: 'Nueva',         color: '#2563EB', bg: '#EFF6FF', orden: 0, ayuda: 'Su primer servicio fue hace menos de 30 días' },
  ENFRIANDOSE:   { label: 'Enfriándose',   color: '#D97706', bg: '#FFFBEB', orden: 2, ayuda: 'Lleva un tiempo sin mandar' },
  EN_RIESGO:     { label: 'En riesgo',     color: '#DC2626', bg: '#FEF2F2', orden: 3, ayuda: 'Se está perdiendo' },
  DORMIDA:       { label: 'Dormida',       color: '#6B7280', bg: '#F3F4F6', orden: 4, ayuda: 'No manda hace mucho: reactivar' },
  SIN_SERVICIOS: { label: 'Sin servicios', color: '#7C3AED', bg: '#F5F3FF', orden: 5, ayuda: 'Registrada pero nunca ha mandado' },
  POR_VALIDAR:   { label: 'Por validar',   color: '#0891B2', bg: '#ECFEFF', orden: 6, ayuda: 'Se preregistró en el portal' },
}
export const ORDEN_SEGMENTOS = ['NUEVA', 'ACTIVA', 'ENFRIANDOSE', 'EN_RIESGO', 'DORMIDA', 'SIN_SERVICIOS', 'POR_VALIDAR']

export const TENDENCIAS = {
  CRECE:     { label: 'Creciendo', color: '#059669', icono: '▲' },
  ESTABLE:   { label: 'Estable',   color: '#6B7280', icono: '■' },
  CAE:       { label: 'Cayendo',   color: '#DC2626', icono: '▼' },
  SIN_DATOS: { label: 'Sin datos', color: '#9CA3AF', icono: '·' },
}

export const RIESGOS = {
  ALTO:  { label: 'Riesgo alto',  color: '#DC2626' },
  MEDIO: { label: 'Riesgo medio', color: '#D97706' },
  BAJO:  { label: 'Riesgo bajo',  color: '#059669' },
}

export const ETAPAS = [
  { clave: 'NUEVO',      label: 'Nuevo',       color: '#64748B' },
  { clave: 'CONTACTADO', label: 'Contactado',  color: '#2563EB' },
  { clave: 'INTERESADO', label: 'Interesado',  color: '#7C3AED' },
  { clave: 'REUNION',    label: 'Reunión / visita', color: '#0891B2' },
  { clave: 'PROPUESTA',  label: 'Propuesta',   color: '#D97706' },
  { clave: 'GANADO',     label: 'Ganado',      color: '#059669' },
  { clave: 'PERDIDO',    label: 'Perdido',     color: '#DC2626' },
]
export const etapa = k => ETAPAS.find(e => e.clave === k) || ETAPAS[0]

export const FUENTES = {
  MANUAL: 'Manual', IMPORTACION: 'Base importada', REDES: 'Redes sociales', WEB: 'Página web',
  PORTAL: 'Preregistro portal', REFERIDO: 'Referido', AGENTE: 'Agente de ventas',
  WHATSAPP: 'WhatsApp', VISITA: 'Visita en calle', OTRO: 'Otro',
}

export const TIPOS_GESTION = {
  LLAMADA:  { label: 'Llamada',  emoji: '📞' },
  WHATSAPP: { label: 'WhatsApp', emoji: '💬' },
  VISITA:   { label: 'Visita',   emoji: '🚶' },
  REUNION:  { label: 'Reunión',  emoji: '🤝' },
  EMAIL:    { label: 'Correo',   emoji: '✉️' },
  NOTA:     { label: 'Nota',     emoji: '📝' },
  PLANTILLA:{ label: 'Plantilla', emoji: '📨' },
  MATERIAL: { label: 'Material', emoji: '📎' },
  SISTEMA:  { label: 'Sistema',  emoji: '⚙️' },
}

export const RESULTADOS = {
  CONTESTO: 'Contestó', NO_CONTESTO: 'No contestó', OCUPADO: 'Ocupado / llamar luego',
  NUMERO_ERRADO: 'Número errado', BUZON: 'Buzón', INTERESADO: 'Interesado',
  NO_INTERESADO: 'No interesado', VOLVER_A_LLAMAR: 'Volver a llamar', COMPROMISO: 'Quedó un compromiso',
  QUEJA: 'Expresó una queja', INFORMATIVO: 'Informativo',
}

export const TICKET_ESTADOS = [
  { clave: 'ABIERTO',       label: 'Abierto',          color: '#DC2626' },
  { clave: 'EN_PROCESO',    label: 'En proceso',       color: '#D97706' },
  { clave: 'ESPERANDO_VET', label: 'Esperando a la vet', color: '#7C3AED' },
  { clave: 'RESUELTO',      label: 'Resuelto',         color: '#059669' },
  { clave: 'CERRADO',       label: 'Cerrado',          color: '#6B7280' },
]
export const ticketEstado = k => TICKET_ESTADOS.find(e => e.clave === k) || TICKET_ESTADOS[0]

export const TICKET_CATEGORIAS = {
  COMISION: 'Comisión', PAGO: 'Pagos', FACTURACION: 'Facturación', RECOGIDA: 'Recogida',
  ENTREGA: 'Entrega', CERTIFICADO: 'Certificado', RECORDATORIOS: 'Recordatorios',
  ATENCION: 'Atención', PRECIOS: 'Precios', PLATAFORMA: 'Plataforma / portal', OTRO: 'Otro',
}
export const TICKET_TIPOS = {
  PETICION: 'Petición', QUEJA: 'Queja', RECLAMO: 'Reclamo', SUGERENCIA: 'Sugerencia', FELICITACION: 'Felicitación',
}
export const PRIORIDADES = {
  URGENTE: { label: 'Urgente', color: '#DC2626' },
  ALTA:    { label: 'Alta',    color: '#EA580C' },
  MEDIA:   { label: 'Media',   color: '#D97706' },
  BAJA:    { label: 'Baja',    color: '#6B7280' },
}

export const TIPOS_HITO = {
  PRIMER_SERVICIO: { label: 'Primer servicio', ayuda: 'La vet manda su primer servicio (bienvenida).', umbral: null },
  SERVICIOS_TOTAL: { label: 'N servicios acumulados', ayuda: 'Al llegar a N servicios en total (10, 50, 100…).', umbral: 'Servicios' },
  SERVICIOS_MES:   { label: 'N servicios en el mes', ayuda: 'Al llegar a N servicios dentro del mismo mes.', umbral: 'Servicios en el mes' },
  REACTIVACION:    { label: 'Reactivación', ayuda: 'Vuelve a mandar después de N días sin hacerlo.', umbral: 'Días sin mandar' },
}

export const SERVICIOS_CLINICA = [
  'Urgencias', 'Hospitalización', 'Cirugía', 'Consulta', 'Vacunación', 'Peluquería', 'Guardería',
  'Laboratorio', 'Imagenología', 'Especialistas', 'Felinos', 'Exóticos', 'Domicilios', 'Tienda',
]

// ─── Formatos ───────────────────────────────────────────────────────────────
export const pesos = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO')

export function haceDias(n) {
  if (n === null || n === undefined) return '—'
  const d = Number(n)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`
  if (d < 60) return 'hace 1 mes'
  return `hace ${Math.floor(d / 30)} meses`
}

export function fechaCorta(ts) {
  if (!ts) return '—'
  const d = new Date(String(ts).length === 10 ? ts + 'T12:00:00' : ts)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function fechaHora(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** "Hace 3 h", "en 20 min", para seguimientos. */
export function relativo(ts) {
  if (!ts) return ''
  const min = Math.round((new Date(ts).getTime() - Date.now()) / 60000)
  const abs = Math.abs(min)
  const t = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`
  return min >= 0 ? `en ${t}` : `hace ${t}`
}

/** `datetime-local` ↔ ISO, en la hora del dispositivo. */
export function aInputFechaHora(d) {
  const x = new Date(d)
  const p = n => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`
}
export const desdeInputFechaHora = v => (v ? new Date(v).toISOString() : null)

/** Atajos de reprogramación: mañana a las 9, en 3 días, la próxima semana. */
export function atajoFecha(clave) {
  const d = new Date()
  const a9 = x => { x.setHours(9, 0, 0, 0); return x }
  if (clave === '1h') { d.setHours(d.getHours() + 1, 0, 0, 0); return d }
  if (clave === 'tarde') { d.setHours(15, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d }
  if (clave === 'manana') { d.setDate(d.getDate() + 1); return a9(d) }
  if (clave === '3d') { d.setDate(d.getDate() + 3); return a9(d) }
  if (clave === 'semana') { d.setDate(d.getDate() + 7); return a9(d) }
  if (clave === 'mes') { d.setMonth(d.getMonth() + 1); return a9(d) }
  return d
}

/** Teléfono para marcar desde el celular o el softphone (tel:). */
export function telHref(numero) {
  const d = String(numero || '').replace(/\D/g, '')
  if (!d) return null
  return d.length === 10 ? `tel:+57${d}` : `tel:+${d}`
}

export function waHref(numero, texto = '') {
  let d = String(numero || '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) d = '57' + d
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}
