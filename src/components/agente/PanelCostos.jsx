// Control de costos del agente (migración 108).
//
// 🩸 POR QUÉ EXISTE: el 21-ago-2026 se agotó el saldo de la API de Claude y nos
// enteramos porque una clínica escribió y el agente no contestó. El Console de
// Anthropic dice el total del mes, pero no si se fue en el chat, en una llamada
// de voz o en una campaña — y esa es justo la pregunta que hay que responder
// para decidir algo.
//
// Todo lo que se pinta aquí viene YA SUMADO del backend. Nada se agrega en
// React: sumar en el navegador se rompe solo en cuanto haya volumen, y encima
// en silencio (ya nos pasó en Reportes con el tope de filas).
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Wallet, RefreshCw, Loader2, AlertTriangle, Info, ChevronDown, Check, Mic,
  MessageSquare, Megaphone, FlaskConical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  cargarCostos, cargarPrecios, guardarPrecio, sincronizarCostosMeta,
} from '@/lib/agenteApi'

// ── Colores de las series ──
// Los tres primeros de la paleta categórica, en orden fijo. Van por PROVEEDOR y
// no por posición: si un día uno de los tres no gasta nada, los otros dos no
// pueden cambiar de color — el ojo lee el color como identidad, y repintarlos
// haría que dos gráficos del mismo panel se contradigan.
const COLOR = {
  ANTHROPIC:  '#2a78d6',
  ELEVENLABS: '#eb6834',
  META:       '#1baf7a',
}
const NOMBRE = {
  ANTHROPIC:  'Claude (el cerebro)',
  ELEVENLABS: 'ElevenLabs (la voz)',
  META:       'WhatsApp de Meta',
}
const ICONO_CANAL = {
  CHAT: MessageSquare, VOZ: Mic, CAMPANA: Megaphone, PRUEBA: FlaskConical, SISTEMA: Info,
}
const NOMBRE_CANAL = {
  CHAT: 'Chat de WhatsApp', VOZ: 'Llamadas de voz', CAMPANA: 'Campañas',
  PRUEBA: 'Pruebas desde esta pantalla', SISTEMA: 'Sistema',
}

const PERIODOS = [
  { clave: 'hoy',  label: 'Hoy' },
  { clave: 'mes',  label: 'Este mes' },
  { clave: 'd7',   label: '7 días' },
  { clave: 'd30',  label: '30 días' },
]

