// Piezas pequeñas del CRM comercial: chips, indicadores y estados vacíos.
import { SEGMENTOS, TENDENCIAS, RIESGOS, PRIORIDADES, ticketEstado, etapa } from '@/lib/crmApi'

export const ACENTO = '#0F766E'        // verde azulado del CRM: lo distingue del Orbit operativo
export const ACENTO_SUAVE = '#E6F4F1'

export function Chip({ color = '#6B7280', bg, children, className = '', title }) {
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none whitespace-nowrap ${className}`}
      style={{ color, background: bg || `${color}14`, border: `1px solid ${color}33` }}>
      {children}
    </span>
  )
}

export function SegmentoChip({ segmento }) {
  const s = SEGMENTOS[segmento]
  if (!s) return null
  return <Chip color={s.color} bg={s.bg} title={s.ayuda}>{s.label}</Chip>
}

export function TendenciaChip({ tendencia, variacion }) {
  const t = TENDENCIAS[tendencia] || TENDENCIAS.SIN_DATOS
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums" style={{ color: t.color }}
          title={`Últimos 90 días frente a los 90 anteriores`}>
      {t.icono} {tendencia === 'SIN_DATOS' ? t.label : `${variacion > 0 ? '+' : ''}${variacion}%`}
    </span>
  )
}

export function RiesgoChip({ riesgo }) {
  const r = RIESGOS[riesgo]
  if (!r) return null
  return <Chip color={r.color}>{r.label}</Chip>
}

export function PrioridadChip({ prioridad }) {
  const p = PRIORIDADES[prioridad] || PRIORIDADES.MEDIA
  return <Chip color={p.color}>{p.label}</Chip>
}

export function EstadoTicketChip({ estado }) {
  const e = ticketEstado(estado)
  return <Chip color={e.color}>{e.label}</Chip>
}

export function EtapaChip({ clave }) {
  const e = etapa(clave)
  return <Chip color={e.color}>{e.label}</Chip>
}

export function ClaseChip({ clase }) {
  if (!clase) return null
  const c = { A: '#B45309', B: '#475569', C: '#94A3B8' }[clase]
  return <Chip color={c} title="Pareto por volumen del último semestre: A = las que hacen el 80 %">Clase {clase}</Chip>
}

/** Barra de probabilidad 0-100. */
export function Probabilidad({ valor, ancho = 64 }) {
  const v = Math.max(0, Math.min(100, Number(valor) || 0))
  const color = v >= 70 ? '#059669' : v >= 40 ? '#D97706' : '#DC2626'
  return (
    <span className="inline-flex items-center gap-1.5" title="Probabilidad de que mande al menos un servicio en 30 días">
      <span className="rounded-full bg-gray-100 overflow-hidden" style={{ width: ancho, height: 6 }}>
        <span className="block h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </span>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{v}%</span>
    </span>
  )
}

export function Kpi({ label, valor, sub, color = '#0F172A', icono: Icono, onClick, destacado = false }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick}
      className={`text-left bg-white rounded-2xl border p-4 flex flex-col gap-1 transition
        ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''}
        ${destacado ? 'border-red-200 bg-red-50/40' : 'border-gray-100 shadow-sm'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
        {Icono && <Icono size={14} className="text-gray-300" />}
      </div>
      <div className="text-[26px] font-bold leading-none tabular-nums mt-1" style={{ color }}>{valor}</div>
      {sub && <div className="text-[11.5px] text-gray-500">{sub}</div>}
    </Comp>
  )
}

export function Seccion({ titulo, accion, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      {(titulo || accion) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <h3 className="text-[13px] font-bold text-gray-800">{titulo}</h3>
          {accion}
        </div>
      )}
      <div className="px-4 pb-4">{children}</div>
    </section>
  )
}

export function Vacio({ children }) {
  return <div className="text-center text-[12.5px] text-gray-400 py-6">{children}</div>
}

export function Cargando({ texto = 'Cargando…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-gray-400">
      <div className="spinner" />
      <span className="text-sm">{texto}</span>
    </div>
  )
}

export function ErrorCaja({ error, onReintentar }) {
  if (!error) return null
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 flex items-center justify-between gap-3">
      <span>{error}</span>
      {onReintentar && <button onClick={onReintentar} className="font-semibold underline">Reintentar</button>}
    </div>
  )
}

export function Campo({ label, children, ayuda, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">{label}</span>
      {children}
      {ayuda && <span className="block text-[11px] text-gray-400 mt-1">{ayuda}</span>}
    </label>
  )
}

/** Encabezado de cada pantalla del CRM. */
export function Cabecera({ titulo, sub, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold text-gray-900 leading-tight">{titulo}</h1>
        {sub && <p className="text-[12.5px] text-gray-500 mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Pestanas({ valor, onCambio, opciones }) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl w-fit max-w-full overflow-x-auto">
      {opciones.map(o => (
        <button key={o.valor} onClick={() => onCambio(o.valor)}
          className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition
            ${valor === o.valor ? 'bg-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          style={valor === o.valor ? { color: ACENTO } : undefined}>
          {o.label}{o.n != null && <span className="ml-1.5 text-[11px] text-gray-400 tabular-nums">{o.n}</span>}
        </button>
      ))}
    </div>
  )
}
