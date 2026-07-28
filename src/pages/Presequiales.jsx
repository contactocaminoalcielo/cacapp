import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { db } from '@/lib/supabase'
import { fmt, waLink, today, parseDate, petEmoji } from '@/lib/utils'
import {
  NIVELES, cargarConfigAfiliaciones, generarNumeroContrato, calcularCobroActivacion,
  sumarUnAnio, subirComprobanteAfiliacion, abrirArchivoStorage, generarContratoPdf, totalContrato,
  edadALaFecha, urlFirmadaContrato, mensajeContratoWa,
} from '@/lib/afiliaciones'
import { orbitApi } from '@/lib/orbitApi'
import { Plus, RefreshCw, Rocket, FileText, Paperclip, MessageCircle, Search, RotateCw, Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, X, Mail, Pencil } from 'lucide-react'

// Afiliaciones pre-exequiales: ANUAL (renovable, cláusula 5×/3× solo el primer
// año) y VITALICIO (un pago, cubierta de por vida). Reglas y formato del número
// de contrato en src/lib/afiliaciones.js.
//
// UN CONTRATO CUBRE VARIAS MASCOTAS (migración 054): la afiliación es del
// titular y las mascotas cuelgan de ella con su propio estado, porque al
// fallecer una se activa SOLO esa y las demás siguen cubiertas. La tabla
// muestra una fila por mascota; el número de contrato se repite entre hermanas.
// `contrato.valor` es el precio POR MASCOTA — el total es valor × nº mascotas.

const FILTROS = [
  { key: 'VIGENTES',  label: 'Vigentes' },
  { key: 'POR_VENCER', label: 'Por vencer' },
  { key: 'VENCIDAS',  label: 'Vencidas' },
  { key: 'ACTIVADAS', label: 'Activadas' },
  { key: 'CANCELADAS', label: 'Canceladas' },
  { key: 'TODAS',     label: 'Todas' },
]

const NIVEL_COLORS = {
  BRONCE:   { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
  PLATA:    { bg: '#F0F0F0', text: '#555555', border: '#DDDDDD' },
  ORO:      { bg: '#FFF8E1', text: '#8A6D00', border: '#C4A87A' },
  DIAMANTE: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
}

const ESTADO_BADGE = {
  VIGENTE:   'bg-green-light text-primary-dark',
  VENCIDA:   'bg-[#FFF3DC] text-[#9A5500]',
  ACTIVADA:  'bg-[#EDE9FE] text-[#5B21B6]',
  CANCELADA: 'bg-danger-light text-danger',
  RETIRADA:  'bg-surface2 text-ink3',
}

const LABEL = 'text-[11px] font-bold text-ink3 block mb-1'
const METODOS_PAGO = [
  ['EFECTIVO', 'Efectivo'], ['TRANSFERENCIA', 'Transferencia'],
  ['TARJETA', 'Tarjeta'], ['OTRO', 'Otro'],
]

// Contrato vigente = el de mayor número (el vitalicio solo tiene el 0)
const contratoVigente = a =>
  (a.afiliacion_contratos || []).reduce((max, c) => (!max || c.numero > max.numero ? c : max), null)

// Mascotas del contrato, en el orden en que se afiliaron
const mascotasDe = a =>
  [...(a.afiliacion_mascotas || [])].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))

// Estado de UNA mascota: el suyo manda cuando ya se usó o se retiró; si sigue
// cubierta, hereda el ciclo de vida del contrato (vencido, cancelado...).
const estadoMascota = (a, am) =>
  am.estado === 'VIGENTE' ? a.estado : am.estado

// Peso y edad son los datos que el contrato imprime y que el cliente pregunta.
// La importación histórica llegó sin ellos, así que se editan desde la ficha.
// La edad NO se guarda cruda: va declarada en una fecha (migración 056) y
// envejece sola, por eso siempre se muestra `edadALaFecha`, nunca `edad_anios`.
const pesoTexto = m => (parseFloat(m?.peso_kg) > 0 ? `${m.peso_kg} kg` : null)
const edadTexto = m => {
  const e = edadALaFecha(m)
  return e == null ? null : `${e} año${e === 1 ? '' : 's'}`
}
const datosMascotaTexto = m => [pesoTexto(m), edadTexto(m)].filter(Boolean).join(' · ')

const diasPara = fechaISO => {
  if (!fechaISO) return null
  return Math.round((parseDate(fechaISO) - parseDate(today())) / 86400000)
}

const COLUMNAS_IMPORTACION = [
  'cliente_nombre', 'cliente_apellido', 'cedula_nit', 'whatsapp', 'telefono', 'email', 'direccion', 'ciudad',
  'mascota_nombre', 'especie', 'raza', 'sexo', 'tamano', 'peso_kg', 'edad_anios',
  'tipo_afiliacion', 'nivel', 'fecha_inicio', 'valor', 'metodo_pago', 'fecha_pago', 'notas',
]
// `cliente_apellido` es obligatorio: clientes.apellido es NOT NULL en la DB y
// además su inicial forma parte del número de contrato (ABR1124SR10-BR1).
const COLUMNAS_REQUERIDAS = [
  'cliente_nombre', 'cliente_apellido', 'cedula_nit', 'whatsapp', 'mascota_nombre',
  'tipo_afiliacion', 'nivel', 'fecha_inicio', 'valor',
]
const TIPOS_IMPORTACION = new Set(['ANUAL', 'VITALICIO'])
const NIVELES_IMPORTACION = new Set(['BRONCE', 'PLATA', 'ORO', 'DIAMANTE'])
const METODOS_IMPORTACION = new Set(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO'])
const SEXOS_IMPORTACION = new Set(['MACHO', 'HEMBRA'])
const TAMANOS_IMPORTACION = new Set(['MINI', 'PEQUENO', 'MEDIANO', 'GRANDE', 'GIGANTE'])

function normalizarImportacion(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
}

function encabezadoImportacion(v) {
  return normalizarImportacion(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function parseNumeroImportacion(v) {
  let x = String(v ?? '').replace(/[$\s]/g, '')
  if (x.includes('.') && x.includes(',')) x = x.replace(/\./g, '').replace(',', '.')
  else if (x.includes(',')) x = x.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '')
  return Number(x)
}

function parseArchivoDelimitado(texto) {
  const limpio = String(texto || '').replace(/^\uFEFF/, '')
  const primera = limpio.split(/\r?\n/).find(Boolean) || ''
  const candidatos = [',', ';', '\t']
  const separador = candidatos
    .map(c => ({ c, n: primera.split(c).length }))
    .sort((a, b) => b.n - a.n)[0].c
  const matriz = []
  let fila = [], campo = '', comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]
    if (ch === '"') {
      if (comillas && limpio[i + 1] === '"') { campo += '"'; i++ } else comillas = !comillas
    } else if (ch === separador && !comillas) {
      fila.push(campo); campo = ''
    } else if ((ch === '\n' || ch === '\r') && !comillas) {
      if (ch === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some(v => String(v).trim())) matriz.push(fila)
      fila = []
    } else {
      campo += ch
    }
  }
  fila.push(campo)
  if (fila.some(v => String(v).trim())) matriz.push(fila)
  if (!matriz.length) return { headers: [], rows: [] }
  const headers = matriz[0].map(encabezadoImportacion)
  const rows = matriz.slice(1).map(cols =>
    Object.fromEntries(headers.map((h, i) => [h, String(cols[i] ?? '').trim()]))
  )
  return { headers, rows }
}

function validarFilasImportacion(rows, especies) {
  const especiesMap = new Map(especies.map(e => [normalizarImportacion(e.nombre), e]))
  return rows.map((r, index) => {
    const errores = []
    for (const col of COLUMNAS_REQUERIDAS) if (!r[col]) errores.push('Falta ' + col)
    const tipo = normalizarImportacion(r.tipo_afiliacion)
    const nivel = normalizarImportacion(r.nivel)
    const metodo = normalizarImportacion(r.metodo_pago || 'EFECTIVO')
    const sexo = normalizarImportacion(r.sexo || 'MACHO')
    const tamano = normalizarImportacion(r.tamano || 'PEQUENO')
    const especie = especiesMap.get(normalizarImportacion(r.especie))
    const valor = parseNumeroImportacion(r.valor)
    if (r.tipo_afiliacion && !TIPOS_IMPORTACION.has(tipo)) errores.push('Tipo debe ser ANUAL o VITALICIO')
    if (r.nivel && !NIVELES_IMPORTACION.has(nivel)) errores.push('Nivel no válido')
    if (!METODOS_IMPORTACION.has(metodo)) errores.push('Método de pago no válido')
    if (!SEXOS_IMPORTACION.has(sexo)) errores.push('Sexo debe ser Macho o Hembra')
    if (!TAMANOS_IMPORTACION.has(tamano)) errores.push('Tamaño no válido')

    if (r.fecha_inicio && !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_inicio)) errores.push('Fecha inicio debe ser AAAA-MM-DD')
    if (r.fecha_pago && !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_pago)) errores.push('Fecha pago debe ser AAAA-MM-DD')
    if (!(valor > 0)) errores.push('Valor debe ser mayor que cero')
    if (/,| y /i.test(r.mascota_nombre || '')) errores.push('Una mascota por fila (varias mascotas = varias filas con los mismos datos de contrato)')
    const edad = parseInt(r.edad_anios)
    const edadOk = Number.isFinite(edad) && edad >= 0 && edad <= 40
    if (r.edad_anios && !edadOk) errores.push('Edad debe ser un número de años entre 0 y 40')
    return {
      ...r, fila: index + 2, errores, tipo, nivel, metodo,
      sexo: sexo === 'HEMBRA' ? 'Hembra' : 'Macho',
      tamano: { MINI: 'Mini', PEQUENO: 'Pequeño', MEDIANO: 'Mediano', GRANDE: 'Grande', GIGANTE: 'Gigante' }[tamano],
      especie_id: especie?.id, valor_num: valor,
      edad_num: edadOk ? edad : null,
    }
  })
}