function rango(clave) {
  const hasta = new Date(Date.now() + 86400_000)
  if (clave === 'hoy') {
    // El día que vive quien mira, no el de UTC: a las 7 de la tarde en Bogotá
    // ya es el día siguiente en Londres, y "hoy" empezaría a las 7 p.m.
    const h = new Date()
    return {
      desde: new Date(h.getFullYear(), h.getMonth(), h.getDate()),
      hasta,
      granularidad: 'HORA',
    }
  }
  if (clave === 'd7')  return { desde: new Date(Date.now() - 7  * 86400_000), hasta }
  if (clave === 'd30') return { desde: new Date(Date.now() - 30 * 86400_000), hasta }
  const h = new Date()
  return { desde: new Date(h.getFullYear(), h.getMonth(), 1), hasta }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * La etiqueta del eje, a partir del texto que manda el backend.
 *
 * Llega ya formado (`2026-08-21` o `2026-08-21 14`) y se parte a mano en vez de
 * pasarlo por `new Date`: convertirlo a fecha lo reinterpretaría en la zona del
 * navegador y desplazaría el gráfico cinco horas.
 */
function etiquetaEje(texto, granularidad) {
  const t = String(texto || '')
  if (granularidad === 'HORA') return `${t.slice(11, 13)}:00`
  const [, m, d] = t.split('-')
  return `${d} ${MESES[parseInt(m, 10) - 1] || ''}`
}

/** Dólares con los decimales que hagan falta: 0,003 USD no puede salir "0,00". */
function usd(n) {
  const v = Number(n) || 0
  if (v === 0) return 'US$0'
  if (v < 0.01) return `US$${v.toFixed(4)}`
  return `US$${v.toFixed(2)}`
}

function cop(n, trm) {
  return `${Math.round((Number(n) || 0) * (trm || 4000)).toLocaleString('es-CO')} COP`
}

const miles = (n) => (Number(n) || 0).toLocaleString('es-CO')

export default function PanelCostos({ agenteId }) {
  const [periodo, setPeriodo]   = useState('mes')
  const [datos, setDatos]       = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState(null)
  const [sincro, setSincro]     = useState(false)
  const [verPrecios, setVerPrecios] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const { desde, hasta, granularidad } = rango(periodo)
      const r = await cargarCostos({
        desde: desde.toISOString(), hasta: hasta.toISOString(), granularidad,
      })
      if (!r?.ok) throw new Error(r?.error || 'No se pudo cargar el consumo')
      setDatos(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [periodo])

  useEffect(() => { cargar() }, [cargar])

  const sincronizarMeta = async () => {
    setSincro(true)
    try { await sincronizarCostosMeta(30); await cargar() }
    catch (e) { setError(e.message) }
    finally { setSincro(false) }
  }

  // Recharts necesita una fila por día con una columna por serie. El backend ya
  // devuelve exactamente eso; aquí solo se le pone el día en formato corto.
  const serie = useMemo(() => (datos?.porDia || []).map(d => ({
    dia: etiquetaEje(d.dia, datos?.granularidad),
    ANTHROPIC: d.anthropic, ELEVENLABS: d.elevenlabs, META: d.meta, total: d.usd,
  })), [datos])

  const trm = datos?.trm || 4000
  const total = datos?.total?.usd || 0
  const eleven = datos?.elevenlabs || {}
  const hoy = datos?.hoy || {}

  return (
    <div className="space-y-5">
      {/* ── Periodo y total ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {periodo === 'hoy' ? 'Gasto de hoy' : 'Gasto del periodo'}
            </p>
            <p className="text-3xl font-semibold text-neutral-900 tabular-nums">{usd(total)}</p>
            <p className="text-sm text-neutral-500 tabular-nums">≈ {cop(total, trm)}</p>
          </div>

          {/* Hoy va SIEMPRE, mires el periodo que mires: "¿cómo vamos hoy?" no
              debería costar un clic ni hacerte perder de vista el mes. */}
          {periodo !== 'hoy' && (
            <div className="pl-8 border-l border-neutral-200">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Hoy</p>
              <p className="text-xl font-semibold text-neutral-900 tabular-nums">{usd(hoy.usd)}</p>
              <p className="text-[12px] text-neutral-500 tabular-nums">
                {hoy.eventos ? `${miles(hoy.eventos)} consumos · ${cop(hoy.usd, trm)}` : 'sin consumo todavía'}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-neutral-200 p-0.5">
            {PERIODOS.map(p => (
              <button
                key={p.clave} type="button" onClick={() => setPeriodo(p.clave)}
                className={`px-3 py-1.5 text-sm rounded-md transition cursor-pointer ${
                  periodo === p.clave
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >{p.label}</button>
            ))}
          </div>
          <button
            onClick={cargar} title="Actualizar"
            className="p-2 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {/* ── Por proveedor ──
          Las cifras van escritas, no solo en el color del gráfico: el verde de
          Meta queda por debajo del 3:1 sobre blanco y el color por sí solo no
          puede ser la única forma de leer el dato. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {['ANTHROPIC', 'ELEVENLABS', 'META'].map(k => {
          const p = (datos?.porProveedor || []).find(x => x.proveedor === k)
          return (
            <div key={k} className="rounded-xl border border-neutral-200 p-3.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLOR[k] }} />
                <span className="text-[13px] font-medium text-neutral-700">{NOMBRE[k]}</span>
              </div>
              <p className="text-xl font-semibold text-neutral-900 mt-1.5 tabular-nums">
                {usd(p?.usd)}
              </p>
              <p className="text-[11px] text-neutral-500 tabular-nums">
                {k === 'ANTHROPIC'  && `${miles(p?.tokens)} tokens · ${miles(p?.eventos)} respuestas`}
                {k === 'ELEVENLABS' && `${miles(p?.caracteres)} caracteres dichos`}
                {k === 'META'       && `${miles(p?.unidades)} mensajes facturados`}
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Día a día ── */}
      <div className="rounded-xl border border-neutral-200 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h4 className="text-sm font-semibold text-neutral-900">
            {periodo === 'hoy' ? 'Hora a hora' : 'Día a día'}
          </h4>
          <div className="flex items-center gap-3">
            {['ANTHROPIC', 'ELEVENLABS', 'META'].map(k => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-neutral-600">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLOR[k] }} />
                {k === 'ANTHROPIC' ? 'Claude' : k === 'ELEVENLABS' ? 'Voz' : 'WhatsApp'}
              </span>
            ))}
          </div>
        </div>

        {!serie.length ? (
          <p className="text-sm text-neutral-500 py-8 text-center">
            {periodo === 'hoy'
              ? 'Hoy todavía no se ha gastado nada.'
              : 'Sin consumo registrado en este periodo.'}
          </p>
        ) : (
          <div className="h-56 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                {/* Rejilla discreta y solo horizontal: la vertical no aporta
                    nada en barras y compite con los datos. */}
                <CartesianGrid vertical={false} stroke="#f0f0ef" />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#8a8a85' }}
                  axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#8a8a85' }} axisLine={false} tickLine={false}
                  width={52} tickFormatter={v => (v < 0.01 && v > 0 ? v.toFixed(3) : `$${v.toFixed(2)}`)} />
                <Tooltip cursor={{ fill: '#f6f6f5' }} content={<Globo trm={trm} />} />
                {/* El borde blanco de 2px es el separador entre tramos: sobre
                    fondo blanco se lee como un hueco, no como un contorno. */}
                <Bar dataKey="ANTHROPIC"  stackId="a" fill={COLOR.ANTHROPIC}  stroke="#fff" strokeWidth={2} />
                <Bar dataKey="ELEVENLABS" stackId="a" fill={COLOR.ELEVENLABS} stroke="#fff" strokeWidth={2} />
                <Bar dataKey="META"       stackId="a" fill={COLOR.META}       stroke="#fff" strokeWidth={2}
                  radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── En qué se va ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4">
          <h4 className="text-sm font-semibold text-neutral-900 mb-3">En qué se va</h4>
          {!(datos?.porCanal || []).length ? (
            <p className="text-sm text-neutral-500 py-4">Nada todavía.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(
                (datos.porCanal || []).reduce((a, c) => {
                  a[c.canal] = (a[c.canal] || 0) + c.usd
                  return a
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([canal, v]) => {
                const Icono = ICONO_CANAL[canal] || Info
                const pct = total > 0 ? (v / total) * 100 : 0
                return (
                  <li key={canal} className="flex items-center gap-3">
                    <Icono className="w-4 h-4 text-neutral-400 shrink-0" />
                    <span className="text-sm text-neutral-700 flex-1 min-w-0 truncate">
                      {NOMBRE_CANAL[canal] || canal}
                    </span>
                    <span className="h-1.5 w-24 rounded-full bg-neutral-100 overflow-hidden shrink-0">
                      <span className="block h-full rounded-full bg-neutral-800"
                        style={{ width: `${Math.max(pct, 1)}%` }} />
                    </span>
                    <span className="text-sm text-neutral-900 tabular-nums w-20 text-right shrink-0">
                      {usd(v)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 p-4">
          <h4 className="text-sm font-semibold text-neutral-900 mb-3">Lo que más costó</h4>
          {!(datos?.caras || []).length ? (
            <p className="text-sm text-neutral-500 py-4">Nada todavía.</p>
          ) : (
            <ul className="space-y-1.5">
              {datos.caras.map((c, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-neutral-700 flex-1 min-w-0 truncate font-mono text-[12px]">
                    {c.referencia}
                  </span>
                  <span className="text-[11px] text-neutral-400 shrink-0">
                    {NOMBRE_CANAL[c.canal] || c.canal}
                  </span>
                  <span className="text-neutral-900 tabular-nums w-20 text-right shrink-0">
                    {usd(c.usd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Saldos ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 🩸 Anthropic NO expone el saldo con una llave normal (haría falta una
            de administración). Decirlo es mejor que estimarlo: un saldo
            inventado aquí es exactamente lo que dejó la línea muda el 21-ago. */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-2.5">
            <Wallet className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-[13px] text-amber-900">
              <p className="font-semibold">El saldo de Claude no se puede leer desde aquí</p>
              <p className="mt-1 text-amber-800">
                Su API no lo expone con la llave que usa el agente. Esta pantalla dice lo que
                se ha <b>gastado</b>; cuánto <b>queda</b> solo está en{' '}
                <a href="https://console.anthropic.com/settings/billing" target="_blank"
                  rel="noreferrer" className="underline font-medium">console.anthropic.com</a>.
                Activa ahí la recarga automática: es lo que evita que la línea se caiga sin aviso.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-neutral-900">Cuota de ElevenLabs</h4>
            {eleven.plan && (
              <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 text-[10px] font-semibold uppercase">
                plan {eleven.plan}
              </span>
            )}
          </div>
          {eleven.error ? (
            <p className="text-sm text-neutral-500 mt-2">No se pudo consultar: {eleven.error}</p>
          ) : (
            <>
              <p className="text-sm text-neutral-700 mt-2 tabular-nums">
                {miles(eleven.usados)} de {miles(eleven.limite)} caracteres
              </p>
              <span className="mt-2 block h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                <span className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, ((eleven.usados || 0) / (eleven.limite || 1)) * 100)}%`,
                    background: COLOR.ELEVENLABS,
                  }} />
              </span>
              {eleven.reinicia && (
                <p className="text-[11px] text-neutral-400 mt-1.5">
                  Se reinicia el {new Date(eleven.reinicia).toLocaleDateString('es-CO')}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Precios ── */}
      <div className="rounded-xl border border-neutral-200">
        <button
          onClick={() => setVerPrecios(v => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 cursor-pointer"
        >
          <span className="text-sm font-semibold text-neutral-900">Precios y tasa de cambio</span>
          <span className="flex items-center gap-2 text-[12px] text-neutral-500">
            1 USD = {miles(trm)} COP
            <ChevronDown className={`w-4 h-4 transition ${verPrecios ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {verPrecios && (
          <div className="border-t border-neutral-200 p-4">
            <ListaPrecios onCambio={cargar} />
            <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between gap-3">
              <p className="text-[12px] text-neutral-500">
                Lo de Meta lo trae su propia API, ya facturado y en pesos.
              </p>
              <Button variant="secondary" onClick={sincronizarMeta} disabled={sincro}>
                {sincro ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <RefreshCw className="w-4 h-4 mr-2" />}
                Traer lo de Meta
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** El globo del gráfico: los tres valores y el total del día. */
function Globo({ active, payload, label, trm }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((a, p) => a + (p.value || 0), 0)
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-[11px] text-neutral-500 mb-1">{label}</p>
      {payload.filter(p => p.value > 0).map(p => (
        <p key={p.dataKey} className="text-[12px] text-neutral-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
          {NOMBRE[p.dataKey]}
          <span className="ml-auto tabular-nums text-neutral-900">{usd(p.value)}</span>
        </p>
      ))}
      <p className="text-[12px] font-semibold text-neutral-900 mt-1 pt-1 border-t border-neutral-100 flex justify-between gap-4">
        <span>Total</span>
        <span className="tabular-nums">{usd(total)} · {cop(total, trm)}</span>
      </p>
    </div>
  )
}

const NOMBRE_CONCEPTO = {
  ENTRADA:         'Entrada',
  SALIDA:          'Salida',
  CACHE_ESCRITURA: 'Escribir en caché',
  CACHE_LECTURA:   'Leer de caché',
  CARACTER:        'Por carácter',
  MENSAJE:         'Por mensaje',
  COP_POR_USD:     'Pesos por dólar',
}

/**
 * La lista de precios, editable.
 *
 * Se edita y no se calcula porque los precios los pone el proveedor y cambian:
 * Sonnet 5 tiene tarifa de lanzamiento hasta el 31-ago, y ElevenLabs cobra por
 * plan y no por carácter suelto — ese va en cero hasta que David ponga el suyo,
 * porque un número inventado se leería como dinero de verdad.
 */
function ListaPrecios({ onCambio }) {
  const [precios, setPrecios] = useState([])
  const [guardandoId, setGuardandoId] = useState(null)
  const [listoId, setListoId] = useState(null)

  useEffect(() => {
    cargarPrecios().then(r => setPrecios(r?.precios || [])).catch(() => {})
  }, [])

  const editar = (id, usd) =>
    setPrecios(ps => ps.map(p => (p.id === id ? { ...p, usd, sucio: true } : p)))

  const guardar = async (p) => {
    setGuardandoId(p.id)
    try {
      await guardarPrecio(p.id, Number(p.usd))
      setPrecios(ps => ps.map(x => (x.id === p.id ? { ...x, sucio: false } : x)))
      setListoId(p.id)
      setTimeout(() => setListoId(null), 1500)
      onCambio?.()
    } finally {
      setGuardandoId(null)
    }
  }

  // Solo los precios vigentes hoy: la tabla guarda también los futuros (el
  // 1-sept sube Sonnet) y enseñarlos todos confunde más de lo que informa.
  const hoy = new Date().toISOString().slice(0, 10)
  const vigentes = precios.filter(p => String(p.vigente_desde).slice(0, 10) <= hoy)
  const futuros  = precios.length - vigentes.length

  return (
    <div className="space-y-1.5">
      {vigentes.map(p => (
        <div key={p.id} className="flex items-center gap-3 text-sm">
          <span className="text-neutral-500 text-[11px] w-24 shrink-0 truncate">{p.proveedor}</span>
          <span className="text-neutral-700 flex-1 min-w-0 truncate">
            {p.clave} · <span className="text-neutral-500">{NOMBRE_CONCEPTO[p.concepto] || p.concepto}</span>
          </span>
          <span className="text-[11px] text-neutral-400 shrink-0">
            {p.por === 'MILLON' ? 'US$ / millón' : 'por unidad'}
          </span>
          <input
            type="number" step="0.000001" min="0" value={p.usd}
            onChange={e => editar(p.id, e.target.value)}
            className="w-28 rounded-md border border-neutral-200 px-2 py-1 text-right tabular-nums
                       focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          />
          <button
            onClick={() => guardar(p)} disabled={!p.sucio || guardandoId === p.id}
            className={`p-1.5 rounded-md shrink-0 ${
              p.sucio ? 'text-neutral-700 hover:bg-neutral-100 cursor-pointer' : 'text-neutral-300'
            }`}
            title="Guardar"
          >
            {guardandoId === p.id ? <Loader2 className="w-4 h-4 animate-spin" />
              : listoId === p.id ? <Check className="w-4 h-4 text-green-600" />
              : <Check className="w-4 h-4" />}
          </button>
        </div>
      ))}
      {futuros > 0 && (
        <p className="text-[11px] text-neutral-400 pt-2">
          Hay {futuros} precio(s) con fecha futura ya cargados: entran solos el día que toque.
          Lo que ya se gastó se sigue valorando con el precio de su día.
        </p>
      )}
    </div>
  )
}
