import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { db } from '@/lib/supabase'
import { compressImage, sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'
import { portalDatos, portalRecibir } from '@/lib/imagenes'
import { Camera, Check, ChevronLeft, Loader2, Send, X, Plus, Gift } from 'lucide-react'

const G      = '#1A5CD8'
const G_LITE = '#E8F3EB'
const G_MID  = '#C5DEC9'
const BG     = '#F4F7F4'
const BORD   = '#D8E5D8'
// Rojo del "no, gracias": rechazar es una decisión y debe SENTIRSE tomada. Con
// el gris de antes el cliente no distinguía "dije que no" de "no he respondido".
const R      = '#DC2626'
const R_LITE = '#FEF2F2'
const R_MID  = '#FCA5A5'

const MIMES_OK = MIMES_IMAGEN_OK

const pesos = v => `$${Number(v || 0).toLocaleString('es-CO')}`

// Límite de palabras por tipo de campo de texto (evita leyendas larguísimas).
// Devuelve 0 si el campo no tiene límite.
const maxPalabrasCampo = label => {
  const l = (label || '').toLowerCase()
  if (l.includes('dedicatoria')) return 25
  if (l.includes('frase'))       return 30
  return 0
}
const contarPalabras  = s => (s || '').trim() ? s.trim().split(/\s+/).length : 0
const limitarPalabras = (s, max) => {
  const palabras = (s || '').split(/\s+/).filter(Boolean)
  return palabras.length <= max ? s : palabras.slice(0, max).join(' ')
}

const slide = {
  enter:  d => ({ x: d > 0 ? '60%' : '-60%', opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 34 } },
  exit:   d => ({ x: d > 0 ? '-60%' : '60%', opacity: 0, transition: { duration: 0.2 } }),
}

/** ¿Un recordatorio tiene ya todo lo que pide (fotos + textos)? */
function recListo(rec, files, textosVals) {
  const maxF = (rec?.requiere_imagen && !rec?.solo_nombre && (rec?.max_fotos || 0) > 0) ? rec.max_fotos : 0
  if (maxF > 0 && (files || []).filter(Boolean).length < maxF) return false
  for (const c of (rec?.campos_texto || [])) {
    const arr = textosVals?.[c.label] || []
    if (arr.filter(v => v && String(v).trim()).length < (c.cantidad || 1)) return false
  }
  return true
}

function itemListo(item, fotos, textos) {
  return recListo(item.recordatorios, fotos[item.id], textos[item.id])
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FotosCliente({ codigo: codigoProp }) {
  const [fase,        setFase]       = useState(codigoProp ? 'cargando' : 'entrada')
  const [cInput,      setCInput]     = useState(codigoProp || '')
  const [codigo,      setCodigo]     = useState((codigoProp || '').toUpperCase())
  const [servicio,    setServicio]   = useState(null)
  const [items,       setItems]      = useState([])
  const [fotos,       setFotos]      = useState({})
  const [textos,      setTextos]     = useState({})
  const [comentarios, setComentarios]= useState('')
  const [entrega,     setEntrega]    = useState({ direccion: '', barrio: '', localidad: '', recibe: '', telefono: '', telefono_adicional: '', horarios: '' })
  const [anticipados, setAnticipados]= useState(null)
  const [interes,     setInteres]    = useState({ quiere: false, recordatorio_id: '', texto: '' })
  const [catalogo,    setCatalogo]   = useState([])
  const [limites,     setLimites]    = useState({ max_mb: 8, mimes: MIMES_OK })
  const [guardando,   setGuardando]  = useState(false)
  const [paso,        setPaso]       = useState(0)
  const [dir,         setDir]        = useState(1)
  const [declinados,  setDeclinados] = useState(() => new Set()) // ids de recordatorios "no deseo"
  // ── Ofertas del portal (las que manda el backend; hoy hasta 2) ──
  // Todo va indexado por id de oferta: el cliente responde cada anuncio por
  // separado y puede aceptar uno, los dos, o ninguno.
  const [ofertas,       setOfertas]      = useState([])
  const [ofertaResp,    setOfertaResp]   = useState({})     // { [id]: true|false } · sin clave = sin responder
  const [ofertaFotos,   setOfertaFotos]  = useState({})     // { [id]: [File|null] }
  const [ofertaTextos,  setOfertaTextos] = useState({})     // { [id]: { label: [...] } }
  const [confirmando,   setConfirmando]  = useState(false)  // secuencia de confirmaciones finales

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  // Cada anuncio es un paso propio del wizard, entre los recordatorios y la
  // revisión final: así el cliente los ve con calma y no como un banner al paso.
  // Van uno tras otro a partir de `items.length`.
  const totalPasos   = items.length + ofertas.length + 1
  const esFinal      = paso === totalPasos - 1
  const ofertaIdx    = paso - items.length
  const ofertaActual = (ofertaIdx >= 0 && ofertaIdx < ofertas.length) ? ofertas[ofertaIdx] : null
  const enOferta     = !!ofertaActual
  const itemActual   = paso < items.length ? items[paso] : null
  const pasoDeOferta = of => items.length + ofertas.findIndex(o => o.id === of.id)
  // La pregunta de "recordatorios anticipados" SOLO aplica a compostaje INDIVIDUAL.
  // En eco-grupal (COMPOSTAJE_GRUPAL) el proceso es por lote y no se pregunta.
  const esCompostajeIndividual = (servicio?.tipo_proceso || '') === 'COMPOSTAJE_INDIVIDUAL'
  // Solo pedimos datos de entrega si hay algo físico que entregar (no en eco-grupal).
  // Aceptar una oferta física convierte en entregable un servicio que no lo era:
  // el backend aplica la misma regla al recibir.
  // Basta con que UNA de las aceptadas sea física.
  const pedirEntrega = servicio?.tiene_entrega_fisica !== false ||
                       ofertas.some(of => ofertaResp[of.id] === true && of.es_fisico)
  // Cuando aplica, los datos esenciales son obligatorios para enviar.
  const CAMPOS_ENTREGA_REQ = ['direccion', 'recibe', 'telefono']
  const entregaReqOk = !pedirEntrega || CAMPOS_ENTREGA_REQ.every(k => String(entrega[k] || '').trim())
  const mascota      = servicio?.mascota || 'tu mascota'
  // Un recordatorio declinado ("no deseo") cuenta como resuelto: no exige fotos.
  const todoListo    = items.every(it => declinados.has(it.id) || itemListo(it, fotos, textos))
  // Una oferta está resuelta si dijo que no, o si dijo que sí y ya subió lo suyo.
  function ofertaResuelta(of) {
    const r = ofertaResp[of.id]
    if (r === false) return true
    if (r === true)  return recListo(of.recordatorio, ofertaFotos[of.id] || [], ofertaTextos[of.id] || {})
    return false
  }
  const ofertasListas   = ofertas.every(ofertaResuelta)
  const faltaResponder  = ofertas.some(of => ofertaResp[of.id] == null)
  const ofertaActualListo = !ofertaActual || ofertaResuelta(ofertaActual)
  const respActual      = ofertaActual ? ofertaResp[ofertaActual.id] : undefined
  // El recordatorio actual queda "resuelto" si subió la(s) foto(s)/datos o si lo declinó.
  const itemActualListo = !itemActual || declinados.has(itemActual.id) || itemListo(itemActual, fotos, textos)
  const puedeEnviar  = todoListo && ofertasListas && entregaReqOk

  // ¿El anuncio vende algo que el cliente YA lleva en su plan? Se le ofrece
  // igual (es "un recuerdo más"), pero conviene decírselo para que no crea que
  // le estamos pidiendo dos veces la misma foto.
  const ofertaRepetida = of =>
    items.some(it => String(it.recordatorios?.id) === String(of.recordatorio?.id))

  // Responder un anuncio. Al aceptar se inicializa su captura de fotos.
  function responderOferta(of, v) {
    setOfertaResp(p => ({ ...p, [of.id]: v }))
    if (v) setOfertaFotos(p => (p[of.id]?.length ? p : { ...p, [of.id]: iniFotos(of.recordatorio) }))
  }

  // "Sí lo quiero" tras haber dicho que no: se acepta y se lleva al cliente
  // directo a subir lo que ese recordatorio necesita. Volver a pedirle que
  // pulse "Sí, lo quiero" otra vez en el anuncio sería un paso de más justo
  // cuando ya decidió comprar.
  function quiereOferta(of) {
    responderOferta(of, true)
    ir(pasoDeOferta(of))
  }

  function toggleDeclinado(id, v) {
    setDeclinados(prev => { const n = new Set(prev); v ? n.add(id) : n.delete(id); return n })
  }

  function ir(n) { setDir(n > paso ? 1 : -1); setPaso(n) }
  function siguiente() { if (paso < totalPasos - 1) ir(paso + 1) }
  function anterior()  { if (paso > 0) ir(paso - 1) }

  // ── Carga (curada por el backend; el cliente solo ve lo que le corresponde) ──
  async function buscar() {
    const cod = cInput.trim().toUpperCase()
    if (!cod) return
    setCodigo(cod); setFase('cargando'); await cargar(cod)
  }

  async function cargar(cod) {
    try {
      const codU = (cod || '').trim().toUpperCase()
      setCodigo(codU)
      const r = await portalDatos(codU)
      if (r.status === 404 || !r.ok) { setFase('no_encontrado'); return }
      // tiene_entrega_fisica: si el backend no lo manda (versión vieja), asumimos true.
      setServicio({ ...r.servicio, tiene_entrega_fisica: r.tiene_entrega_fisica !== false })
      if (r.ya_recibido) { setFase('ya_procesado'); return }
      if (r.fuera_de_ventana) { setFase('fuera_ventana'); return }
      setLimites({ max_mb: r.limites?.max_mb || 8, mimes: r.limites?.mimes || MIMES_OK })

      // El backend devuelve cada ítem como { sr_id, recordatorio }; el portal usa
      // { id, recordatorios }. Normalizamos para que coincidan (si no, no aparece
      // la UI de carga y el envío iría con sr_id indefinido).
      const it = (r.items || []).map(x => ({ ...x, id: x.sr_id, recordatorios: x.recordatorio }))
      setItems(it)
      setDeclinados(new Set())

      // Ofertas (pueden no venir: backend viejo, o ninguna aplica a este plan).
      // `oferta` singular es la forma vieja del backend — se acepta por si el
      // portal se despliega antes que el contenedor.
      const ofs = Array.isArray(r.ofertas) ? r.ofertas : (r.oferta ? [r.oferta] : [])
      setOfertas(ofs)
      setOfertaResp({})
      setOfertaFotos({})
      setOfertaTextos(Object.fromEntries(ofs.map(of => [of.id, iniTextos(of.recordatorio)])))

      const fi = {}
      it.forEach(item => {
        const rec = item.recordatorios
        if (rec?.requiere_imagen !== false && (rec?.max_fotos || 0) > 0)
          fi[item.id] = Array(rec.max_fotos).fill(null)
      })
      setFotos(fi)

      const ti = {}
      it.forEach(item => {
        const campos = item.recordatorios?.campos_texto || []
        if (campos.length > 0) {
          ti[item.id] = {}
          campos.forEach(c => { ti[item.id][c.label] = Array(c.cantidad || 1).fill('') })
        }
      })
      setTextos(ti)

      // Catálogo para "quiero info de un adicional" (recordatorios es catálogo público)
      const { data: recs } = await db.from('recordatorios')
        .select('id,nombre,precio_base').eq('activo', true).order('nombre')
      setCatalogo(recs || [])
      setFase('form'); setPaso(0)
    } catch (e) {
      console.error(e); setFase('no_encontrado')
    }
  }

  // ── Subida segura de una imagen ─────────────────────────────────────────────
  // `carpeta` es el 2º segmento de la ruta (sr_id, o `oferta-<id>` cuando el
  // recordatorio todavía no existe porque lo crea el backend al recibir).
  async function subirArchivo(carpeta, file) {
    const mime = await sniffMime(file)
    if (!MIMES_OK.includes(mime))
      throw new Error('Ese archivo no es una foto válida. Usa una imagen (JPG, PNG, WEBP o HEIC).')
    const blob = await compressImage(file)          // re-encoda a JPEG cuando puede (sanitiza)
    const maxBytes = (limites.max_mb || 8) * 1024 * 1024
    if (blob.size > maxBytes)
      throw new Error(`La imagen supera ${limites.max_mb} MB. Intenta con otra foto.`)
    const ext  = extDeMime(blob.type === 'image/jpeg' ? 'image/jpeg' : mime)
    const path = `${servicio.id}/${carpeta}/${crypto.randomUUID()}.${ext}`   // único → no sobrescribe
    const { error } = await db.storage.from('fotos-clientes')
      .upload(path, blob, { upsert: false, contentType: blob.type || mime })
    if (error) {
      // El mensaje al cliente es genérico, pero dejamos el error real en consola:
      // sin esto, un rechazo de RLS (p.ej. estado del servicio fuera de la ventana
      // permitida en la política del bucket) es indistinguible de un fallo de red.
      console.error('[FotosCliente] upload falló:', error?.message || error, { path, estado: servicio?.estado })
      throw new Error('No se pudo subir una imagen. Revisa tu conexión e intenta de nuevo.')
    }
    const { data: { publicUrl } } = db.storage.from('fotos-clientes').getPublicUrl(path)
    return publicUrl
  }

  // ── Guardar (transaccional en el backend; el navegador no cambia estados) ───
  async function guardar() {
    if (!puedeEnviar) return
    setConfirmando(false)
    setGuardando(true)
    try {
      const recordatorios = []
      for (const item of items) {
        if (declinados.has(item.id)) continue   // declinado: no se suben fotos
        const files = (fotos[item.id] || []).filter(Boolean)
        const urls  = []
        for (const f of files) urls.push(await subirArchivo(item.id, f))
        recordatorios.push({ sr_id: item.id, urls, textos: textos[item.id] || {} })
      }

      // Ofertas: el navegador solo dice SÍ o NO en cada una. El precio y el ítem
      // los resuelve el backend contra la tabla `ofertas` — aquí nunca viaja un
      // monto.
      const ofertasPayload = []
      for (const of of ofertas) {
        const resp = ofertaResp[of.id]
        if (resp == null) continue
        const urlsOferta = []
        if (resp === true) {
          for (const f of (ofertaFotos[of.id] || []).filter(Boolean))
            urlsOferta.push(await subirArchivo(`oferta-${of.id}`, f))
        }
        ofertasPayload.push({
          oferta_id: of.id,
          acepta:    resp === true,
          urls:      urlsOferta,
          textos:    resp === true ? (ofertaTextos[of.id] || {}) : {},
        })
      }

      const entregaLlena = Object.values(entrega).some(v => String(v).trim())
      const payload = {
        recordatorios,
        declinados: [...declinados],
        comentarios: comentarios.trim() || null,
        anticipados: esCompostajeIndividual ? anticipados : undefined,
        adicional_interes: interes.quiere ? { recordatorio_id: interes.recordatorio_id || null, texto: interes.texto.trim() || null } : null,
        entrega: entregaLlena ? entrega : undefined,
        ofertas: ofertasPayload.length ? ofertasPayload : undefined,
        // Compat: un backend viejo solo entiende `oferta` (singular). El nuevo
        // ignora esta clave cuando `ofertas` viene como array, así que mandar
        // ambas hace que el orden de despliegue no importe.
        oferta: ofertasPayload[0],
      }
      const r = await portalRecibir(codigo, payload)
      if (r.ok || r.ya_recibido) { setFase('enviado'); return }
      if (r.error === 'incompleto')
        throw new Error('Faltan imágenes o datos: ' + (r.faltantes || []).join(', '))
      if (r.error === 'entrega_incompleta')
        throw new Error('Por favor completa los datos de entrega: dirección, quién recibe y teléfono.')
      if (r.error === 'ya_procesado') { setFase('ya_procesado'); return }
      if (r.error === 'fuera_de_ventana') { setFase('fuera_ventana'); return }
      // `ref` lo genera el backend y queda en su log junto al error real: es lo
      // único que permite diagnosticar un fallo del portal sin adivinar.
      console.error('[FotosCliente] guardar falló:', r)
      throw new Error((r.error || 'No se pudo guardar') + (r.ref ? ` (ref ${r.ref})` : ''))
    } catch (e) {
      alert('Ocurrió un error. Intenta de nuevo.\n\n' + e.message +
            '\n\nSi vuelve a fallar, escríbenos por WhatsApp con este mensaje.')
    } finally { setGuardando(false) }
  }

  // ── Pantallas estáticas ───────────────────────────────────────────────────
  if (fase === 'entrada') return <EntradaScreen cInput={cInput} setCInput={setCInput} onBuscar={buscar} />
  if (fase === 'cargando') return (
    <Centrado>
      <Loader2 size={44} className="animate-spin" style={{ color: G }} />
      <p className="text-[16px] text-gray-500 mt-5 font-medium">Buscando tu servicio…</p>
    </Centrado>
  )
  if (fase === 'no_encontrado') return (
    <PantallaInfo emoji="❓" titulo="Código no encontrado"
      texto="Por favor verifica el código que te enviamos por WhatsApp e intenta de nuevo."
      cta={{ label: 'Volver a intentar', fn: () => { setFase('entrada'); setCInput('') } }} />
  )
  if (fase === 'ya_procesado') return (
    <PantallaInfo emoji="✅" titulo="¡Ya recibimos todo!"
      texto={`Las fotos de ${mascota} ya están registradas. Nuestro equipo está trabajando con mucho cariño.`} />
  )
  if (fase === 'fuera_ventana') return (
    <PantallaInfo emoji="💬" titulo="Escríbenos para tus fotos"
      texto={`El servicio de ${mascota} ya avanzó de etapa. Para ayudarte con las fotos de sus recordatorios, por favor escríbenos por WhatsApp y con gusto lo resolvemos.`}
      cta={{ label: 'Escribir por WhatsApp', fn: () => { window.location.href = 'https://wa.me/573159891247' } }} />
  )
  if (fase === 'enviado') return <PantallaEnviado mascota={mascota} />

  // ── WIZARD ────────────────────────────────────────────────────────────────
  const pasosVisibles = items.length + ofertas.length
  return (
    <div className="min-h-screen flex flex-col" style={{ background: BG }}>
      <header className="sticky top-0 z-20 bg-white shadow-sm border-b" style={{ borderColor: BORD }}>
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: G }}>🌿</div>
            <div>
              <p className="text-[16px] font-bold text-gray-900 leading-none">{mascota}</p>
              <p className="text-[12px] text-gray-500 mt-0.5">{servicio?.plan}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: G_LITE }}>
              <motion.div className="h-full rounded-full" style={{ background: G }}
                animate={{ width: `${totalPasos > 1 ? Math.round((paso / (totalPasos - 1)) * 100) : 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28 }} />
            </div>
            <span className="text-[13px] font-bold whitespace-nowrap flex-shrink-0" style={{ color: G }}>
              {esFinal ? 'Revisión final' : `Paso ${paso + 1} de ${pasosVisibles}`}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div key={paso} custom={dir}
            variants={slide} initial="enter" animate="center" exit="exit"
            className="absolute inset-0 overflow-y-auto">
            <div className="max-w-lg mx-auto px-5 pt-7 pb-40">
              {itemActual && (
                <PasoItem
                  item={itemActual}
                  mascota={mascota}
                  files={fotos[itemActual.id] || []}
                  textosVals={textos[itemActual.id] || {}}
                  onFilesChange={f => setFotos(p => ({ ...p, [itemActual.id]: f }))}
                  onTextosChange={v => setTextos(p => ({ ...p, [itemActual.id]: v }))}
                  declined={declinados.has(itemActual.id)}
                  onToggleDeclined={v => toggleDeclinado(itemActual.id, v)}
                />
              )}
              {ofertaActual && (
                <PasoOferta
                  key={ofertaActual.id}
                  oferta={ofertaActual}
                  mascota={mascota}
                  acepta={respActual ?? null}
                  orden={ofertas.length > 1 ? { i: ofertaIdx + 1, total: ofertas.length } : null}
                  yaLoTiene={ofertaRepetida(ofertaActual)}
                  onResponder={v => responderOferta(ofertaActual, v)}
                  files={ofertaFotos[ofertaActual.id] || []}
                  textosVals={ofertaTextos[ofertaActual.id] || {}}
                  onFilesChange={f => setOfertaFotos(p => ({ ...p, [ofertaActual.id]: f }))}
                  onTextosChange={v => setOfertaTextos(p => ({ ...p, [ofertaActual.id]: v }))}
                />
              )}
              {esFinal && (
                <PasoFinal
                  mascota={mascota}
                  items={items} fotos={fotos} textos={textos} declinados={declinados}
                  catalogo={catalogo} interes={interes} setInteres={setInteres}
                  esCompostaje={esCompostajeIndividual}
                  anticipados={anticipados} setAnticipados={setAnticipados}
                  comentarios={comentarios} setComentarios={setComentarios}
                  entrega={entrega} setEntrega={setEntrega} pedirEntrega={pedirEntrega}
                  ofertas={ofertas} ofertaResp={ofertaResp}
                  onIrOferta={of => ir(pasoDeOferta(of))}
                  onQuiereOferta={of => quiereOferta(of)}
                  onGoTo={ir}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="sticky bottom-0 z-20 bg-white border-t shadow-lg px-5 py-4" style={{ borderColor: BORD }}>
        <div className="max-w-lg mx-auto space-y-3">
          {esFinal ? (
            <>
              {!puedeEnviar && (
                <p className="text-center text-[13px] font-medium" style={{ color: '#B45309' }}>
                  {!todoListo
                    ? 'Completa todas las fotos y datos requeridos para poder enviar.'
                    : !ofertasListas
                      ? (faltaResponder
                          ? `Responde si deseas ${ofertas.length > 1 ? 'las ofertas' : 'la oferta'} para poder enviar.`
                          : 'Falta subir la foto del recordatorio que aceptaste.')
                      : 'Completa los datos de entrega (dirección, quién recibe y teléfono) para enviar.'}
                </p>
              )}
              <motion.button onClick={() => setConfirmando(true)} disabled={guardando || !puedeEnviar} whileTap={{ scale: 0.98 }}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-white text-[17px] transition-opacity disabled:opacity-50"
                style={{ background: G }}>
                {guardando
                  ? <><Loader2 size={20} className="animate-spin" /> Enviando las fotos…</>
                  : <><Send size={18} /> Enviar fotos a Camino al Cielo</>}
              </motion.button>
            </>
          ) : (
            <>
              {enOferta ? (
                respActual == null ? (
                  <p className="text-center text-[13px] font-medium" style={{ color: '#B45309' }}>
                    Elige si deseas esta oferta para continuar.
                  </p>
                ) : !ofertaActualListo && (
                  <p className="text-center text-[13px] font-medium" style={{ color: '#B45309' }}>
                    Sube la foto de tu nuevo recordatorio para continuar.
                  </p>
                )
              ) : !itemActualListo && (
                <p className="text-center text-[13px] font-medium" style={{ color: '#B45309' }}>
                  Sube la foto o marca "No deseo este recordatorio" para continuar.
                </p>
              )}
              <motion.button onClick={siguiente}
                disabled={enOferta ? (respActual == null || !ofertaActualListo) : !itemActualListo}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-white text-[17px] transition-opacity disabled:opacity-50"
                style={{ background: G }}>
                {paso === pasosVisibles - 1
                  ? 'Revisar y enviar →'
                  : (paso + 1 >= items.length ? 'Siguiente →' : 'Siguiente recordatorio →')}
              </motion.button>
            </>
          )}
          {paso > 0 && (
            <button onClick={anterior}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-[15px] border-2 transition-all"
              style={{ borderColor: BORD, color: '#6B7280', background: 'white' }}>
              <ChevronLeft size={18} /> Volver al anterior
            </button>
          )}
        </div>
      </div>

      {confirmando && (
        <ConfirmacionesEnvio
          mascota={mascota}
          items={items} fotos={fotos} declinados={declinados}
          entrega={entrega} pedirEntrega={pedirEntrega}
          ofertas={ofertas} ofertaResp={ofertaResp}
          onCancelar={() => setConfirmando(false)}
          onCorregirEntrega={() => { setConfirmando(false); ir(totalPasos - 1) }}
          onQuieroOferta={of => { setConfirmando(false); quiereOferta(of) }}
          onConfirmado={guardar}
        />
      )}
    </div>
  )
}

// Estructuras iniciales de captura para un recordatorio del catálogo
function iniFotos(rec) {
  const max = (rec?.requiere_imagen !== false && (rec?.max_fotos || 0) > 0) ? rec.max_fotos : 0
  return Array(max).fill(null)
}
function iniTextos(rec) {
  const out = {}
  for (const c of (rec?.campos_texto || [])) out[c.label] = Array(c.cantidad || 1).fill('')
  return out
}

// ── Captura reutilizable: fotos + campos de texto de UN recordatorio ─────────
// La usan el paso de recordatorio del plan y el paso de oferta aceptada, para
// que el cliente vea exactamente la misma mecánica en ambos.
function CapturaRecordatorio({ rec, mascota, files, textosVals, onFilesChange, onTextosChange }) {
  const maxFotos = (rec?.requiere_imagen !== false && (rec?.max_fotos || 0) > 0) ? rec.max_fotos : 0
  const campos   = rec?.campos_texto || []
  const arreglo  = Array.from({ length: maxFotos }, (_, i) => files?.[i] ?? null)
  const filled   = arreglo.filter(Boolean).length
  const allDone  = maxFotos > 0 && filled === maxFotos
  const singleRef = useRef(null)
  const multiRef  = useRef(null)

  function setFile(idx, file) { const n = [...arreglo]; n[idx] = file; onFilesChange(n) }
  function onMulti(e) {
    const sel  = Array.from(e.target.files || []).slice(0, maxFotos)
    const next = [...arreglo]; let slot = 0
    for (const f of sel) { while (slot < maxFotos && next[slot] !== null) slot++; if (slot < maxFotos) { next[slot] = f; slot++ } }
    onFilesChange(next); e.target.value = ''
  }
  function setTexto(label, idx, val) {
    const c   = campos.find(c => c.label === label)
    const arr = [...(textosVals[label] || Array(c?.cantidad || 1).fill(''))]
    arr[idx]  = val
    onTextosChange({ ...textosVals, [label]: arr })
  }

  return (
    <>
      {maxFotos > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {Array.from({ length: maxFotos }).map((_, i) => (
              <div key={i} className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all"
                style={{ background: arreglo[i] ? G : 'white', borderColor: arreglo[i] ? G : BORD }}>
                {arreglo[i] && <Check size={9} color="#fff" strokeWidth={3} />}
              </div>
            ))}
          </div>
          <span className="text-[13px] font-semibold" style={{ color: allDone ? G : '#9CA3AF' }}>
            {allDone ? '✓ Fotos listas' : `${filled} de ${maxFotos} foto${maxFotos > 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {maxFotos > 0 && (
        <div className="space-y-3">
          {maxFotos === 1 && (
            <>
              <div className="relative rounded-3xl overflow-hidden border-2"
                style={{ aspectRatio: '4/3', borderColor: allDone ? G : BORD }}
                onClick={() => !arreglo[0] && singleRef.current?.click()}>
                <AnimatePresence mode="popLayout">
                  {arreglo[0] ? (
                    <motion.div key="con-foto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                      <img src={URL.createObjectURL(arreglo[0])} alt="Foto cargada" className="w-full h-full object-cover" />
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.05 }}
                        className="absolute top-3 right-3 w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ background: G }}>
                        <Check size={24} color="#fff" strokeWidth={3} />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.div key="sin-foto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-5 cursor-pointer" style={{ background: G_LITE }}>
                      <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: 'white', boxShadow: `0 4px 16px ${G}22` }}>
                        <Camera size={38} style={{ color: G }} />
                      </div>
                      <div className="text-center px-8">
                        <p className="text-[18px] font-bold text-gray-800">Agregar foto de {mascota}</p>
                        <p className="text-[14px] text-gray-500 mt-1">Toca aquí para abrir la cámara o galería</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {arreglo[0] ? (
                <div className="flex gap-2">
                  <button onClick={() => singleRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-[14px] border-2 transition-all"
                    style={{ borderColor: G_MID, color: G, background: G_LITE }}>
                    <Camera size={18} /> Cambiar foto
                  </button>
                  <button onClick={() => setFile(0, null)}
                    className="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl font-semibold text-[14px] border-2 transition-all"
                    style={{ borderColor: '#FECACA', color: '#EF4444', background: '#FFF5F5' }}>
                    <X size={16} /> Eliminar
                  </button>
                </div>
              ) : (
                <button onClick={() => singleRef.current?.click()}
                  className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-[16px] border-2 transition-all"
                  style={{ borderColor: G, color: G, background: 'white' }}>
                  <Camera size={22} /> Abrir cámara o galería
                </button>
              )}
              {/* Sin `capture`: en móvil el sistema ofrece cámara Y galería (con
                  capture="environment" forzaba solo la cámara). */}
              <input ref={singleRef} type="file" accept="image/*" className="hidden"
                onChange={e => { setFile(0, e.target.files?.[0] || null); e.target.value = '' }} />
            </>
          )}

          {maxFotos > 1 && (
            <>
              <button onClick={() => multiRef.current?.click()}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-[16px] border-2 transition-all"
                style={{ borderColor: allDone ? G : G_MID, color: G, background: allDone ? G_LITE : 'white' }}>
                <Camera size={22} />
                {filled === 0 ? `Agregar hasta ${maxFotos} fotos` : allDone ? `✓ ${maxFotos} fotos cargadas` : `Agregar más fotos (${filled} de ${maxFotos})`}
              </button>
              <input ref={multiRef} type="file" accept="image/*" multiple className="hidden" onChange={onMulti} />
              {filled > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {arreglo.map((f, idx) => (
                    <div key={idx} className="relative rounded-2xl overflow-hidden border-2" style={{ aspectRatio: '1/1', borderColor: f ? G : BORD }}>
                      {f ? (
                        <>
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                          <div className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: G }}>
                            <Check size={16} color="#fff" strokeWidth={3} />
                          </div>
                          <button onClick={() => setFile(idx, null)}
                            className="absolute bottom-2 right-2 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>Eliminar</button>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer" style={{ background: G_LITE }}
                          onClick={() => multiRef.current?.click()}>
                          <Camera size={28} style={{ color: G }} />
                          <span className="text-[13px] font-semibold" style={{ color: G }}>Foto {idx + 1}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {campos.length > 0 && (
        <div className="bg-white rounded-2xl border p-5 space-y-5" style={{ borderColor: BORD }}>
          {campos.map(campo => {
            const maxPalabras = maxPalabrasCampo(campo.label)
            return (
            <div key={campo.label}>
              <label className="text-[14px] font-bold text-gray-700 block mb-3">
                {campo.label}
                {campo.cantidad > 1 && <span className="text-[12px] text-gray-400 font-normal ml-1.5">({campo.cantidad} en total)</span>}
                {maxPalabras > 0 && <span className="text-[12px] text-gray-400 font-normal ml-1.5">(máx. {maxPalabras} palabras)</span>}
              </label>
              <div className="space-y-3">
                {Array.from({ length: campo.cantidad || 1 }).map((_, i) => {
                  const valor = textosVals[campo.label]?.[i] || ''
                  return (
                  <div key={i}>
                    <input type="text" value={valor}
                      onChange={e => setTexto(campo.label, i, maxPalabras > 0 ? limitarPalabras(e.target.value, maxPalabras) : e.target.value)}
                      placeholder={campo.cantidad > 1 ? `${campo.label} ${i + 1}` : `Escribe aquí…`}
                      className="w-full text-[16px] border-2 rounded-xl px-4 py-3.5 outline-none transition-colors"
                      style={{ borderColor: valor.trim() ? G : BORD, background: '#FAFCFA' }}
                      onFocus={e => e.target.style.borderColor = G}
                      onBlur={e  => e.target.style.borderColor = valor.trim() ? G : BORD} />
                    {maxPalabras > 0 && (
                      <p className="text-[12px] mt-1.5 text-right"
                        style={{ color: contarPalabras(valor) >= maxPalabras ? '#DC2626' : '#9CA3AF' }}>
                        {contarPalabras(valor) >= maxPalabras
                          ? `Llegaste al límite de ${maxPalabras} palabras`
                          : `${contarPalabras(valor)} / ${maxPalabras} palabras`}
                      </p>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── PasoItem ─────────────────────────────────────────────────────────────────
function PasoItem({ item, mascota, files, textosVals, onFilesChange, onTextosChange, declined, onToggleDeclined }) {
  const rec    = item.recordatorios
  const nombre = rec?.nombre || 'Recordatorio'
  const [confirmar, setConfirmar] = useState(false) // confirmación de "no deseo"

  // Recordatorio declinado: ocultamos la carga y ofrecemos reactivarlo.
  if (declined) {
    return (
      <div className="space-y-7">
        <div>
          <p className="text-[13px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9DBD9D' }}>
            Para los recuerdos de {mascota}
          </p>
          <h2 className="text-[28px] font-bold text-gray-900 leading-tight">{nombre}</h2>
        </div>
        <div className="bg-white rounded-3xl border-2 p-7 text-center space-y-4" style={{ borderColor: BORD }}>
          <div className="text-5xl">🚫</div>
          <p className="text-[17px] font-bold text-gray-800">No deseas este recordatorio</p>
          <p className="text-[14px] text-gray-500 leading-relaxed">
            No te pediremos fotos para este. Si cambias de opinión, puedes volver a activarlo.
          </p>
          <button onClick={() => onToggleDeclined(false)}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[15px] border-2 transition-all"
            style={{ borderColor: G, color: G, background: G_LITE }}>
            Sí lo quiero
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <div>
        <p className="text-[13px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9DBD9D' }}>
          Para los recuerdos de {mascota}
        </p>
        <h2 className="text-[28px] font-bold text-gray-900 leading-tight">{nombre}</h2>
        <div className="mt-3">
          <CapturaRecordatorio
            rec={rec} mascota={mascota} files={files} textosVals={textosVals}
            onFilesChange={onFilesChange} onTextosChange={onTextosChange} />
        </div>
      </div>

      {confirmar ? (
        <div className="rounded-2xl border-2 p-5 space-y-3" style={{ borderColor: '#FCA5A5', background: '#FEF2F2' }}>
          <p className="text-[15px] font-bold text-center" style={{ color: '#B91C1C' }}>
            ¿Seguro que no deseas este recordatorio?
          </p>
          <p className="text-[13px] text-center text-gray-500">No te pediremos sus fotos. Podrás reactivarlo después.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmar(false)}
              className="flex-1 py-3.5 rounded-2xl font-bold text-[15px] border-2 transition-all"
              style={{ borderColor: BORD, color: '#6B7280', background: 'white' }}>
              Cancelar
            </button>
            <button onClick={() => { setConfirmar(false); onToggleDeclined(true) }}
              className="flex-1 py-3.5 rounded-2xl font-bold text-[15px] text-white transition-all"
              style={{ background: '#DC2626' }}>
              Sí, no lo deseo
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmar(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-[14px] border-2 transition-all"
          style={{ borderColor: '#FCA5A5', color: '#DC2626', background: '#FEF2F2' }}>
          <X size={16} /> No deseo este recordatorio
        </button>
      )}
    </div>
  )
}

// ── PasoOferta ───────────────────────────────────────────────────────────────
// El anuncio. Sin presión: se explica, se muestra el precio y el cliente decide.
// Si acepta, se abre debajo la misma captura de fotos/textos que los demás.
function PasoOferta({ oferta, mascota, acepta, orden, yaLoTiene, onResponder, files, textosVals, onFilesChange, onTextosChange }) {
  const rec   = oferta.recordatorio
  const lista = oferta.precio_lista
  const hayDescuento = lista != null && Number(lista) > Number(oferta.precio_oferta)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: '#9DBD9D' }}>
          <Gift size={14} /> {orden ? `Propuesta ${orden.i} de ${orden.total}` : 'Una propuesta para ti'}
        </p>
        <h2 className="text-[28px] font-bold text-gray-900 leading-tight">{oferta.titulo}</h2>
      </div>

      <div className="bg-white rounded-3xl border-2 overflow-hidden"
        style={{ borderColor: acepta === true ? G : acepta === false ? R_MID : BORD }}>
        {oferta.imagen_url && (
          <img src={oferta.imagen_url} alt={oferta.titulo} className="w-full object-cover" style={{ aspectRatio: '16/10' }} />
        )}
        <div className="p-6 space-y-4">
          {oferta.descripcion && (
            <p className="text-[15px] text-gray-600 leading-relaxed whitespace-pre-line">{oferta.descripcion}</p>
          )}
          <div className="flex items-baseline gap-3">
            <span className="text-[26px] font-bold" style={{ color: G }}>{pesos(oferta.precio_oferta)}</span>
            {hayDescuento && <span className="text-[16px] text-gray-400 line-through">{pesos(lista)}</span>}
          </div>
          {yaLoTiene && (
            <div className="rounded-xl px-4 py-3" style={{ background: G_LITE }}>
              <p className="text-[13px] leading-relaxed" style={{ color: G }}>
                <strong>Sería un {rec.nombre} adicional</strong>, además del que ya viene en tu
                plan — con la foto que tú elijas. Ideal si quieres uno para otro ser querido.
              </p>
            </div>
          )}
          <p className="text-[13px] text-gray-500 leading-relaxed">
            Si lo aceptas, se agrega a los recuerdos de {mascota} y se cobra junto con tu servicio
            al momento de la entrega. Si prefieres que no, no pasa nada.
          </p>

          {/* La opción elegida se ve elegida: rojo si dijo que no, verde si dijo
              que sí. La otra queda en outline, siempre a un toque de distancia
              por si cambia de opinión. */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <motion.button onClick={() => onResponder(false)} whileTap={{ scale: 0.97 }}
              className="py-4 rounded-2xl font-bold text-[15px] border-2 transition-all flex items-center justify-center gap-1.5"
              style={acepta === false
                ? { borderColor: R, color: R, background: R_LITE }
                : { borderColor: BORD, color: '#6B7280', background: 'white' }}>
              {acepta === false && <X size={16} strokeWidth={3} />}
              No, gracias
            </motion.button>
            <motion.button onClick={() => onResponder(true)} whileTap={{ scale: 0.97 }}
              className="py-4 rounded-2xl font-bold text-[15px] border-2 transition-all flex items-center justify-center gap-1.5"
              style={acepta === true
                ? { borderColor: G, background: G, color: '#fff' }
                : acepta === false
                  ? { borderColor: G, background: 'white', color: G }
                  : { borderColor: G, background: G, color: '#fff', opacity: 0.92 }}>
              {acepta === true && <Check size={16} strokeWidth={3} />}
              {acepta === false ? 'Mejor sí lo quiero' : acepta === true ? 'Lo quiero' : 'Sí, lo quiero'}
            </motion.button>
          </div>
        </div>
      </div>

      {acepta === true && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="rounded-2xl border-2 px-5 py-4" style={{ borderColor: G_MID, background: G_LITE }}>
            <p className="text-[15px] font-bold" style={{ color: G }}>¡Qué alegría! Ahora {rec.nombre}</p>
            <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">
              Necesitamos lo mismo que para los demás recuerdos de {mascota}.
            </p>
          </div>
          <CapturaRecordatorio
            rec={rec} mascota={mascota} files={files} textosVals={textosVals}
            onFilesChange={onFilesChange} onTextosChange={onTextosChange} />
        </motion.div>
      )}

      {acepta === false && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border-2 px-5 py-4 flex items-start gap-3"
          style={{ borderColor: R_MID, background: R_LITE }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: R }}>
            <X size={15} color="#fff" strokeWidth={3} />
          </div>
          <div>
            <p className="text-[15px] font-bold" style={{ color: R }}>No deseas este {rec.nombre}</p>
            <p className="text-[13px] text-gray-600 mt-0.5 leading-relaxed">
              Sin problema. Continuemos con los recuerdos de {mascota} — puedes cambiar de
              opinión aquí mismo o antes de enviar.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ── PasoFinal ─────────────────────────────────────────────────────────────────
function PasoFinal({ mascota, items, fotos, textos, declinados, catalogo, interes, setInteres, esCompostaje, anticipados, setAnticipados, comentarios, setComentarios, entrega, setEntrega, pedirEntrega, ofertas, ofertaResp, onIrOferta, onQuiereOferta, onGoTo }) {
  const [abierto, setAbierto] = useState(false)
  const setE = (k, v) => setEntrega(p => ({ ...p, [k]: v }))

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border p-6 text-center" style={{ borderColor: BORD }}>
        <div className="text-5xl mb-3">🌿</div>
        <h2 className="text-[22px] font-bold text-gray-900 mb-1">Revisión final para {mascota}</h2>
        <p className="text-[14px] text-gray-500 leading-relaxed">Revisa que todo esté correcto antes de enviar.</p>
      </div>

      {items.length > 0 && (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: BORD }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: BORD }}>
            <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: '#9DBD9D' }}>Recordatorios</p>
          </div>
          {items.map((it, idx) => {
            const rec      = it.recordatorios
            const maxF     = rec?.max_fotos || 0
            const nF       = (fotos[it.id] || []).filter(Boolean).length
            const declined = declinados.has(it.id)
            const listo    = declined || itemListo(it, fotos, textos)
            return (
              <div key={it.id} className="flex items-center gap-4 px-5 py-4 border-t hover:bg-gray-50 transition-colors" style={{ borderColor: BORD }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: declined ? '#E5E7EB' : (listo ? G : '#FEF3C7') }}>
                  {declined ? <X size={15} color="#6B7280" strokeWidth={3} /> : listo ? <Check size={16} color="#fff" strokeWidth={3} /> : <span className="text-[11px] font-bold text-amber-600">!</span>}
                </div>
                <span className={`flex-1 text-[15px] leading-tight ${declined ? 'text-gray-400' : (listo ? 'text-gray-800 font-medium' : 'text-gray-600')}`}>
                  {rec?.nombre}
                  {declined ? (
                    <span className="ml-2 text-[12px] font-semibold text-gray-400">No deseado</span>
                  ) : maxF > 0 && (
                    <span className="ml-2 text-[12px] font-semibold" style={{ color: nF === maxF ? G : '#F59E0B' }}>{nF}/{maxF} foto{maxF > 1 ? 's' : ''}</span>
                  )}
                </span>
                <button onClick={() => onGoTo(idx)} className="text-[13px] font-bold px-4 py-2 rounded-xl transition-all flex-shrink-0" style={{ background: G_LITE, color: G }}>Editar</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Resumen de las ofertas: qué respondió en cada una y cuánto suma */}
      {ofertas.length > 0 && (
        <div className="bg-white rounded-2xl border overflow-hidden"
          style={{ borderColor: ofertas.some(of => ofertaResp[of.id] === true) ? G : BORD }}>
          {/* Encabezado con peso: es lo último que ve antes de enviar y la
              última ocasión de recuperar una oferta que rechazó. */}
          <div className="px-5 py-4 border-b" style={{ borderColor: BORD, background: G_LITE }}>
            <p className="text-[15px] font-bold flex items-center gap-2" style={{ color: G }}>
              <Gift size={17} />
              {ofertas.length > 1 ? 'Ofertas especiales para ti' : 'Oferta especial para ti'}
            </p>
            <p className="text-[12.5px] text-gray-500 mt-1 leading-relaxed">
              Puedes agregarlas a los recuerdos de {mascota} hasta antes de enviar.
            </p>
          </div>
          {ofertas.map((of, i) => {
            const acepta = ofertaResp[of.id]
            return (
              <div key={of.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? 'border-t' : ''}`}
                style={{ borderColor: BORD, background: acepta === false ? R_LITE : 'transparent' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: acepta === true ? G : acepta === false ? R : '#E5E7EB' }}>
                  {acepta === true
                    ? <Check size={16} color="#fff" strokeWidth={3} />
                    : <X size={15} color={acepta === false ? '#fff' : '#6B7280'} strokeWidth={3} />}
                </div>
                <span className="flex-1 text-[15px] leading-tight text-gray-800">
                  {of.recordatorio?.nombre || of.titulo}
                  <span className="block text-[12px] font-semibold mt-0.5"
                    style={{ color: acepta === true ? G : acepta === false ? R : '#9CA3AF' }}>
                    {acepta === true
                      ? `Aceptada · ${pesos(of.precio_oferta)} se suman a tu servicio`
                      : acepta === false ? `No lo deseas · ${pesos(of.precio_oferta)}` : 'Sin responder'}
                  </span>
                </span>
                {/* Rechazada: el botón no es "ver", es la puerta de vuelta. Deja la
                    oferta aceptada y lleva directo a subir lo que necesita. */}
                <button onClick={() => acepta === false ? onQuiereOferta(of) : onIrOferta(of)}
                  className="text-[13px] font-bold px-4 py-2 rounded-xl transition-all flex-shrink-0 border-2"
                  style={acepta === false
                    ? { background: G, color: '#fff', borderColor: G }
                    : { background: G_LITE, color: G, borderColor: 'transparent' }}>
                  {acepta === true ? 'Editar' : acepta === false ? 'Sí lo quiero' : 'Ver'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Interés en un adicional → SOLO crea una solicitud para coordinación */}
      <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: interes.quiere ? G : BORD }}>
        <button className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50"
          onClick={() => { const q = !abierto; setAbierto(q); setInteres(p => ({ ...p, quiere: q })) }}>
          <div>
            <p className="text-[15px] font-bold text-gray-800">Quiero información para comprar un recordatorio adicional</p>
            <p className="text-[13px] text-gray-400 mt-0.5">Opcional · te contactaremos, no genera ningún cobro</p>
          </div>
          <motion.div animate={{ rotate: abierto ? 45 : 0 }} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: G_LITE }}>
            <Plus size={18} style={{ color: G }} />
          </motion.div>
        </button>
        <AnimatePresence>
          {abierto && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
              <div className="border-t p-5 space-y-4" style={{ borderColor: BORD }}>
                <div>
                  <label className="text-[13px] font-bold text-gray-600 block mb-2">¿Cuál te interesa? (opcional)</label>
                  <select value={interes.recordatorio_id} onChange={e => setInteres(p => ({ ...p, recordatorio_id: e.target.value }))}
                    className="w-full text-[15px] border-2 rounded-xl px-4 py-3 outline-none bg-white" style={{ borderColor: BORD }}>
                    <option value="">Selecciona un recordatorio…</option>
                    {catalogo.map(r => <option key={r.id} value={r.id}>{r.nombre}{r.precio_base > 0 ? ` — ${pesos(r.precio_base)}` : ''}</option>)}
                  </select>
                </div>
                <textarea value={interes.texto} onChange={e => setInteres(p => ({ ...p, texto: e.target.value }))} rows={3}
                  placeholder="Cuéntanos qué te gustaría (opcional)…"
                  className="w-full text-[15px] border-2 rounded-xl px-4 py-3 outline-none resize-none" style={{ borderColor: BORD, background: '#FAFCFA' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {esCompostaje && (
        <div className="bg-white rounded-2xl border p-5 space-y-4" style={{ borderColor: anticipados !== null ? G : BORD }}>
          <div>
            <p className="text-[16px] font-bold text-gray-800">🌱 Proceso de compostaje</p>
            <p className="text-[14px] text-gray-500 mt-1.5 leading-relaxed">El proceso dura aproximadamente <strong>2 meses</strong>.<br />¿Cuándo desea recibir los recordatorios?</p>
          </div>
          {[
            { val: true,  label: 'Quiero los recordatorios cuanto antes', sub: 'Los elaboramos mientras avanza el proceso.' },
            { val: false, label: 'Prefiero recibirlos todos al final', sub: 'Recibirás todo al término del compostaje.' },
          ].map(opt => (
            <button key={String(opt.val)} onClick={() => setAnticipados(opt.val)}
              className="w-full flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all"
              style={{ borderColor: anticipados === opt.val ? G : BORD, background: anticipados === opt.val ? G_LITE : 'white' }}>
              <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: anticipados === opt.val ? G : 'white', borderColor: anticipados === opt.val ? G : BORD }}>
                {anticipados === opt.val && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
              </div>
              <div>
                <p className="text-[15px] font-bold text-gray-800">{opt.label}</p>
                <p className="text-[13px] text-gray-500 mt-0.5">{opt.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: BORD }}>
        <label className="text-[16px] font-bold text-gray-800 block mb-1">
          💬 Indicaciones de diseño<span className="text-[13px] text-gray-400 font-normal ml-1.5">· opcional</span>
        </label>
        <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">Cuéntanos indicaciones para tener en cuenta. Nuestro equipo las evaluará y aplicará lo que sea posible.</p>
        <textarea value={comentarios} onChange={e => setComentarios(e.target.value)} rows={4} placeholder="Escribe aquí tus indicaciones…"
          className="w-full text-[15px] border-2 rounded-xl px-4 py-3.5 outline-none resize-none transition-colors"
          style={{ borderColor: comentarios.trim() ? G : BORD, background: '#FAFCFA' }}
          onFocus={e => e.target.style.borderColor = G}
          onBlur={e  => e.target.style.borderColor = comentarios.trim() ? G : BORD} />
      </div>

      {/* Datos para la entrega — solo si hay algo físico que entregar
          (en eco-grupal todos los recordatorios son digitales → no se pide) */}
      {pedirEntrega && (
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: BORD }}>
        <label className="text-[16px] font-bold text-gray-800 block mb-1">
          📦 Datos para la entrega<span className="text-[13px] font-bold ml-1.5" style={{ color: '#B45309' }}>· obligatorio</span>
        </label>
        <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
          Cuando los recuerdos de {mascota} estén listos, así sabremos dónde y con quién entregarlos.
        </p>
        <div className="space-y-3">
          <CampoEntrega label="Dirección de entrega" required value={entrega.direccion} onChange={v => setE('direccion', v)} placeholder="Calle, carrera, conjunto, apto…" />
          <div className="grid grid-cols-2 gap-3">
            <CampoEntrega label="Barrio" value={entrega.barrio} onChange={v => setE('barrio', v)} placeholder="Barrio / sector" />
            <CampoEntrega label="Localidad" value={entrega.localidad} onChange={v => setE('localidad', v)} placeholder="Localidad" />
          </div>
          <CampoEntrega label="¿Quién recibe?" required value={entrega.recibe} onChange={v => setE('recibe', v)} placeholder="Nombre de quien recibe" />
          <div className="grid grid-cols-2 gap-3">
            <CampoEntrega label="Teléfono" required value={entrega.telefono} onChange={v => setE('telefono', v)} placeholder="Celular" inputMode="tel" />
            <CampoEntrega label="Teléfono adicional" value={entrega.telefono_adicional} onChange={v => setE('telefono_adicional', v)} placeholder="Otro contacto" inputMode="tel" />
          </div>
          <div>
            <label className="text-[13px] font-bold text-gray-600 block mb-2">Horarios a tener en cuenta</label>
            <textarea value={entrega.horarios} onChange={e => setE('horarios', e.target.value)} rows={2}
              placeholder="Ej: entre semana después de las 2 pm, fines de semana en la mañana…"
              className="w-full text-[15px] border-2 rounded-xl px-4 py-3 outline-none resize-none"
              style={{ borderColor: entrega.horarios.trim() ? G : BORD, background: '#FAFCFA' }} />
            <p className="text-[12px] text-gray-400 mt-2 leading-relaxed">
              Nos ayuda a coordinar mejor. Ten en cuenta que <strong>no confirmamos una hora exacta</strong> de entrega; te avisaremos cuando el mensajero vaya en camino.
            </p>
          </div>
        </div>
      </div>
      )}

      <p className="text-center text-[13px] text-gray-400 pb-2 leading-relaxed px-2">
        Al enviar, autorizas el uso de estas fotos para elaborar los recordatorios de {mascota}.
      </p>
    </div>
  )
}

// ── Confirmaciones antes de enviar ───────────────────────────────────────────
// Tres preguntas, una a la vez, en el orden que pidió David:
//   1. ¿Subiste todas las fotos?
//   2. ¿Los datos de entrega están correctos?  (solo si hay entrega física)
//   3. ¿Confirmas que NO quieres la oferta?    (una por cada oferta rechazada)
// Cada una permite devolverse a corregir en vez de seguir de largo.
function ConfirmacionesEnvio({ mascota, items, fotos, declinados, entrega, pedirEntrega, ofertas, ofertaResp, onCancelar, onCorregirEntrega, onQuieroOferta, onConfirmado }) {
  const aceptadas  = ofertas.filter(of => ofertaResp[of.id] === true)
  const rechazadas = ofertas.filter(of => ofertaResp[of.id] === false)
  const pasos = [{ tipo: 'fotos' }]
  if (pedirEntrega) pasos.push({ tipo: 'entrega' })
  // Última oportunidad, una por cada anuncio que declinó.
  for (const of of rechazadas) pasos.push({ tipo: 'oferta', oferta: of })

  const [idx, setIdx] = useState(0)
  const actual = pasos[idx] || pasos[0]
  const esUltimo = idx === pasos.length - 1

  function avanzar() {
    if (esUltimo) onConfirmado()
    else setIdx(i => i + 1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5"
      style={{ background: 'rgba(15,23,42,0.45)' }}>
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[88vh] overflow-y-auto">

        <div className="px-6 pt-6 pb-2 flex items-center gap-2">
          {pasos.map((p, i) => (
            <div key={`${p.tipo}-${p.oferta?.id || ''}`} className="h-1.5 flex-1 rounded-full transition-colors"
              style={{ background: i <= idx ? G : '#E5E7EB' }} />
          ))}
        </div>

        <div className="p-6 pt-4 space-y-5">
          {actual.tipo === 'fotos' && (
            <>
              <div className="text-center">
                <div className="text-4xl mb-2">📸</div>
                <h3 className="text-[20px] font-bold text-gray-900">¿Ya subiste todas las fotos?</h3>
                <p className="text-[14px] text-gray-500 mt-1.5 leading-relaxed">
                  Después de enviar no podrás agregar más desde aquí.
                </p>
              </div>
              <div className="rounded-2xl border divide-y" style={{ borderColor: BORD }}>
                {items.map(it => {
                  const declined = declinados.has(it.id)
                  const maxF = it.recordatorios?.max_fotos || 0
                  const nF   = (fotos[it.id] || []).filter(Boolean).length
                  return (
                    <div key={it.id} className="flex items-center justify-between px-4 py-3" style={{ borderColor: BORD }}>
                      <span className={`text-[14px] ${declined ? 'text-gray-400' : 'text-gray-700'}`}>{it.recordatorios?.nombre}</span>
                      <span className="text-[13px] font-bold" style={{ color: declined ? '#9CA3AF' : G }}>
                        {declined ? 'No deseado' : maxF > 0 ? `${nF}/${maxF}` : 'Listo'}
                      </span>
                    </div>
                  )
                })}
                {aceptadas.map(of => (
                  <div key={of.id} className="flex items-center justify-between px-4 py-3" style={{ borderColor: BORD }}>
                    <span className="text-[14px] text-gray-700">{of.recordatorio.nombre}</span>
                    <span className="text-[13px] font-bold" style={{ color: G }}>Listo</span>
                  </div>
                ))}
                {items.length === 0 && ofertas.length === 0 && (
                  <div className="px-4 py-3 text-[13px] text-gray-400 text-center">Este servicio no requiere fotos.</div>
                )}
              </div>
            </>
          )}

          {actual.tipo === 'entrega' && (
            <>
              <div className="text-center">
                <div className="text-4xl mb-2">📦</div>
                <h3 className="text-[20px] font-bold text-gray-900">¿Estos datos de entrega están bien?</h3>
                <p className="text-[14px] text-gray-500 mt-1.5 leading-relaxed">
                  Con ellos llevaremos los recuerdos de {mascota}.
                </p>
              </div>
              <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: BORD, background: '#FAFCFA' }}>
                <FilaDato label="Dirección" valor={entrega.direccion} />
                {(entrega.barrio || entrega.localidad) &&
                  <FilaDato label="Barrio / localidad" valor={[entrega.barrio, entrega.localidad].filter(Boolean).join(' · ')} />}
                <FilaDato label="Recibe" valor={entrega.recibe} />
                <FilaDato label="Teléfono" valor={[entrega.telefono, entrega.telefono_adicional].filter(Boolean).join(' · ')} />
                {entrega.horarios && <FilaDato label="Horarios" valor={entrega.horarios} />}
              </div>
              <button onClick={onCorregirEntrega}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] border-2 transition-all"
                style={{ borderColor: BORD, color: '#6B7280', background: 'white' }}>
                Corregir los datos
              </button>
            </>
          )}

          {actual.tipo === 'oferta' && (
            <>
              <div className="text-center">
                <div className="text-4xl mb-2">🎁</div>
                <h3 className="text-[20px] font-bold text-gray-900">
                  ¿Seguro que no deseas agregar {actual.oferta.recordatorio?.nombre || 'este recordatorio'}?
                </h3>
                <p className="text-[14px] text-gray-500 mt-1.5 leading-relaxed">
                  Es la última oportunidad de sumarlo a los recuerdos de {mascota}. Después de
                  enviar ya no podrás agregarlo desde aquí.
                </p>
              </div>
              <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: BORD }}>
                {actual.oferta.imagen_url && (
                  <img src={actual.oferta.imagen_url} alt="" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                )}
                <div className="p-4">
                  <p className="text-[15px] font-bold text-gray-900">{actual.oferta.titulo}</p>
                  <p className="text-[17px] font-bold mt-1" style={{ color: G }}>{pesos(actual.oferta.precio_oferta)}</p>
                </div>
              </div>
              {/* Cambiar de opinión es la acción destacada; seguir sin él es el
                  botón secundario de abajo ("No, gracias" / "Sí, enviar ahora"). */}
              <motion.button onClick={() => onQuieroOferta(actual.oferta)} whileTap={{ scale: 0.98 }}
                className="w-full py-4 rounded-2xl font-bold text-[16px] text-white transition-all flex items-center justify-center gap-2"
                style={{ background: G }}>
                <Check size={18} strokeWidth={3} /> Sí lo quiero
              </motion.button>
            </>
          )}

          <div className="space-y-2 pt-1">
            {/* En el paso de una oferta rechazada el protagonismo lo tiene
                "Sí lo quiero": seguir sin ella es la opción discreta. */}
            <button onClick={avanzar}
              className="w-full py-4 rounded-2xl font-bold text-[16px] transition-all border-2"
              style={actual.tipo === 'oferta'
                ? { borderColor: BORD, color: '#6B7280', background: 'white' }
                : { borderColor: G, background: G, color: '#fff' }}>
              {actual.tipo === 'oferta'
                ? (esUltimo ? 'No, gracias · enviar ahora' : 'No, gracias · continuar')
                : esUltimo ? 'Sí, enviar ahora' : 'Sí, confirmo'}
            </button>
            <button onClick={onCancelar}
              className="w-full py-3 rounded-2xl font-semibold text-[14px] text-gray-500">
              Volver a revisar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function FilaDato({ label, valor }) {
  return (
    <div className="flex gap-3">
      <span className="text-[12px] font-bold text-gray-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-[14px] text-gray-800 flex-1 break-words">{valor || '—'}</span>
    </div>
  )
}

// ── Pantalla de entrada ───────────────────────────────────────────────────────
function EntradaScreen({ cInput, setCInput, onBuscar }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-12" style={{ background: BG }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mx-auto mb-5 shadow-lg" style={{ background: G }}>🌿</div>
          <h1 className="text-[28px] font-bold text-gray-900">Camino al Cielo</h1>
          <p className="text-[15px] text-gray-500 mt-1.5">Portal para compartir fotos</p>
        </div>
        <div className="bg-white rounded-3xl p-7 shadow-sm border" style={{ borderColor: BORD }}>
          <p className="text-[15px] text-gray-600 mb-6 text-center leading-relaxed">Ingresa el código que te enviamos por WhatsApp para comenzar.</p>
          <label className="text-[13px] font-bold text-gray-500 block mb-2">Código de servicio</label>
          <input type="text" value={cInput} onChange={e => setCInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && onBuscar()} placeholder="Ej: ABC12345"
            className="w-full border-2 rounded-2xl px-4 py-4 text-[24px] font-bold text-center tracking-[0.12em] outline-none mb-5 transition-colors"
            style={{ borderColor: cInput.trim() ? G : BORD, background: '#FAFCFA', color: '#1A2E1E' }}
            onFocus={e => e.target.style.borderColor = G}
            onBlur={e  => e.target.style.borderColor = cInput.trim() ? G : BORD}
            autoFocus autoCapitalize="characters" />
          <button onClick={onBuscar} disabled={!cInput.trim()}
            className="w-full py-5 rounded-2xl font-bold text-white text-[17px] transition-opacity disabled:opacity-35" style={{ background: G }}>
            Continuar →
          </button>
        </div>
        <p className="text-center text-[13px] text-gray-400 mt-6 leading-relaxed">
          ¿No tienes el código? <a href="https://wa.me/573159891247" className="font-bold underline underline-offset-2" style={{ color: G }}>Escríbenos por WhatsApp</a>
        </p>
      </div>
    </div>
  )
}

function PantallaEnviado({ mascota }) {
  return (
    <Centrado>
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className="w-28 h-28 rounded-3xl flex items-center justify-center text-6xl mb-6 shadow-xl" style={{ background: G }}>🌿</motion.div>
      <h1 className="text-[26px] font-bold text-gray-900 mb-3">¡Fotos recibidas!</h1>
      <p className="text-[15px] text-gray-500 leading-relaxed max-w-xs text-center">
        Gracias por compartir las fotos de <strong>{mascota}</strong>.<br /><br />Nuestro equipo comenzará a trabajar con mucho cariño.
      </p>
      <p className="text-[13px] text-gray-400 mt-6">Puede cerrar esta ventana.</p>
    </Centrado>
  )
}

function PantallaInfo({ emoji, titulo, texto, cta }) {
  return (
    <Centrado>
      <div className="text-6xl mb-4">{emoji}</div>
      <h1 className="text-[22px] font-bold text-gray-900 mb-3">{titulo}</h1>
      <p className="text-[15px] text-gray-500 max-w-xs text-center leading-relaxed">{texto}</p>
      {cta && <button onClick={cta.fn} className="mt-6 px-8 py-4 rounded-2xl font-bold text-white text-[16px]" style={{ background: G }}>{cta.label}</button>}
    </Centrado>
  )
}

function CampoEntrega({ label, value, onChange, placeholder, inputMode, required }) {
  return (
    <div>
      <label className="text-[13px] font-bold text-gray-600 block mb-2">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type="text" inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full text-[15px] border-2 rounded-xl px-4 py-3 outline-none transition-colors"
        style={{ borderColor: value.trim() ? G : BORD, background: '#FAFCFA' }}
        onFocus={e => e.target.style.borderColor = G}
        onBlur={e  => e.target.style.borderColor = value.trim() ? G : BORD} />
    </div>
  )
}

function Centrado({ children }) {
  return <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-2" style={{ background: BG }}>{children}</div>
}