// Un contrato = titular + tipo + nivel + fecha (exactamente lo que codifica el
// número ABR1124SR10-BR1). Las filas que coinciden en eso son sus mascotas.
function agruparFilasImportacion(filas) {
  const grupos = new Map()
  for (const r of filas) {
    const clave = [r.cedula_nit, r.tipo, r.nivel, r.fecha_inicio].join('|')
    if (!grupos.has(clave)) grupos.set(clave, { clave, cabecera: r, mascotas: [] })
    grupos.get(clave).mascotas.push(r)
  }
  return [...grupos.values()]
}

export default function Presequiales() {
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const { personalData } = useAuth()

  const [data, setData]         = useState([])   // contratos, con sus mascotas colgando
  const [config, setConfig]     = useState(null)
  const [planes, setPlanes]     = useState([])
  const [especies, setEspecies] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [filtro, setFiltro]     = useState('VIGENTES')
  const [busqueda, setBusqueda] = useState('')

  const [modalNueva, setModalNueva]   = useState(false)
  const [modalImportar, setModalImportar] = useState(false)
  const [ficha, setFicha]             = useState(null)   // contrato abierto
  const [modalRenovar, setModalRenovar] = useState(null)
  const [modalActivar, setModalActivar] = useState(null) // { afiliacion, am }

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [cfg, { data: d, error: e1 }, { data: pls }, { data: esp }] = await Promise.all([
        cargarConfigAfiliaciones(),
        db.from('afiliaciones')
          .select(`*,
            clientes(id_cliente,nombre,apellido,whatsapp,telefono,email,cedula_nit,direccion,ciudad),
            afiliacion_contratos(*),
            afiliacion_mascotas(id,estado,fecha_activacion,servicio_activado_id,created_at,
              mascotas(id_mascota,nombre,raza,peso_kg,fallecida,edad_anios,edad_declarada_en,especie_id,especies(nombre)))`)
          .order('created_at', { ascending: false }),
        db.from('planes').select('id,codigo,nombre').eq('activo', true),
        db.from('especies').select('id,nombre').order('nombre'),
      ])
      if (e1) throw e1
      setConfig(cfg)
      setData(d || [])
      setPlanes(pls || [])
      setEspecies(esp || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // La ficha abierta se refresca desde la lista recargada
  useEffect(() => {
    if (ficha) setFicha(data.find(a => a.id === ficha.id) || null)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const diasAviso = parseInt(config?.dias_aviso_renovacion) || 30

  const porVencer = a => {
    if (a.tipo !== 'ANUAL' || !['VIGENTE', 'VENCIDA'].includes(a.estado)) return false
    const d = diasPara(contratoVigente(a)?.fecha_vencimiento)
    return d !== null && d <= diasAviso
  }

  // Una fila por mascota: es la unidad con la que trabaja el coordinador
  // (se activa una mascota, no un contrato).
  const filas = useMemo(() => data.flatMap(a => {
    const ct = contratoVigente(a)
    const ms = mascotasDe(a)
    return ms.map((am, i) => ({
      a, am, ct, indice: i + 1, hermanas: ms.length, estado: estadoMascota(a, am),
    }))
  }), [data])

  const filtrados = useMemo(() => {
    let out = filas
    if (filtro === 'VIGENTES')   out = filas.filter(f => f.estado === 'VIGENTE')
    if (filtro === 'POR_VENCER') out = filas.filter(f => porVencer(f.a) && ['VIGENTE', 'VENCIDA'].includes(f.estado))
    if (filtro === 'VENCIDAS')   out = filas.filter(f => f.estado === 'VENCIDA')
    if (filtro === 'ACTIVADAS')  out = filas.filter(f => f.estado === 'ACTIVADA')
    if (filtro === 'CANCELADAS') out = filas.filter(f => f.estado === 'CANCELADA')
    const q = busqueda.trim().toLowerCase()
    if (q) out = out.filter(f =>
      `${f.a.clientes?.nombre} ${f.a.clientes?.apellido} ${f.a.clientes?.cedula_nit} ${f.a.clientes?.whatsapp} ${f.am.mascotas?.nombre}`
        .toLowerCase().includes(q) ||
      (f.a.afiliacion_contratos || []).some(c => (c.numero_contrato || '').toLowerCase().includes(q)))
    return out
  }, [filas, filtro, busqueda, diasAviso]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const vigentes   = filas.filter(f => f.estado === 'VIGENTE').length
  const nPorVencer = filas.filter(f => porVencer(f.a) && ['VIGENTE', 'VENCIDA'].includes(f.estado)).length
  const activadas  = filas.filter(f => f.estado === 'ACTIVADA').length
  // Recaudado: cada contrato de la cadena vale su precio unitario × nº de mascotas
  const recaudado = data.reduce((acc, a) => {
    const n = mascotasDe(a).length
    return acc + (a.afiliacion_contratos || []).reduce((s, c) => s + totalContrato(c, n), 0)
  }, 0)

  return (
    <div>
      <Topbar actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => setModalImportar(true)}><Upload size={14} /> Importar</Button>
          <Button size="sm" onClick={() => setModalNueva(true)}><Plus size={14} /> Nueva afiliación</Button>
          <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
            <RefreshCw size={15} />
          </button>
        </>
      } />
      <div className="p-4 sm:p-7">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Mascotas cubiertas" value={vigentes} valueColor="#1D8A55" />
          <StatCard label="Por vencer" value={nPorVencer} valueColor="#9A5500" />
          <StatCard label="Recaudado" value={fmt(recaudado)} valueColor="#3B6FBF" />
          <StatCard label="Activadas" value={activadas} valueColor="#5B21B6" />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {FILTROS.map(f => (
              <button key={f.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => setFiltro(f.key)}>
                {f.label}{f.key === 'POR_VENCER' && nPorVencer > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#9A5500] text-white text-[10px]">{nPorVencer}</span>}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Cliente, mascota, cédula o Nº contrato..." className="pl-8 w-72" />
          </div>
          <span className="text-[11px] text-ink3 ml-auto">{filtrados.length} mascota{filtrados.length === 1 ? '' : 's'}</span>
        </div>

        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th><Th>Mascota</Th><Th>Plan</Th><Th>Contrato</Th>
                <Th>Vence</Th><Th>Valor</Th><Th>Estado</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(f => {
                const { a, am, ct } = f
                const c = a.clientes, m = am.mascotas
                const nc = NIVEL_COLORS[a.nivel] || {}
                const dias = a.tipo === 'ANUAL' ? diasPara(ct?.fecha_vencimiento) : null
                return (
                  <Tr key={am.id} className="cursor-pointer" onClick={() => setFicha(a)}>
                    <Td>
                      <div className="font-semibold text-ink">{c?.nombre} {c?.apellido}</div>
                      <div className="text-[10px] text-ink3">{c?.cedula_nit}</div>
                    </Td>
                    <Td className="text-ink2">
                      <div>{petEmoji(m?.especies?.nombre)} {m?.nombre}</div>
                      {datosMascotaTexto(m)
                        ? <div className="text-[10px] text-ink3">{datosMascotaTexto(m)}</div>
                        : <div className="text-[10px] text-[#9A5500] font-semibold">Sin peso ni edad</div>}
                    </Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: nc.bg, color: nc.text, borderColor: nc.border }}>{a.nivel}</span>
                      <span className="ml-1.5 text-[10px] font-semibold text-ink3">{a.tipo === 'VITALICIO' ? 'Vitalicio' : 'Anual'}</span>
                    </Td>
                    <Td>
                      <div className="font-mono text-[11px] text-ink2">{ct?.numero_contrato || '—'}</div>
                      {f.hermanas > 1 && (
                        <div className="text-[10px] text-ink3">Mascota {f.indice} de {f.hermanas}</div>
                      )}
                    </Td>
                    <Td>
                      {a.tipo === 'VITALICIO'
                        ? <span className="text-[11px] font-semibold text-primary-dark">De por vida</span>
                        : ct?.fecha_vencimiento
                          ? <div>
                              <div className="text-[12px] text-ink2">{ct.fecha_vencimiento}</div>
                              {['VIGENTE','VENCIDA'].includes(f.estado) && dias !== null && (
                                <div className={`text-[10px] font-bold ${dias < 0 ? 'text-danger' : dias <= diasAviso ? 'text-[#9A5500]' : 'text-ink3'}`}>
                                  {dias < 0 ? `Vencida hace ${-dias} d` : `Faltan ${dias} d`}
                                </div>)}
                            </div>
                          : '—'}
                    </Td>
                    <Td>
                      <div className="font-semibold text-ink">{fmt(ct?.valor)}</div>
                      {f.hermanas > 1 && <div className="text-[10px] text-ink3">por mascota</div>}
                    </Td>
                    <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[f.estado] || ''}`}>{f.estado}</span></Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {porVencer(a) && c?.whatsapp && ['VIGENTE','VENCIDA'].includes(f.estado) && (
                          <a href={waLink(c.whatsapp, mensajeRenovacion(a, ct, config))} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-primary-dark bg-green-light hover:opacity-80">
                            <MessageCircle size={11} /> Recordar
                          </a>
                        )}
                        {['VIGENTE','VENCIDA'].includes(f.estado) && (
                          <Button size="sm" variant="gold" onClick={() => setModalActivar({ afiliacion: a, am })}>
                            <Rocket size={11} /> Activar
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-ink3 text-sm">Sin afiliaciones en este filtro</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {modalImportar && (
        <ModalImportarAfiliaciones especies={especies} personalData={personalData}
          onClose={() => setModalImportar(false)} onImported={cargar} />
      )}

      {modalNueva && (
        <ModalNuevaAfiliacion config={config} especies={especies} personalData={personalData}
          onClose={() => setModalNueva(false)}
          onSaved={async () => { setModalNueva(false); await cargar() }} />
      )}

      {ficha && (
        <ModalFicha afiliacion={ficha} config={config} especies={especies}
          onClose={() => setFicha(null)}
          onRenovar={() => setModalRenovar({ afiliacion: ficha })}
          onActivar={am => setModalActivar({ afiliacion: ficha, am })}
          onCancelar={async () => {
            const n = mascotasDe(ficha).filter(am => am.estado === 'VIGENTE').length
            const ok = await confirm(
              `El contrato ${contratoVigente(ficha)?.numero_contrato} quedará CANCELADO y con él ${n === 1 ? 'la mascota que cubre' : `las ${n} mascotas que cubre`}. Si el cliente quiere volver, se afilia de nuevo desde cero (contrato 0, cláusulas reactivadas). ¿Continuar?`,
              { title: 'Cancelar afiliación', confirmLabel: 'Sí, cancelar' },
            )
            if (!ok) return
            await db.from('afiliaciones').update({ estado: 'CANCELADA' }).eq('id', ficha.id)
            await cargar()
          }}
          onChanged={cargar} />
      )}

      {modalRenovar && (
        <ModalRenovar afiliacion={modalRenovar.afiliacion} config={config} personalData={personalData}
          onClose={() => setModalRenovar(null)}
          onSaved={async () => { setModalRenovar(null); await cargar() }} />
      )}

      {modalActivar && (
        <ModalActivar afiliacion={modalActivar.afiliacion} am={modalActivar.am} config={config} planes={planes}
          onClose={() => setModalActivar(null)}
          onConfirm={({ plan, cobro, motivo }) => {
            navigate('/registro', {
              state: {
                presequial: {
                  id:          modalActivar.afiliacion.id,
                  // La activación es por mascota: solo esta fila pasa a ACTIVADA.
                  afiliacion_mascota_id: modalActivar.am.id,
                  cliente_id:  modalActivar.afiliacion.cliente_id,
                  mascota_id:  modalActivar.am.mascotas?.id_mascota,
                  plan_id:     plan.id,
                  nivel:       modalActivar.afiliacion.nivel,
                  tipo:        modalActivar.afiliacion.tipo,
                  valor_plan_override: cobro,
                  motivo,
                },
              },
            })
          }} />
      )}
    </div>
  )
}

function mensajeRenovacion(a, ct, config) {
  const unit = parseFloat(config?.precios?.ANUAL?.[a.nivel]) || parseFloat(ct?.valor) || 0
  const vivas = mascotasDe(a).filter(am => am.estado === 'VIGENTE')
  const nombres = vivas.map(am => am.mascotas?.nombre).filter(Boolean)
  const lista = nombres.length > 1
    ? nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1]
    : (nombres[0] || 'tu mascota')
  const total = unit * (vivas.length || 1)
  return `Hola ${a.clientes?.nombre} 👋 Te escribimos de Camino al Cielo 🌈\n\n` +
    `La afiliación pre-exequial ${a.nivel} de ${lista} vence el ${ct?.fecha_vencimiento}. ` +
    (vivas.length > 1
      ? `Renovarla por un año más tiene un valor de ${fmt(total)} (${vivas.length} mascotas × ${fmt(unit)})`
      : `Renovarla por un año más tiene un valor de ${fmt(total)}`) +
    ` y mantiene ${nombres.length > 1 ? 'sus servicios cubiertos' : 'su servicio cubierto'}.\n\n¿Deseas renovarla?`
}

function descargarPlantillaImportacion() {
  const contenido = '\uFEFF' + COLUMNAS_IMPORTACION.join(';') + '\r\n'
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla_pre_exequiales.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function ModalImportarAfiliaciones({ especies, personalData, onClose, onImported }) {
  const [archivo, setArchivo] = useState(null)
  const [filas, setFilas] = useState([])
  const [errorArchivo, setErrorArchivo] = useState('')
  const [importando, setImportando] = useState(false)
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 })
  const [resultado, setResultado] = useState(null)

  const filasConError = filas.filter(f => f.errores.length)
  const grupos = useMemo(() => agruparFilasImportacion(filas.filter(f => !f.errores.length)), [filas])
  const puedeImportar = filas.length > 0 && filasConError.length === 0 && !importando

  async function seleccionarArchivo(file) {
    setArchivo(file || null)
    setFilas([])
    setResultado(null)
    setProgreso({ actual: 0, total: 0 })
    setErrorArchivo('')
    if (!file) return
    try {
      const parsed = parseArchivoDelimitado(await file.text())
      const faltantes = COLUMNAS_REQUERIDAS.filter(c => !parsed.headers.includes(c))
      if (faltantes.length) {
        setErrorArchivo('Faltan columnas obligatorias: ' + faltantes.join(', '))
        return
      }
      setFilas(validarFilasImportacion(parsed.rows, especies))
      if (!parsed.rows.length) setErrorArchivo('El archivo no contiene filas para importar.')
    } catch (e) {
      setErrorArchivo(e.message || 'No se pudo leer el archivo.')
    }
  }

  // Cada grupo = un contrato con sus mascotas (mismo titular, tipo, nivel y fecha).
  async function importar() {
    if (!puedeImportar) return
    setImportando(true)
    setProgreso({ actual: 0, total: grupos.length })
    setResultado(null)
    const errores = []
    let ok = 0, mascotasOk = 0
    const clientesCache = new Map()

    try {
      for (const [index, g] of grupos.entries()) {
        const r = g.cabecera
        try {
          let cliente = clientesCache.get(r.cedula_nit)
          if (!cliente) {
            const { data: existente, error: eCliente } = await db.from('clientes')
              .select('id_cliente,nombre,apellido,cedula_nit,whatsapp')
              .eq('cedula_nit', r.cedula_nit).maybeSingle()
            if (eCliente) throw eCliente
            cliente = existente
            if (!cliente) {
              const { data: creado, error } = await db.from('clientes').insert({
                nombre: r.cliente_nombre.trim(),
                apellido: r.cliente_apellido.trim(),
                cedula_nit: r.cedula_nit.trim(),
                whatsapp: r.whatsapp.trim(),
                telefono: r.telefono?.trim() || null,
                email: r.email?.trim() || null,
                direccion: r.direccion?.trim() || null,
                ciudad: r.ciudad?.trim() || 'Bogotá',
                tipo_cliente: 'NORMAL',
              }).select('id_cliente,nombre,apellido,cedula_nit,whatsapp').single()
              if (error) throw error
              cliente = creado
            }
            clientesCache.set(r.cedula_nit, cliente)
          }

          // Mascotas del contrato: buscar-o-crear una por fila
          const mascotaIds = []
          for (const fila of g.mascotas) {
            const { data: existentes, error: eMascota } = await db.from('mascotas')
              .select('id_mascota,nombre').eq('cliente_id', cliente.id_cliente)
              .ilike('nombre', fila.mascota_nombre.trim()).limit(1)
            if (eMascota) throw eMascota
            let mascota = (existentes || [])[0]
            if (!mascota) {
              const { data: creada, error } = await db.from('mascotas').insert({
                nombre: fila.mascota_nombre.trim(),
                especie_id: fila.especie_id || null,
                raza: fila.raza?.trim() || null,
                sexo: fila.sexo,
                tamano: fila.tamano,
                peso_kg: parseNumeroImportacion(fila.peso_kg) || 0,
                cliente_id: cliente.id_cliente,
                fallecida: false,
                // La edad va impresa en el contrato; se guarda con la fecha en
                // que se declaró para poder envejecerla después (migración 056).
                edad_anios: fila.edad_num ?? null,
                edad_declarada_en: fila.edad_num == null ? null : r.fecha_inicio,
              }).select('id_mascota,nombre').single()
              if (error) throw error
              mascota = creada
            }
            mascotaIds.push(mascota.id_mascota)
          }

          const { data: yaCubiertas, error: eCubiertas } = await db.from('afiliacion_mascotas')
            .select('mascota_id, mascotas(nombre), afiliaciones!inner(estado)')
            .in('mascota_id', mascotaIds)
            .eq('estado', 'VIGENTE')
            .in('afiliaciones.estado', ['VIGENTE', 'VENCIDA'])
          if (eCubiertas) throw eCubiertas
          if ((yaCubiertas || []).length)
            throw new Error('Ya tienen afiliación viva: ' + yaCubiertas.map(x => x.mascotas?.nombre).join(', '))

          const { data: afiliacion, error: eAfiliacion } = await db.from('afiliaciones').insert({
            tipo: r.tipo,
            nivel: r.nivel,
            cliente_id: cliente.id_cliente,
            estado: 'VIGENTE',
            notas: r.notas?.trim() || null,
            creado_por: personalData?.id || null,
          }).select('id').single()
          if (eAfiliacion) throw eAfiliacion

          try {
            const { error: eMasc } = await db.from('afiliacion_mascotas').insert(
              mascotaIds.map(id => ({ afiliacion_id: afiliacion.id, mascota_id: id, estado: 'VIGENTE' })))
            if (eMasc) throw eMasc

            const numeroContrato = generarNumeroContrato({
              fechaInicio: r.fecha_inicio, cliente, nivel: r.nivel, tipo: r.tipo, numero: 0,
            })
            const { error: eContrato } = await db.from('afiliacion_contratos').insert({
              afiliacion_id: afiliacion.id,
              numero: 0,
              numero_contrato: numeroContrato,
              fecha_inicio: r.fecha_inicio,
              fecha_vencimiento: r.tipo === 'ANUAL' ? sumarUnAnio(r.fecha_inicio) : null,
              valor: r.valor_num,              // precio POR MASCOTA
              metodo_pago: r.metodo,
              fecha_pago: r.fecha_pago || null,
              comprobantes: [],
              creado_por: personalData?.id || null,
            })
            if (eContrato) throw eContrato
          } catch (e) {
            // sin contrato/mascotas la afiliación no sirve: no dejar huérfanas
            await db.from('afiliaciones').delete().eq('id', afiliacion.id)
            throw e
          }
          ok++
          mascotasOk += mascotaIds.length
        } catch (e) {
          errores.push({ fila: g.mascotas[0].fila, mensaje: e.message || 'Error desconocido' })
        } finally {
          setProgreso({ actual: index + 1, total: grupos.length })
        }
      }

      setResultado({ ok, mascotasOk, errores })
    } finally {
      setImportando(false)
    }

    if (ok > 0) onImported().catch(() => {})
  }

  return (
    <Modal open onClose={onClose} title="Importar afiliaciones Pre-Exequiales" maxWidth="max-w-4xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        <Button onClick={importar} disabled={!puedeImportar}>
          <Upload size={13} /> {importando
            ? `Importando ${progreso.actual}/${progreso.total}`
            : `Importar ${grupos.length} contrato${grupos.length === 1 ? '' : 's'}`}
        </Button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center transition-colors hover:border-[#1A5CD8]/40 hover:bg-blue-50/40 focus-within:ring-2 focus-within:ring-[#1A5CD8]/20">
            <FileSpreadsheet size={22} className="mx-auto mb-2 text-[#1A5CD8]" />
            <span className="block text-[13px] font-bold text-gray-800">{archivo?.name || 'Seleccionar archivo CSV'}</span>
            <span className="block text-[11px] text-gray-500 mt-1">Compatible con CSV de Excel, separado por coma, punto y coma o tabulación</span>
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="sr-only"
              onChange={e => seleccionarArchivo(e.target.files?.[0] || null)} />
          </label>
          <button type="button" onClick={descargarPlantillaImportacion}
            className="sm:w-52 rounded-xl border border-gray-200 bg-white px-4 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/20">
            <Download size={18} className="mb-2 text-gray-600" />
            <span className="block text-[12px] font-bold text-gray-800">Descargar plantilla</span>
            <span className="block text-[10px] text-gray-500 mt-1">Incluye las {COLUMNAS_IMPORTACION.length} columnas en el orden correcto</span>
          </button>
        </div>

        <div className="rounded-xl bg-blue-50 px-4 py-3 text-[11px] text-blue-900">
          <strong>Una mascota por fila.</strong> Varias mascotas en un mismo contrato = varias filas repitiendo
          cédula, tipo, nivel y fecha de inicio — se agrupan solas. <strong>El valor es por mascota</strong>
          (un BRONCE anual de 3 mascotas son 3 filas de 37.000, no una de 111.000).
          <div className="mt-1">Valores controlados: tipo ANUAL/VITALICIO · nivel BRONCE/PLATA/ORO/DIAMANTE ·
          sexo Macho/Hembra · fechas AAAA-MM-DD. Especie y peso son opcionales.</div>
        </div>

        {errorArchivo && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {errorArchivo}
          </div>
        )}

        {filas.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-700">{filas.length} filas</span>
              <span className="rounded-full bg-green-100 px-2.5 py-1 font-semibold text-green-700">{filas.length - filasConError.length} válidas</span>
              {filasConError.length > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">{filasConError.length} con errores</span>}
              {!filasConError.length && <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">→ {grupos.length} contratos</span>}
            </div>
            <div className="max-h-72 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[720px] border-collapse text-[11px]">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                  <tr><th className="px-3 py-2">Fila</th><th>Cliente</th><th>Mascota</th><th>Plan</th><th>Validación</th></tr>
                </thead>
                <tbody>
                  {filas.map(r => (
                    <tr key={r.fila} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono text-gray-500">{r.fila}</td>
                      <td>{r.cliente_nombre} {r.cliente_apellido}<div className="text-[9px] text-gray-400">{r.cedula_nit}</div></td>
                      <td>{r.mascota_nombre}<div className="text-[9px] text-gray-400">{r.especie || 'Sin especie'}</div></td>
                      <td>{r.tipo} · {r.nivel}<div className="text-[9px] text-gray-400">{fmt(r.valor_num || 0)} c/u</div></td>
                      <td className="pr-3">
                        {r.errores.length
                          ? <span className="text-red-600">{r.errores.join(' · ')}</span>
                          : <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 size={12} /> Lista</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filasConError.length && grupos.some(g => g.mascotas.length > 1) && (
              <div className="rounded-xl border border-gray-200 px-4 py-3 text-[11px] text-gray-700">
                <div className="font-bold mb-1 text-gray-800">Contratos con varias mascotas</div>
                {grupos.filter(g => g.mascotas.length > 1).map(g => (
                  <div key={g.clave}>
                    {g.cabecera.cliente_nombre} {g.cabecera.cliente_apellido} · {g.cabecera.nivel} {g.cabecera.tipo} ·{' '}
                    <strong>{g.mascotas.length} mascotas</strong> ({g.mascotas.map(m => m.mascota_nombre).join(', ')}) ·
                    total {fmt(g.cabecera.valor_num * g.mascotas.length)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {resultado && (
          <div className={'rounded-xl border px-4 py-3 text-[12px] ' + (resultado.errores.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800')}>
            <div className="font-bold">Importados: {resultado.ok} contratos · {resultado.mascotasOk} mascotas</div>
            {resultado.errores.length > 0 && (
              <div className="mt-1 max-h-28 overflow-auto">
                {resultado.errores.map(e => <div key={e.fila}>Fila {e.fila}: {e.mensaje}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Nueva afiliación: buscar-o-crear cliente + N mascotas + primer contrato ──
const MASCOTA_VACIA = () => ({ key: crypto.randomUUID(), nombre: '', especie_id: '', raza: '', sexo: 'Macho', tamano: 'Pequeño', peso_kg: '', edad: '' })

function ModalNuevaAfiliacion({ config, especies, personalData, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const [saving, setSaving] = useState(false)

  // cliente
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [cliente, setCliente] = useState(null)
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [formCliente, setFormCliente] = useState({ nombre: '', apellido: '', cedula_nit: '', whatsapp: '', telefono: '', email: '', direccion: '', ciudad: 'Bogotá' })
  const debounceRef = useRef(null)

  // mascotas: varias por contrato — existentes marcadas + nuevas a crear
  const [mascotasCliente, setMascotasCliente] = useState([])
  const [seleccionadas, setSeleccionadas] = useState([])   // ids de mascotas existentes
  const [nuevas, setNuevas] = useState([])                 // formularios de mascota nueva
  // Edad en años por mascota existente: el contrato la imprime y el cliente la
  // da en años, no como fecha de nacimiento (migración 056). El peso también se
  // imprime y cambia con el tiempo, así que se puede corregir aquí mismo.
  const [edades, setEdades] = useState({})
  const [pesos, setPesos] = useState({})

  // plan + pago
  const [tipo, setTipo]   = useState('ANUAL')
  const [nivel, setNivel] = useState('BRONCE')
  const [fechaInicio, setFechaInicio] = useState(today())
  const [valor, setValor] = useState('')
  const [valorTocado, setValorTocado] = useState(false)
  const [metodoPago, setMetodoPago] = useState('EFECTIVO')
  const [fechaPago, setFechaPago] = useState(today())
  const [comprobanteFile, setComprobanteFile] = useState(null)
  const [notas, setNotas] = useState('')

  // Precio de configuración al cambiar tipo/nivel (editable si el coordinador lo pisa)
  useEffect(() => {
    if (valorTocado) return
    const p = parseFloat(config?.precios?.[tipo]?.[nivel])
    setValor(p > 0 ? String(p) : '')
  }, [tipo, nivel]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = clienteBusqueda.trim()
    if (!q || cliente) { setResultados([]); return }
    debounceRef.current = setTimeout(async () => {
      const { data } = await db.from('clientes')
        .select('id_cliente,nombre,apellido,cedula_nit,whatsapp')
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,cedula_nit.ilike.%${q}%,whatsapp.ilike.%${q}%`)
        .limit(8)
      setResultados(data || [])
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [clienteBusqueda, cliente])

  async function elegirCliente(c) {
    setCliente(c); setClienteNuevo(false); setResultados([]); setClienteBusqueda('')
    setSeleccionadas([]); setNuevas([]); setEdades({}); setPesos({})
    const { data } = await db.from('mascotas')
      .select('id_mascota,nombre,fallecida,peso_kg,edad_anios,edad_declarada_en,especies(nombre)')
      .eq('cliente_id', c.id_cliente).order('nombre')
    setMascotasCliente(data || [])
    // Precarga la edad que ya conocemos, envejecida a hoy, y el peso registrado
    setEdades(Object.fromEntries((data || [])
      .map(m => [m.id_mascota, edadALaFecha(m)])
      .filter(([, e]) => e != null)
      .map(([id, e]) => [id, String(e)])))
    setPesos(Object.fromEntries((data || [])
      .filter(m => parseFloat(m.peso_kg) > 0)
      .map(m => [m.id_mascota, String(m.peso_kg)])))
  }

  const nuevasValidas = nuevas.filter(m => m.nombre.trim())
  const nMascotas = seleccionadas.length + nuevasValidas.length
  // apellido: clientes.apellido es NOT NULL y su inicial va en el nº de contrato
  const clienteListo = cliente || (clienteNuevo && formCliente.nombre.trim() && formCliente.apellido.trim() && formCliente.whatsapp.trim() && formCliente.cedula_nit.trim())
  const valorNum = parseFloat(valor) || 0
  const puedeGuardar = clienteListo && nMascotas > 0 && valorNum > 0 && !saving

  const previewCodigo = (clienteListo && !saving) ? generarNumeroContrato({
    fechaInicio,
    cliente: cliente || formCliente,
    nivel, tipo, numero: 0,
  }) : null

  async function guardar() {
    setSaving(true)
    try {
      let clienteId = cliente?.id_cliente
      if (!clienteId) {
        const { data, error } = await db.from('clientes').insert({
          nombre: formCliente.nombre.trim(), apellido: formCliente.apellido.trim(),
          cedula_nit: formCliente.cedula_nit.trim(), whatsapp: formCliente.whatsapp.trim(),
          telefono: formCliente.telefono.trim() || null,
          email: formCliente.email.trim() || null, direccion: formCliente.direccion.trim() || null,
          ciudad: formCliente.ciudad || 'Bogotá', tipo_cliente: 'NORMAL',
        }).select('id_cliente').single()
        if (error) throw error
        clienteId = data.id_cliente
      }

      // La edad se guarda con la fecha en que se declaró para que no se pudra:
      // la vigente = edad_anios + años transcurridos (migración 056).
      const edadCols = anios => {
        const n = parseInt(anios)
        return Number.isFinite(n) && n >= 0
          ? { edad_anios: n, edad_declarada_en: fechaInicio }
          : { edad_anios: null, edad_declarada_en: null }
      }

      const mascotaIds = [...seleccionadas]
      for (const m of nuevasValidas) {
        const { data, error } = await db.from('mascotas').insert({
          nombre: m.nombre.trim(),
          especie_id: parseInt(m.especie_id) || null,
          raza: m.raza.trim() || null,
          sexo: m.sexo, tamano: m.tamano,
          peso_kg: parseFloat(m.peso_kg) || 0,
          cliente_id: clienteId, fallecida: false,
          ...edadCols(m.edad),
        }).select('id_mascota').single()
        if (error) throw error
        mascotaIds.push(data.id_mascota)
      }

      // Mascotas ya registradas: refrescar peso y edad que digitó el coordinador.
      // Solo se escribe lo que llenó: dejar un campo vacío no borra lo que había.
      for (const id of seleccionadas) {
        const cols = {}
        const edad = edadCols(edades[id])
        if (edad.edad_anios != null) Object.assign(cols, edad)
        const peso = parseFloat(pesos[id])
        if (Number.isFinite(peso) && peso > 0) cols.peso_kg = peso
        if (Object.keys(cols).length) await db.from('mascotas').update(cols).eq('id_mascota', id)
      }

      const { data: afil, error: e1 } = await db.from('afiliaciones').insert({
        tipo, nivel, cliente_id: clienteId,
        estado: 'VIGENTE', notas: notas.trim() || null,
        creado_por: personalData?.id || null,
      }).select('id').single()
      if (e1) throw e1

      try {
        // El trigger de la DB rechaza una mascota ya cubierta por otra afiliación viva
        const { error: eMasc } = await db.from('afiliacion_mascotas').insert(
          mascotaIds.map(id => ({ afiliacion_id: afil.id, mascota_id: id, estado: 'VIGENTE' })))
        if (eMasc) {
          if (eMasc.code === '23505') throw new Error('Una de las mascotas ya tiene una afiliación viva. Búscala en la lista.')
          throw eMasc
        }

        const comprobantes = []
        if (comprobanteFile) comprobantes.push(await subirComprobanteAfiliacion(afil.id, comprobanteFile))

        const numeroContrato = generarNumeroContrato({
          fechaInicio, cliente: cliente || formCliente, nivel, tipo, numero: 0,
        })
        const { error: e2 } = await db.from('afiliacion_contratos').insert({
          afiliacion_id: afil.id, numero: 0, numero_contrato: numeroContrato,
          fecha_inicio: fechaInicio,
          fecha_vencimiento: tipo === 'ANUAL' ? sumarUnAnio(fechaInicio) : null,
          valor: valorNum, metodo_pago: metodoPago, fecha_pago: fechaPago || null,
          comprobantes, creado_por: personalData?.id || null,
        })
        if (e2) throw e2
      } catch (e) {
        await db.from('afiliaciones').delete().eq('id', afil.id)
        throw e
      }
      await onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  const cfgPrecio = parseFloat(config?.precios?.[tipo]?.[nivel]) || 0
  const vivasCliente = mascotasCliente.filter(m => !m.fallecida)

  return (
    <Modal open onClose={onClose} title="Nueva afiliación pre-exequial" maxWidth="max-w-2xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={!puedeGuardar}>{saving ? 'Guardando...' : `Afiliar ${nMascotas || ''} mascota${nMascotas === 1 ? '' : 's'}`.trim()}</Button>
      </>}>
      <div className="space-y-5">
        {/* Cliente */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide">1 · Titular</h4>
            {!cliente && (
              <button className="text-[11px] font-semibold text-primary-dark hover:underline"
                onClick={() => { setClienteNuevo(v => !v); setResultados([]) }}>
                {clienteNuevo ? '← Buscar cliente existente' : '+ Cliente nuevo (no ha tomado servicio)'}
              </button>
            )}
          </div>
          {cliente ? (
            <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
              <div>
                <div className="font-semibold text-ink text-[13px]">{cliente.nombre} {cliente.apellido}</div>
                <div className="text-[11px] text-ink3">{cliente.cedula_nit} · {cliente.whatsapp}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => { setCliente(null); setSeleccionadas([]); setNuevas([]); setMascotasCliente([]) }}>Cambiar</Button>
            </div>
          ) : clienteNuevo ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL}>Nombre *</label><Input value={formCliente.nombre} onChange={e => setFormCliente(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div><label className={LABEL}>Apellido *</label><Input value={formCliente.apellido} onChange={e => setFormCliente(p => ({ ...p, apellido: e.target.value }))} /></div>
              <div><label className={LABEL}>Cédula / NIT *</label><Input value={formCliente.cedula_nit} onChange={e => setFormCliente(p => ({ ...p, cedula_nit: e.target.value }))} /></div>
              <div><label className={LABEL}>WhatsApp *</label><Input value={formCliente.whatsapp} onChange={e => setFormCliente(p => ({ ...p, whatsapp: e.target.value }))} /></div>
              <div><label className={LABEL}>Teléfono fijo</label><Input value={formCliente.telefono} onChange={e => setFormCliente(p => ({ ...p, telefono: e.target.value }))} /></div>
              <div><label className={LABEL}>Email</label><Input value={formCliente.email} onChange={e => setFormCliente(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className={LABEL}>Ciudad</label><Input value={formCliente.ciudad} onChange={e => setFormCliente(p => ({ ...p, ciudad: e.target.value }))} /></div>
              <div><label className={LABEL}>Dirección</label><Input value={formCliente.direccion} onChange={e => setFormCliente(p => ({ ...p, direccion: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-[13px] text-ink3" />
              <Input value={clienteBusqueda} onChange={e => setClienteBusqueda(e.target.value)}
                placeholder="Buscar por nombre, cédula o WhatsApp..." className="pl-8" />
              {resultados.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                  {resultados.map(r => (
                    <button key={r.id_cliente} onClick={() => elegirCliente(r)}
                      className="w-full text-left px-3 py-2 hover:bg-surface2 border-b last:border-0" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                      <div className="font-semibold text-ink text-[13px]">{r.nombre} {r.apellido}</div>
                      <div className="text-[11px] text-ink3">{r.cedula_nit} · {r.whatsapp}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {clienteNuevo && formCliente.nombre && !formCliente.cedula_nit.trim() && (
            <p className="text-[11px] text-[#9A5500] mt-1">La cédula es necesaria: hace parte del número de contrato.</p>
          )}
          {clienteNuevo && formCliente.nombre && !formCliente.apellido.trim() && (
            <p className="text-[11px] text-[#9A5500] mt-1">El apellido es necesario: su inicial hace parte del número de contrato.</p>
          )}
        </section>

        {/* Mascotas: un contrato cubre varias */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide">
              2 · Mascotas {nMascotas > 0 && <span className="text-primary-dark">({nMascotas})</span>}
            </h4>
            {(cliente || clienteNuevo) && (
              <button className="text-[11px] font-semibold text-primary-dark hover:underline"
                onClick={() => setNuevas(p => [...p, MASCOTA_VACIA()])}>
                + Mascota nueva
              </button>
            )}
          </div>

          {cliente && vivasCliente.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {vivasCliente.map(m => {
                const marcada = seleccionadas.includes(m.id_mascota)
                return (
                  <div key={m.id_mascota}
                    className={`w-full px-3 py-2 rounded-lg border-2 flex items-center gap-2 transition-all ${marcada ? 'border-primary-dark bg-green-light' : 'border-transparent bg-surface2 hover:bg-surface3'}`}>
                    <button className="flex-1 text-left flex items-center gap-2"
                      onClick={() => setSeleccionadas(p => marcada ? p.filter(x => x !== m.id_mascota) : [...p, m.id_mascota])}>
                      <CheckCircle2 size={15} className={marcada ? 'text-primary-dark' : 'text-ink3/30'} />
                      <span className="font-semibold text-ink text-[13px]">
                        {petEmoji(m.especies?.nombre)} {m.nombre} <span className="text-ink3 font-normal">({m.especies?.nombre || 'sin especie'})</span>
                      </span>
                    </button>
                    {/* Peso y edad van impresos en el contrato */}
                    {marcada && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-bold text-ink3">Peso</span>
                        <Input type="number" min="0" step="0.1" value={pesos[m.id_mascota] ?? ''}
                          onChange={e => setPesos(p => ({ ...p, [m.id_mascota]: e.target.value }))}
                          className="w-16 h-7 text-[12px]" placeholder="kg" />
                        <span className="text-[10px] font-bold text-ink3">Edad</span>
                        <Input type="number" min="0" max="40" value={edades[m.id_mascota] ?? ''}
                          onChange={e => setEdades(p => ({ ...p, [m.id_mascota]: e.target.value }))}
                          className="w-16 h-7 text-[12px]" placeholder="años" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {cliente && vivasCliente.length === 0 && !nuevas.length && (
            <p className="text-[12px] text-ink3 mb-2">Este cliente no tiene mascotas vivas registradas — agrégalas con "+ Mascota nueva".</p>
          )}
          {!cliente && !clienteNuevo && (
            <p className="text-[12px] text-ink3">Elige primero el titular.</p>
          )}

          {nuevas.map((m, i) => (
            <div key={m.key} className="border rounded-xl p-3 mb-2 relative" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <button className="absolute top-2 right-2 text-ink3 hover:text-danger"
                onClick={() => setNuevas(p => p.filter(x => x.key !== m.key))}><X size={14} /></button>
              <div className="text-[10px] font-bold text-ink3 uppercase mb-2">Mascota nueva {i + 1}</div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={LABEL}>Nombre *</label>
                  <Input value={m.nombre} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, nombre: e.target.value } : x))} /></div>
                <div><label className={LABEL}>Especie</label>
                  <Select value={m.especie_id} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, especie_id: e.target.value } : x))}>
                    <option value="">Seleccionar...</option>
                    {especies.map(e2 => <option key={e2.id} value={e2.id}>{e2.nombre}</option>)}
                  </Select></div>
                <div><label className={LABEL}>Raza</label>
                  <Input value={m.raza} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, raza: e.target.value } : x))} /></div>
                <div><label className={LABEL}>Edad (años)</label>
                  <Input type="number" min="0" max="40" value={m.edad}
                    onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, edad: e.target.value } : x))} /></div>
                <div><label className={LABEL}>Sexo</label>
                  <Select value={m.sexo} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, sexo: e.target.value } : x))}>
                    <option>Macho</option><option>Hembra</option>
                  </Select></div>
                <div><label className={LABEL}>Tamaño</label>
                  <Select value={m.tamano} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, tamano: e.target.value } : x))}>
                    <option>Mini</option><option>Pequeño</option><option>Mediano</option><option>Grande</option><option>Gigante</option>
                  </Select></div>
                <div><label className={LABEL}>Peso (kg)</label>
                  <Input type="number" min="0" step="0.1" value={m.peso_kg} onChange={e => setNuevas(p => p.map(x => x.key === m.key ? { ...x, peso_kg: e.target.value } : x))} /></div>
              </div>
            </div>
          ))}
        </section>

        {/* Plan */}
        <section>
          <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">3 · Plan</h4>
          <div className="flex gap-2 mb-3">
            {['ANUAL', 'VITALICIO'].map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className={`flex-1 px-3 py-2 rounded-xl border-2 text-left transition-all ${tipo === t ? 'border-primary-dark bg-green-light' : 'border-transparent bg-surface2 hover:bg-surface3'}`}>
                <div className="font-bold text-ink text-[13px]">{t === 'ANUAL' ? 'Anual' : 'Vitalicio'}</div>
                <div className="text-[10px] text-ink3">{t === 'ANUAL' ? 'Un pago cada año · renovable · cláusula el primer año' : 'Un solo pago · cubierta de por vida'}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {NIVELES.map(n => {
              const ncol = NIVEL_COLORS[n]
              const precio = parseFloat(config?.precios?.[tipo]?.[n]) || 0
              return (
                <button key={n} onClick={() => setNivel(n)}
                  className={`px-2 py-2 rounded-xl border-2 text-center transition-all ${nivel === n ? '' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: ncol.bg, borderColor: nivel === n ? ncol.text : 'transparent' }}>
                  <div className="text-[11px] font-bold" style={{ color: ncol.text }}>{n}</div>
                  <div className="text-[10px] font-semibold text-ink2">{precio > 0 ? fmt(precio) : 'Sin precio'}</div>
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={LABEL}>Fecha de afiliación</label>
              <Input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} /></div>
            <div><label className={LABEL}>Valor por mascota {cfgPrecio > 0 && valorNum !== cfgPrecio ? '(pisado)' : ''}</label>
              <Input type="number" min="0" value={valor} onChange={e => { setValor(e.target.value); setValorTocado(true) }} /></div>
            <div><label className={LABEL}>Vence</label>
              <Input value={tipo === 'ANUAL' ? sumarUnAnio(fechaInicio) : 'Nunca (vitalicio)'} disabled readOnly /></div>
          </div>
          {cfgPrecio === 0 && (
            <p className="text-[11px] text-[#9A5500] mt-1.5">Este nivel no tiene precio en Configuración › Afiliaciones — se usará el valor que digites.</p>
          )}
          {nMascotas > 0 && valorNum > 0 && (
            <div className="mt-2 flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
              <span className="text-[12px] text-ink2">{nMascotas} mascota{nMascotas === 1 ? '' : 's'} × {fmt(valorNum)}</span>
              <span className="text-[15px] font-bold text-ink">Total {fmt(valorNum * nMascotas)}</span>
            </div>
          )}
          {previewCodigo && (
            <p className="text-[11px] text-ink3 mt-2">Nº de contrato: <span className="font-mono font-bold text-ink">{previewCodigo}</span>
              {nMascotas > 1 && <span> — uno solo para las {nMascotas} mascotas</span>}</p>
          )}
        </section>

        {/* Pago */}
        <section>
          <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">4 · Pago</h4>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={LABEL}>Método</label>
              <Select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select></div>
            <div><label className={LABEL}>Fecha de pago</label>
              <Input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} /></div>
            <div><label className={LABEL}>Comprobante</label>
              <input type="file" accept="image/*,application/pdf" className="text-[11px] w-full pt-1.5"
                onChange={e => setComprobanteFile(e.target.files?.[0] || null)} /></div>
          </div>
          <div className="mt-3"><label className={LABEL}>Notas</label>
            <Textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} /></div>
        </section>
      </div>
    </Modal>
  )
}

// ─── Ficha: mascotas cubiertas, cadena de contratos, comprobantes, PDF ───────
function ModalFicha({ afiliacion: a, config, especies, onClose, onRenovar, onActivar, onCancelar, onChanged }) {
  const { alert: showAlert } = useConfirm()
  const [subiendo, setSubiendo] = useState(null)   // id del contrato al que se le sube comprobante
  const [pdfGen, setPdfGen] = useState(null)
  const [enviandoWa, setEnviandoWa] = useState(null)
  const [enviandoEmail, setEnviandoEmail] = useState(null)
  const [emailPara, setEmailPara] = useState(null)  // id del contrato con el form de correo abierto
  const [emailDestino, setEmailDestino] = useState('')
  const [editMasc, setEditMasc] = useState(null)    // id de afiliacion_mascotas en edición
  const [formMasc, setFormMasc] = useState({ especie_id: '', peso_kg: '', edad: '' })
  const [guardandoMasc, setGuardandoMasc] = useState(false)
  const nc = NIVEL_COLORS[a.nivel] || {}
  const contratos = [...(a.afiliacion_contratos || [])].sort((x, y) => y.numero - x.numero)
  const mascotas = mascotasDe(a)
  const vivas = mascotas.filter(am => am.estado === 'VIGENTE')

  async function subirComprobante(contrato, file) {
    if (!file) return
    setSubiendo(contrato.id)
    try {
      const comp = await subirComprobanteAfiliacion(a.id, file)
      await db.from('afiliacion_contratos')
        .update({ comprobantes: [...(contrato.comprobantes || []), comp] })
        .eq('id', contrato.id)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error subiendo el comprobante' })
    } finally {
      setSubiendo(null)
    }
  }

  // Especie, peso y edad cambian (o llegaron vacíos en la importación) y los
  // tres van impresos en el contrato: se corrigen aquí, sobre la mascota (no
  // sobre la afiliación), que es de donde los lee el PDF.
  function abrirEdicionMascota(am) {
    if (editMasc === am.id) { setEditMasc(null); return }
    const m = am.mascotas
    const edad = edadALaFecha(m)
    setFormMasc({
      especie_id: m?.especie_id ? String(m.especie_id) : '',
      peso_kg: parseFloat(m?.peso_kg) > 0 ? String(m.peso_kg) : '',
      edad: edad == null ? '' : String(edad),
    })
    setEditMasc(am.id)
  }

  async function guardarDatosMascota(am) {
    const idMascota = am.mascotas?.id_mascota
    if (!idMascota) return
    setGuardandoMasc(true)
    try {
      const peso = parseFloat(formMasc.peso_kg)
      const anios = parseInt(formMasc.edad)
      // La edad se guarda con la fecha en que se declaró para que no se pudra:
      // la vigente = edad_anios + años transcurridos (migración 056).
      const cols = {
        // especie_id es integer: mandarlo como string lo rechaza la FK
        especie_id: parseInt(formMasc.especie_id) || null,
        peso_kg: Number.isFinite(peso) && peso > 0 ? peso : 0,
        ...(Number.isFinite(anios) && anios >= 0
          ? { edad_anios: anios, edad_declarada_en: today() }
          : { edad_anios: null, edad_declarada_en: null }),
      }
      const { error } = await db.from('mascotas').update(cols).eq('id_mascota', idMascota)
      if (error) throw error
      setEditMasc(null)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error guardando los datos de la mascota' })
    } finally {
      setGuardandoMasc(false)
    }
  }

  // Genera el PDF y lo deja en storage (upsert); devuelve doc + path para que
  // descargar/WA/email compartan la misma pieza y nunca envíen un PDF viejo.
  async function asegurarPdfEnStorage(contrato) {
    const doc = await generarContratoPdf({
      contrato, afiliacion: a, cliente: a.clientes,
      mascotas: mascotas.map(am => am.mascotas), config,
    })
    const nombre = `Contrato_${contrato.numero_contrato}.pdf`
    const blob = doc.output('blob')
    const path = `afiliaciones/${a.id}/${nombre}`
    await db.storage.from('evidencias').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (contrato.pdf_path !== path)
      await db.from('afiliacion_contratos').update({ pdf_path: path }).eq('id', contrato.id)
    return { doc, path, nombre }
  }

  async function pdfContrato(contrato) {
    setPdfGen(contrato.id)
    try {
      const { doc, nombre } = await asegurarPdfEnStorage(contrato)
      doc.save(nombre)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error generando el PDF' })
    } finally {
      setPdfGen(null)
    }
  }

  async function enviarPorWa(contrato) {
    if (!a.clientes?.whatsapp) {
      await showAlert('El cliente no tiene WhatsApp registrado.', { title: 'Sin número' })
      return
    }
    setEnviandoWa(contrato.id)
    // La ventana se abre ANTES de los await: si se abre después, el bloqueador
    // de popups del navegador se la come (mismo patrón de abrirArchivoStorage).
    const w = window.open('', '_blank')
    try {
      const { path } = await asegurarPdfEnStorage(contrato)
      const url = await urlFirmadaContrato(path)
      const link = waLink(a.clientes.whatsapp, mensajeContratoWa({ contrato, afiliacion: a, url }))
      if (w) w.location = link
      else window.open(link, '_blank', 'noopener')
      await db.from('afiliacion_contratos').update({ enviado_wa_at: new Date().toISOString() }).eq('id', contrato.id)
      await onChanged()
    } catch (e) {
      if (w) w.close()
      await showAlert(e.message, { title: 'Error enviando por WhatsApp' })
    } finally {
      setEnviandoWa(null)
    }
  }

  async function enviarPorEmail(contrato) {
    const destino = emailDestino.trim().toLowerCase()
    if (!destino) return
    setEnviandoEmail(contrato.id)
    try {
      const { path } = await asegurarPdfEnStorage(contrato)
      // Enlace corto: el backend solo lo usa para descargar el PDF ya mismo
      const url = await urlFirmadaContrato(path, 600)
      await orbitApi(`/afiliaciones/contratos/${contrato.id}/enviar-email`, {
        method: 'POST', body: { email: destino, signed_url: url },
      })
      // El correo digitado queda en la ficha del cliente para la próxima vez
      if (destino !== (a.clientes?.email || '').toLowerCase() && a.clientes?.id_cliente)
        await db.from('clientes').update({ email: destino }).eq('id_cliente', a.clientes.id_cliente)
      setEmailPara(null)
      await onChanged()
    } catch (e) {
      await showAlert(e.message, { title: 'Error enviando el correo' })
    } finally {
      setEnviandoEmail(null)
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl"
      title={<span>{a.clientes?.nombre} {a.clientes?.apellido} · {mascotas.length} mascota{mascotas.length === 1 ? '' : 's'}</span>}
      footer={<>
        {['VIGENTE','VENCIDA'].includes(a.estado) && (
          <Button variant="ghost" className="text-danger mr-auto" onClick={onCancelar}>Cancelar afiliación</Button>
        )}
        {a.tipo === 'ANUAL' && ['VIGENTE','VENCIDA'].includes(a.estado) && vivas.length > 0 && (
          <Button variant="secondary" onClick={onRenovar}><RotateCw size={13} /> Renovar</Button>
        )}
      </>}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ background: nc.bg, color: nc.text, borderColor: nc.border }}>{a.nivel}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-ink2">{a.tipo === 'VITALICIO' ? 'VITALICIO' : 'ANUAL'}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[a.estado] || ''}`}>{a.estado}</span>
        <span className="text-[11px] text-ink3">CC {a.clientes?.cedula_nit} · {a.clientes?.whatsapp}{a.clientes?.telefono ? ` · fijo ${a.clientes.telefono}` : ''}</span>
      </div>

      {/* Mascotas: cada una se activa por separado */}
      <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">Mascotas cubiertas</h4>
      <div className="space-y-1.5 mb-5">
        {mascotas.map(am => {
          const est = estadoMascota(a, am)
          const m = am.mascotas
          return (
            <div key={am.id} className="border rounded-xl px-3 py-2" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink text-[13px] truncate">
                    {petEmoji(m?.especies?.nombre)} {m?.nombre}
                    <span className="text-ink3 font-normal"> ({m?.especies?.nombre || 'sin especie'}{m?.raza ? ` · ${m.raza}` : ''})</span>
                  </div>
                  {datosMascotaTexto(m)
                    ? <div className="text-[11px] text-ink3">{datosMascotaTexto(m)}</div>
                    : <div className="text-[11px] text-[#9A5500] font-semibold">Sin peso ni edad registrados</div>}
                  {am.estado === 'ACTIVADA' && (
                    <div className="text-[10px] text-[#5B21B6] font-semibold">Activada el {am.fecha_activacion} — servicio prestado</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[est] || ''}`}>{est}</span>
                  <Button size="sm" variant="ghost" onClick={() => abrirEdicionMascota(am)}
                    title="Corregir especie, peso y edad de la mascota">
                    <Pencil size={11} /> Editar datos
                  </Button>
                  {['VIGENTE','VENCIDA'].includes(est) && (
                    <Button size="sm" variant="gold" onClick={() => onActivar(am)}>
                      <Rocket size={11} /> Activar
                    </Button>
                  )}
                </div>
              </div>
              {editMasc === am.id && (
                <form className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(30,80,40,0.10)' }}
                  onSubmit={e => { e.preventDefault(); guardarDatosMascota(am) }}>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className={LABEL}>Especie</label>
                      <Select className="w-36" value={formMasc.especie_id}
                        onChange={e => setFormMasc(p => ({ ...p, especie_id: e.target.value }))}>
                        <option value="">Sin especie</option>
                        {(especies || []).map(esp => <option key={esp.id} value={esp.id}>{esp.nombre}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className={LABEL}>Peso (kg)</label>
                      <Input type="number" min="0" step="0.1" className="w-24" autoFocus
                        value={formMasc.peso_kg}
                        onChange={e => setFormMasc(p => ({ ...p, peso_kg: e.target.value }))} />
                    </div>
                    <div>
                      <label className={LABEL}>Edad (años)</label>
                      <Input type="number" min="0" max="40" className="w-24"
                        value={formMasc.edad}
                        onChange={e => setFormMasc(p => ({ ...p, edad: e.target.value }))} />
                    </div>
                    <Button size="sm" type="submit" disabled={guardandoMasc}>
                      {guardandoMasc ? 'Guardando...' : 'Guardar'}
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditMasc(null)}>Cancelar</Button>
                  </div>
                  <p className="text-[10px] text-ink3 mt-1.5">
                    La edad se guarda como la que tiene <b>hoy</b> y de ahí en adelante envejece sola.
                    Para cambiar el nombre o la raza, ve a Gestión › Mascotas.
                    Vuelve a generar el PDF del contrato para que salga con estos datos.
                  </p>
                </form>
              )}
            </div>
          )
        })}
      </div>

      <h4 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">Contratos</h4>
      <div className="space-y-2">
        {contratos.map(c => (
          <div key={c.id} className="border rounded-xl px-3 py-2.5" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-mono font-bold text-ink text-[13px]">{c.numero_contrato}</div>
                <div className="text-[11px] text-ink3">
                  {c.numero === 0 ? (a.tipo === 'VITALICIO' ? 'Contrato vitalicio' : 'Contrato nuevo') : `Renovación Nº ${c.numero}`}
                  {' · '}{c.fecha_inicio}{c.fecha_vencimiento ? ` → ${c.fecha_vencimiento}` : ' → de por vida'}
                </div>
                <div className="text-[11px] text-ink2 font-semibold">
                  {fmt(totalContrato(c, mascotas.length))}
                  {mascotas.length > 1 && <span className="text-ink3 font-normal"> ({mascotas.length} × {fmt(c.valor)})</span>}
                  {c.metodo_pago ? ` · ${c.metodo_pago}` : ''}{c.fecha_pago ? ` · pagado ${c.fecha_pago}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {(c.comprobantes || []).map((comp, i) => (
                  <button key={i} onClick={() => abrirArchivoStorage(comp.storage_path, comp.bucket)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-surface2 text-ink2 hover:bg-surface3">
                    <Paperclip size={11} /> Comp. {i + 1}
                  </button>
                ))}
                <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-surface2 text-ink2 hover:bg-surface3 cursor-pointer">
                  <Paperclip size={11} /> {subiendo === c.id ? 'Subiendo...' : '+ Comprobante'}
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; subirComprobante(c, f) }} />
                </label>
                <Button size="sm" variant="ghost" onClick={() => pdfContrato(c)} disabled={pdfGen === c.id}>
                  <FileText size={12} /> {pdfGen === c.id ? '...' : 'PDF'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => enviarPorWa(c)}
                  disabled={enviandoWa === c.id} title="Compartir el PDF por WhatsApp (wa.me)">
                  <MessageCircle size={12} /> {enviandoWa === c.id ? '...' : 'WA'}
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => {
                    if (emailPara === c.id) { setEmailPara(null); return }
                    setEmailDestino(a.clientes?.email || '')
                    setEmailPara(c.id)
                  }}
                  title="Enviar el PDF adjunto por correo">
                  <Mail size={12} /> Correo
                </Button>
              </div>
            </div>
            {emailPara === c.id && (
              <form className="flex items-center gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'rgba(30,80,40,0.10)' }}
                onSubmit={e => { e.preventDefault(); enviarPorEmail(c) }}>
                <Input type="email" required placeholder="correo@delcliente.com" className="flex-1"
                  value={emailDestino} onChange={e => setEmailDestino(e.target.value)} autoFocus />
                <Button size="sm" type="submit" disabled={enviandoEmail === c.id || !emailDestino.trim()}>
                  {enviandoEmail === c.id ? 'Enviando...' : 'Enviar'}
                </Button>
              </form>
            )}
            {(c.enviado_wa_at || c.enviado_email_at) && (
              <div className="text-[10px] text-ink3 mt-1.5">
                {c.enviado_wa_at && <>Compartido por WhatsApp el {new Date(c.enviado_wa_at).toLocaleDateString('es-CO')}</>}
                {c.enviado_wa_at && c.enviado_email_at && ' · '}
                {c.enviado_email_at && <>Enviado a {c.enviado_email_a} el {new Date(c.enviado_email_at).toLocaleDateString('es-CO')}</>}
              </div>
            )}
          </div>
        ))}
        {contratos.length === 0 && <p className="text-[12px] text-ink3">Sin contratos — esto no debería pasar.</p>}
      </div>

      {a.notas && <p className="text-[12px] text-ink3 mt-4"><span className="font-bold">Notas:</span> {a.notas}</p>}
    </Modal>
  )
}

// ─── Renovar (solo ANUAL): contrato N+1 con continuidad desde el vencimiento ─
function ModalRenovar({ afiliacion: a, config, personalData, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const ct = contratoVigente(a)
  const numero = (ct?.numero ?? 0) + 1
  // Continuidad: la renovación arranca donde venció la anterior (no se pierden
  // días por renovar antes; renovar dentro de la gracia conserva el aniversario).
  const inicio = ct?.fecha_vencimiento || today()
  const precioCfg = parseFloat(config?.precios?.ANUAL?.[a.nivel]) || 0
  // Solo se renueva por las mascotas que siguen cubiertas: las ya activadas
  // (fallecidas) no vuelven a pagar.
  const vivas = mascotasDe(a).filter(am => am.estado === 'VIGENTE')

  const [valor, setValor] = useState(precioCfg > 0 ? String(precioCfg) : String(ct?.valor || ''))
  const [metodoPago, setMetodoPago] = useState('EFECTIVO')
  const [fechaPago, setFechaPago] = useState(today())
  const [comprobanteFile, setComprobanteFile] = useState(null)
  const [saving, setSaving] = useState(false)

  const valorNum = parseFloat(valor) || 0
  const numeroContrato = generarNumeroContrato({
    fechaInicio: ct?.fecha_inicio || inicio,   // el código conserva la fecha de LA AFILIACIÓN original
    cliente: a.clientes, nivel: a.nivel, tipo: a.tipo, numero,
  })

  async function guardar() {
    setSaving(true)
    try {
      const comprobantes = []
      if (comprobanteFile) comprobantes.push(await subirComprobanteAfiliacion(a.id, comprobanteFile))
      const { error } = await db.from('afiliacion_contratos').insert({
        afiliacion_id: a.id, numero, numero_contrato: numeroContrato,
        fecha_inicio: inicio, fecha_vencimiento: sumarUnAnio(inicio),
        valor: valorNum, metodo_pago: metodoPago, fecha_pago: fechaPago || null,
        comprobantes, creado_por: personalData?.id || null,
      })
      if (error) throw error
      // Desde la primera renovación la cláusula queda suspendida y vuelve a VIGENTE
      await db.from('afiliaciones').update({ estado: 'VIGENTE' }).eq('id', a.id)
      await onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo renovar' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Renovar afiliación — ${a.clientes?.nombre} ${a.clientes?.apellido || ''}`} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !(valorNum > 0)}>{saving ? 'Guardando...' : 'Renovar'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="bg-surface2 rounded-lg px-3 py-2 text-[12px] text-ink2">
          Renovación <strong>Nº {numero}</strong> · vigencia <strong>{inicio} → {sumarUnAnio(inicio)}</strong><br />
          Nº de contrato: <span className="font-mono font-bold text-ink">{numeroContrato}</span><br />
          <span className="text-primary-dark font-semibold">Al renovar se suspenden las cláusulas del primer año.</span>
        </div>

        <div>
          <div className={LABEL}>Se renueva por {vivas.length} mascota{vivas.length === 1 ? '' : 's'}</div>
          <div className="flex flex-wrap gap-1.5">
            {vivas.map(am => (
              <span key={am.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-green-light text-primary-dark">
                {petEmoji(am.mascotas?.especies?.nombre)} {am.mascotas?.nombre}
              </span>
            ))}
          </div>
          {mascotasDe(a).length > vivas.length && (
            <p className="text-[10px] text-ink3 mt-1">
              Las mascotas ya activadas no se renuevan ni se cobran.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Valor por mascota {precioCfg > 0 ? '' : '(sin precio en Config)'}</label>
            <Input type="number" min="0" value={valor} onChange={e => setValor(e.target.value)} /></div>
          <div><label className={LABEL}>Método de pago</label>
            <Select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select></div>
          <div><label className={LABEL}>Fecha de pago</label>
            <Input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} /></div>
          <div><label className={LABEL}>Comprobante</label>
            <input type="file" accept="image/*,application/pdf" className="text-[11px] w-full pt-1.5"
              onChange={e => setComprobanteFile(e.target.files?.[0] || null)} /></div>
        </div>

        {valorNum > 0 && (
          <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
            <span className="text-[12px] text-ink2">{vivas.length} × {fmt(valorNum)}</span>
            <span className="text-[15px] font-bold text-ink">Total {fmt(valorNum * vivas.length)}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Activar (falleció): cobro por cláusula + plan de servicio equivalente ───
// Activa UNA mascota: las hermanas del mismo contrato siguen cubiertas.
function ModalActivar({ afiliacion: a, am, config, planes, onClose, onConfirm }) {
  const ct = contratoVigente(a)
  const { cobro, motivo } = calcularCobroActivacion({ afiliacion: a, contratoVigente: ct, config })
  const hermanas = mascotasDe(a).filter(x => x.id !== am.id && x.estado === 'VIGENTE')

  const planPorCodigo = codigo => planes.find(p => p.codigo === codigo)
  const planFijo = a.nivel !== 'ORO' ? planPorCodigo(config?.plan_equivalente?.[a.nivel]) : null
  const oroOpciones = (config?.oro_opciones || []).map(planPorCodigo).filter(Boolean)
  const [planElegido, setPlanElegido] = useState(planFijo || null)

  return (
    <Modal open onClose={onClose} title={`Activar afiliación — ${am.mascotas?.nombre}`} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="gold" disabled={!planElegido}
          onClick={() => onConfirm({ plan: planElegido, cobro, motivo })}>
          <Rocket size={13} /> Continuar al registro
        </Button>
      </>}>
      <div className="space-y-4">
        <div className={`rounded-xl px-4 py-3 ${cobro > 0 ? 'bg-[#FFF3DC]' : 'bg-green-light'}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-0.5" style={{ color: cobro > 0 ? '#9A5500' : '#1D8A55' }}>
            Cobro del servicio
          </div>
          <div className="text-[20px] font-bold" style={{ color: cobro > 0 ? '#9A5500' : '#1D8A55' }}>
            {cobro > 0 ? fmt(cobro) : 'Cubierto — $0'}
          </div>
          <div className="text-[11px] text-ink2 mt-0.5">{motivo}</div>
          <div className="text-[10px] text-ink3 mt-1">El transporte fuera de Bogotá se suma en el registro según la tarifa del municipio.</div>
        </div>

        {hermanas.length > 0 && (
          <div className="rounded-xl bg-surface2 px-3 py-2 text-[11px] text-ink2">
            Se activa <strong>solo {am.mascotas?.nombre}</strong>. El contrato {ct?.numero_contrato} sigue cubriendo
            a {hermanas.map(x => x.mascotas?.nombre).join(', ')}.
          </div>
        )}

        {a.nivel === 'ORO' ? (
          <div>
            <div className={LABEL}>El plan ORO elige su servicio:</div>
            <div className="grid grid-cols-1 gap-1.5">
              {oroOpciones.map(p => (
                <button key={p.id} onClick={() => setPlanElegido(p)}
                  className={`px-3 py-2 rounded-xl border-2 text-left text-[13px] font-semibold transition-all ${planElegido?.id === p.id ? 'border-primary-dark bg-green-light text-ink' : 'border-transparent bg-surface2 text-ink2 hover:bg-surface3'}`}>
                  {p.nombre}
                </button>
              ))}
              {oroOpciones.length === 0 && <p className="text-[12px] text-danger">No se encontraron los planes ORO en el catálogo — revisar Configuración.</p>}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink2">
            Plan de servicio: <strong>{planFijo?.nombre || `No encontrado (${config?.plan_equivalente?.[a.nivel] || '—'})`}</strong>
          </p>
        )}

        <p className="text-[11px] text-ink3">
          Se abrirá el registro con el cliente, la mascota y el plan precargados. La mascota quedará
          ACTIVADA solo cuando el servicio se cree (si cancelas el registro, no pasa nada).
        </p>
      </div>
    </Modal>
  )
}
