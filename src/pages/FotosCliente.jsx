import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { db, dbAdmin } from '@/lib/supabase'
import { Camera, Check, ChevronLeft, ChevronRight, Loader2, Send, X, Plus } from 'lucide-react'

const G      = '#1A5CD8'
const G_LITE = '#E8F3EB'
const G_MID  = '#C5DEC9'
const BG     = '#F4F7F4'
const BORD   = '#D8E5D8'

const slide = {
  enter:  d => ({ x: d > 0 ? '60%' : '-60%', opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 34 } },
  exit:   d => ({ x: d > 0 ? '-60%' : '60%', opacity: 0, transition: { duration: 0.2 } }),
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FotosCliente({ codigo: codigoProp }) {
  const [fase,        setFase]       = useState(codigoProp ? 'cargando' : 'entrada')
  const [cInput,      setCInput]     = useState(codigoProp || '')
  const [servicio,    setServicio]   = useState(null)
  const [items,       setItems]      = useState([])
  const [fotos,       setFotos]      = useState({})
  const [textos,      setTextos]     = useState({})
  const [removidos,   setRemovidos]  = useState(new Set())
  const [comentarios, setComentarios]= useState('')
  const [anticipados, setAnticipados]= useState(null)
  const [catalogo,    setCatalogo]   = useState([])
  const [extras,      setExtras]     = useState([])
  const [guardando,   setGuardando]  = useState(false)
  const [paso,        setPaso]       = useState(0)
  const [dir,         setDir]        = useState(1)

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  const totalPasos = items.length + 1
  const esFinal    = paso === totalPasos - 1
  const itemActual = items[paso]
  const esCompostaje = servicio?.planes?.tipo_proceso?.startsWith('COMPOSTAJE')
  const mascota    = servicio?.mascotas?.nombre || 'tu mascota'

  function ir(n) { setDir(n > paso ? 1 : -1); setPaso(n) }
  function siguiente() { if (paso < totalPasos - 1) ir(paso + 1) }
  function anterior()  { if (paso > 0) ir(paso - 1) }

  // ── Carga ─────────────────────────────────────────────────────────────────
  async function buscar() {
    const cod = cInput.trim().toUpperCase()
    if (!cod) return
    setFase('cargando')
    await cargar(cod)
  }

  async function cargar(codigo) {
    try {
      const { data, error } = await db
        .from('servicios')
        .select(`
          id, estado,
          mascotas(nombre, especies(nombre)),
          planes(nombre, tipo_proceso),
          servicio_recordatorios(
            id, origen, estado,
            imagen_cliente_url, imagenes_cliente_urls,
            recordatorios(id, nombre, solo_nombre, requiere_imagen, max_fotos, campos_texto)
          )
        `)
        .eq('codigo_fotos', codigo)
        .maybeSingle()

      if (error || !data) { setFase('no_encontrado'); return }
      setServicio(data)
      if (data.estado !== 'EN_CUARTO_FRIO') { setFase('ya_procesado'); return }

      const srs = (data.servicio_recordatorios || []).filter(sr => sr.origen !== 'REMOVIDO')
      const it  = srs.filter(sr => {
        const rec = sr.recordatorios
        if (!rec || rec.solo_nombre) return false
        if (!['PLAN', 'VIP'].includes(sr.origen)) return false
        return (rec.requiere_imagen !== false && (rec.max_fotos || 0) > 0)
            || (rec.campos_texto || []).length > 0
      })
      setItems(it)

      const fi = {}
      it.forEach(sr => {
        if (sr.recordatorios?.requiere_imagen !== false && (sr.recordatorios?.max_fotos || 0) > 0)
          fi[sr.id] = Array(sr.recordatorios.max_fotos).fill(null)
      })
      setFotos(fi)

      const ti = {}
      it.forEach(sr => {
        const campos = sr.recordatorios?.campos_texto || []
        if (campos.length > 0) {
          ti[sr.id] = {}
          campos.forEach(c => { ti[sr.id][c.label] = Array(c.cantidad || 1).fill('') })
        }
      })
      setTextos(ti)

      const existIds = srs.map(sr => sr.recordatorios?.id).filter(Boolean)
      const { data: recs } = await db.from('recordatorios')
        .select('id,nombre,solo_nombre,requiere_imagen,max_fotos,precio_base,campos_texto')
        .eq('activo', true).order('nombre')
      setCatalogo((recs || []).filter(r => !existIds.includes(r.id)))
      setFase('form'); setPaso(0)
    } catch (e) {
      console.error(e); setFase('no_encontrado')
    }
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  async function guardar() {
    setGuardando(true)
    try {
      for (const [srId, files] of Object.entries(fotos)) {
        if (removidos.has(srId)) continue
        const validos  = (files || []).filter(Boolean)
        const txtData  = textos[srId] || {}
        const hasTexto = Object.values(txtData).some(arr => arr.some(v => v?.trim()))
        if (!validos.length && !hasTexto) continue
        const upd = {}
        if (validos.length) {
          const urls = []
          for (let i = 0; i < validos.length; i++) {
            const f   = validos[i]
            const ext = f.name.split('.').pop().toLowerCase() || 'jpg'
            const p   = `${servicio.id}/${srId}_${i}.${ext}`
            await dbAdmin.storage.from('fotos-clientes').upload(p, f, { upsert: true })
            const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(p)
            urls.push(publicUrl)
          }
          upd.imagen_cliente_url    = urls[0]
          upd.imagenes_cliente_urls = urls
        }
        if (hasTexto) upd.datos_cliente = txtData
        upd.estado = 'EN_PROCESO'
        const { error: e } = await dbAdmin.from('servicio_recordatorios').update(upd).eq('id', srId)
        if (e) throw new Error('Error guardando: ' + e.message)
      }

      for (const srId of removidos)
        await dbAdmin.from('servicio_recordatorios').update({ estado: 'NA' }).eq('id', srId)

      for (const extra of extras) {
        const { data: ns, error: ie } = await dbAdmin
          .from('servicio_recordatorios')
          .insert({ servicio_id: servicio.id, recordatorio_id: extra.rec_id, origen: 'ADICIONAL', estado: 'PENDIENTE' })
          .select('id').single()
        if (ie || !ns) continue
        const upd   = {}
        const vals  = (extra.files || []).filter(Boolean)
        if (vals.length) {
          const urls = []
          for (let i = 0; i < vals.length; i++) {
            const f   = vals[i]
            const ext = f.name.split('.').pop().toLowerCase() || 'jpg'
            const p   = `${servicio.id}/${ns.id}_${i}.${ext}`
            await dbAdmin.storage.from('fotos-clientes').upload(p, f, { upsert: true })
            const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(p)
            urls.push(publicUrl)
          }
          upd.imagen_cliente_url = urls[0]; upd.imagenes_cliente_urls = urls
        }
        const ht = Object.values(extra.textos || {}).some(arr => arr.some(v => v?.trim()))
        if (ht) upd.datos_cliente = extra.textos
        upd.estado = 'EN_PROCESO'
        if (Object.keys(upd).length)
          await dbAdmin.from('servicio_recordatorios').update(upd).eq('id', ns.id)
      }

      const svcUpd = {
        estado: 'EN_PROCESO',
        fecha_imagenes_recibidas: new Date().toISOString(),
        ...(comentarios.trim() ? { comentarios_cliente: comentarios.trim() } : {}),
        ...(esCompostaje && anticipados !== null ? { recordatorios_anticipados: anticipados } : {}),
      }
      const { error: se } = await dbAdmin.from('servicios').update(svcUpd).eq('id', servicio.id)
      if (se) throw new Error('No se pudo guardar: ' + se.message)
      setFase('enviado')
    } catch (e) {
      alert('Ocurrió un error. Intenta de nuevo.\n\n' + e.message)
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
  if (fase === 'enviado') return <PantallaEnviado mascota={mascota} />

  // ── WIZARD ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: BG }}>

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white shadow-sm border-b" style={{ borderColor: BORD }}>
        <div className="max-w-lg mx-auto px-5 py-4">

          {/* Logo + mascota */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: G }}>🌿</div>
            <div>
              <p className="text-[16px] font-bold text-gray-900 leading-none">{mascota}</p>
              <p className="text-[12px] text-gray-500 mt-0.5">{servicio?.planes?.nombre}</p>
            </div>
          </div>

          {/* Progreso textual — claro para cualquier edad */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: G_LITE }}>
              <motion.div className="h-full rounded-full" style={{ background: G }}
                animate={{ width: `${totalPasos > 1 ? Math.round((paso / (totalPasos - 1)) * 100) : 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28 }} />
            </div>
            <span className="text-[13px] font-bold whitespace-nowrap flex-shrink-0"
              style={{ color: G }}>
              {esFinal ? 'Revisión final' : `Paso ${paso + 1} de ${items.length}`}
            </span>
          </div>

        </div>
      </header>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div key={paso} custom={dir}
            variants={slide} initial="enter" animate="center" exit="exit"
            className="absolute inset-0 overflow-y-auto">
            <div className="max-w-lg mx-auto px-5 pt-7 pb-40">

              {!esFinal && itemActual && (
                <PasoItem
                  item={itemActual}
                  mascota={mascota}
                  files={fotos[itemActual.id] || []}
                  textosVals={textos[itemActual.id] || {}}
                  removido={removidos.has(itemActual.id)}
                  onFilesChange={f => setFotos(p => ({ ...p, [itemActual.id]: f }))}
                  onTextosChange={v => setTextos(p => ({ ...p, [itemActual.id]: v }))}
                  onRemover={() => setRemovidos(p => {
                    const n = new Set(p)
                    n.has(itemActual.id) ? n.delete(itemActual.id) : n.add(itemActual.id)
                    return n
                  })}
                />
              )}

              {esFinal && (
                <PasoFinal
                  mascota={mascota}
                  items={items} fotos={fotos} textos={textos} removidos={removidos}
                  catalogo={catalogo} extras={extras} setExtras={setExtras}
                  esCompostaje={esCompostaje}
                  anticipados={anticipados} setAnticipados={setAnticipados}
                  comentarios={comentarios} setComentarios={setComentarios}
                  onGoTo={ir}
                />
              )}

            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Navegación fija ────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-20 bg-white border-t shadow-lg px-5 py-4"
        style={{ borderColor: BORD }}>
        <div className="max-w-lg mx-auto space-y-3">

          {/* Botón principal */}
          {esFinal ? (
            <motion.button onClick={guardar} disabled={guardando} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-white text-[17px] transition-opacity disabled:opacity-60"
              style={{ background: G }}>
              {guardando
                ? <><Loader2 size={20} className="animate-spin" /> Enviando las fotos…</>
                : <><Send size={18} /> Enviar fotos a Camino al Cielo</>}
            </motion.button>
          ) : (
            <motion.button onClick={siguiente} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-white text-[17px]"
              style={{ background: G }}>
              {paso === items.length - 1
                ? 'Revisar y enviar →'
                : 'Siguiente recordatorio →'}
            </motion.button>
          )}

          {/* Botón secundario: Volver */}
          {paso > 0 && (
            <button onClick={anterior}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-[15px] border-2 transition-all"
              style={{ borderColor: BORD, color: '#6B7280', background: 'white' }}>
              <ChevronLeft size={18} /> Volver al anterior
            </button>
          )}

        </div>
      </div>

    </div>
  )
}

// ── PasoItem ──────────────────────────────────────────────────────────────────
function PasoItem({ item, mascota, files, textosVals, removido, onFilesChange, onTextosChange, onRemover }) {
  const rec      = item.recordatorios
  const nombre   = rec?.nombre || 'Recordatorio'
  const maxFotos = (rec?.requiere_imagen !== false && (rec?.max_fotos || 0) > 0) ? rec.max_fotos : 0
  const campos   = rec?.campos_texto || []
  const arreglo  = Array.from({ length: maxFotos }, (_, i) => files?.[i] ?? null)
  const filled   = arreglo.filter(Boolean).length
  const allDone  = maxFotos > 0 && filled === maxFotos
  const singleRef = useRef(null)
  const multiRef  = useRef(null)

  function setFile(idx, file) {
    const n = [...arreglo]; n[idx] = file; onFilesChange(n)
  }
  function onMulti(e) {
    const sel  = Array.from(e.target.files || []).slice(0, maxFotos)
    const next = [...arreglo]; let slot = 0
    for (const f of sel) {
      while (slot < maxFotos && next[slot] !== null) slot++
      if (slot < maxFotos) { next[slot] = f; slot++ }
    }
    onFilesChange(next); e.target.value = ''
  }
  function setTexto(label, idx, val) {
    const c   = campos.find(c => c.label === label)
    const arr = [...(textosVals[label] || Array(c?.cantidad || 1).fill(''))]
    arr[idx]  = val
    onTextosChange({ ...textosVals, [label]: arr })
  }

  if (removido) return (
    <div className="text-center py-12 px-4">
      <div className="text-6xl mb-5">🚫</div>
      <p className="text-[20px] font-bold text-gray-400 mb-2 line-through">{nombre}</p>
      <p className="text-[15px] text-gray-400 mb-8 leading-relaxed">
        No incluirás este recordatorio.<br />Si cambiaste de opinión, puedes restaurarlo.
      </p>
      <button onClick={onRemover}
        className="px-8 py-4 rounded-2xl font-bold text-[15px] border-2 transition-all"
        style={{ borderColor: G_MID, color: G, background: G_LITE }}>
        ↩ Sí quiero incluirlo
      </button>
    </div>
  )

  return (
    <div className="space-y-7">

      {/* Título del paso */}
      <div>
        <p className="text-[13px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9DBD9D' }}>
          Para los recuerdos de {mascota}
        </p>
        <h2 className="text-[28px] font-bold text-gray-900 leading-tight">{nombre}</h2>

        {/* Indicador de estado fotos */}
        {maxFotos > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex gap-1.5">
              {Array.from({ length: maxFotos }).map((_, i) => (
                <div key={i} className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all"
                  style={{
                    background: arreglo[i] ? G : 'white',
                    borderColor: arreglo[i] ? G : BORD,
                  }}>
                  {arreglo[i] && <Check size={9} color="#fff" strokeWidth={3} />}
                </div>
              ))}
            </div>
            <span className="text-[13px] font-semibold" style={{ color: allDone ? G : '#9CA3AF' }}>
              {allDone
                ? '✓ Fotos listas'
                : `${filled} de ${maxFotos} foto${maxFotos > 1 ? 's' : ''}`}
            </span>
          </div>
        )}
      </div>

      {/* ── FOTOS ── */}
      {maxFotos > 0 && (
        <div className="space-y-3">

          {/* Foto única */}
          {maxFotos === 1 && (
            <>
              <div className="relative rounded-3xl overflow-hidden border-2"
                style={{ aspectRatio: '4/3', borderColor: allDone ? G : BORD }}
                onClick={() => !arreglo[0] && singleRef.current?.click()}>
                <AnimatePresence mode="popLayout">
                  {arreglo[0] ? (
                    <motion.div key="con-foto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0">
                      <img src={URL.createObjectURL(arreglo[0])} alt="Foto cargada"
                        className="w-full h-full object-cover" />
                      {/* Badge de check */}
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.05 }}
                        className="absolute top-3 right-3 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                        style={{ background: G }}>
                        <Check size={24} color="#fff" strokeWidth={3} />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.div key="sin-foto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-5 cursor-pointer"
                      style={{ background: G_LITE }}>
                      <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                        style={{ background: 'white', boxShadow: `0 4px 16px ${G}22` }}>
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

              {/* Botones de acción foto */}
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
              <input ref={singleRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { setFile(0, e.target.files?.[0] || null); e.target.value = '' }} />
            </>
          )}

          {/* Múltiples fotos */}
          {maxFotos > 1 && (
            <>
              <button onClick={() => multiRef.current?.click()}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-[16px] border-2 transition-all"
                style={{
                  borderColor: allDone ? G : G_MID,
                  color: G,
                  background: allDone ? G_LITE : 'white',
                }}>
                <Camera size={22} />
                {filled === 0
                  ? `Agregar hasta ${maxFotos} fotos`
                  : allDone
                    ? `✓ ${maxFotos} fotos cargadas`
                    : `Agregar más fotos (${filled} de ${maxFotos})`}
              </button>
              <input ref={multiRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => {
                  const sel  = Array.from(e.target.files || []).slice(0, maxFotos)
                  const next = [...arreglo]; let slot = 0
                  for (const f of sel) {
                    while (slot < maxFotos && next[slot] !== null) slot++
                    if (slot < maxFotos) { next[slot] = f; slot++ }
                  }
                  onFilesChange(next); e.target.value = ''
                }} />
              {filled > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {arreglo.map((f, idx) => (
                    <div key={idx} className="relative rounded-2xl overflow-hidden border-2"
                      style={{ aspectRatio: '1/1', borderColor: f ? G : BORD }}>
                      {f ? (
                        <>
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                          <div className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ background: G }}>
                            <Check size={16} color="#fff" strokeWidth={3} />
                          </div>
                          <button onClick={() => setFile(idx, null)}
                            className="absolute bottom-2 right-2 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                            Eliminar
                          </button>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer"
                          style={{ background: G_LITE }}
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

      {/* ── CAMPOS DE TEXTO ── */}
      {campos.length > 0 && (
        <div className="bg-white rounded-2xl border p-5 space-y-5" style={{ borderColor: BORD }}>
          {campos.map(campo => (
            <div key={campo.label}>
              <label className="text-[14px] font-bold text-gray-700 block mb-3">
                {campo.label}
                {campo.cantidad > 1 && (
                  <span className="text-[12px] text-gray-400 font-normal ml-1.5">
                    ({campo.cantidad} en total)
                  </span>
                )}
              </label>
              <div className="space-y-3">
                {Array.from({ length: campo.cantidad || 1 }).map((_, i) => (
                  <input key={i} type="text"
                    value={textosVals[campo.label]?.[i] || ''}
                    onChange={e => setTexto(campo.label, i, e.target.value)}
                    placeholder={campo.cantidad > 1 ? `${campo.label} ${i + 1}` : `Escribe aquí…`}
                    className="w-full text-[16px] border-2 rounded-xl px-4 py-3.5 outline-none transition-colors"
                    style={{
                      borderColor: textosVals[campo.label]?.[i]?.trim() ? G : BORD,
                      background: '#FAFCFA',
                    }}
                    onFocus={e => e.target.style.borderColor = G}
                    onBlur={e  => e.target.style.borderColor = textosVals[campo.label]?.[i]?.trim() ? G : BORD}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Opción de no incluir — visible y clara, no un link ── */}
      <div className="rounded-2xl border-2 border-dashed p-4" style={{ borderColor: '#FECACA' }}>
        <p className="text-[14px] text-gray-600 mb-3 font-medium">
          ¿No deseas incluir el <strong>{nombre}</strong>?
        </p>
        <button onClick={onRemover}
          className="w-full py-3.5 rounded-xl font-semibold text-[14px] border-2 transition-all"
          style={{ borderColor: '#FECACA', color: '#DC2626', background: '#FFF5F5' }}>
          No quiero incluir este recordatorio
        </button>
      </div>

    </div>
  )
}

// ── PasoFinal ─────────────────────────────────────────────────────────────────
function PasoFinal({ mascota, items, fotos, textos, removidos, catalogo, extras, setExtras, esCompostaje, anticipados, setAnticipados, comentarios, setComentarios, onGoTo }) {
  const [extAbierto, setExtAbierto] = useState(false)

  return (
    <div className="space-y-5">

      {/* Encabezado */}
      <div className="bg-white rounded-2xl border p-6 text-center" style={{ borderColor: BORD }}>
        <div className="text-5xl mb-3">🌿</div>
        <h2 className="text-[22px] font-bold text-gray-900 mb-1">
          Revisión final para {mascota}
        </h2>
        <p className="text-[14px] text-gray-500 leading-relaxed">
          Revisa que todo esté correcto antes de enviar.
        </p>
      </div>

      {/* Lista de ítems */}
      {items.length > 0 && (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: BORD }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: BORD }}>
            <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: '#9DBD9D' }}>
              Recordatorios
            </p>
          </div>
          {items.map((it, idx) => {
            const rec      = it.recordatorios
            const removido = removidos.has(it.id)
            const maxF     = rec?.max_fotos || 0
            const nF       = (fotos[it.id] || []).filter(Boolean).length
            const campos   = rec?.campos_texto || []
            const tieneT   = campos.length > 0 && Object.values(textos[it.id] || {}).some(a => a.some(v => v?.trim()))
            const listo    = removido || (maxF > 0 ? nF === maxF : tieneT)

            return (
              <div key={it.id}
                className="flex items-center gap-4 px-5 py-4 border-t hover:bg-gray-50 transition-colors"
                style={{ borderColor: BORD }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: removido ? '#F3F4F6' : listo ? G : '#FEF3C7' }}>
                  {removido
                    ? <X size={14} className="text-gray-400" />
                    : listo
                      ? <Check size={16} color="#fff" strokeWidth={3} />
                      : <span className="text-[11px] font-bold text-amber-600">!</span>}
                </div>
                <span className={`flex-1 text-[15px] leading-tight ${removido ? 'line-through text-gray-400' : listo ? 'text-gray-800 font-medium' : 'text-gray-600'}`}>
                  {rec?.nombre}
                  {!removido && maxF > 0 && (
                    <span className="ml-2 text-[12px] font-semibold" style={{ color: nF === maxF ? G : '#F59E0B' }}>
                      {nF}/{maxF} foto{maxF > 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                <button onClick={() => onGoTo(idx)}
                  className="text-[13px] font-bold px-4 py-2 rounded-xl transition-all flex-shrink-0"
                  style={{ background: G_LITE, color: G }}>
                  Editar
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Extras */}
      {catalogo.length > 0 && (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: BORD }}>
          <button className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50"
            onClick={() => setExtAbierto(v => !v)}>
            <div>
              <p className="text-[15px] font-bold text-gray-800">Agregar recordatorios adicionales</p>
              <p className="text-[13px] text-gray-400 mt-0.5">
                {extras.length ? `${extras.length} seleccionado${extras.length > 1 ? 's' : ''}` : 'Opcional · con costo adicional'}
              </p>
            </div>
            <motion.div animate={{ rotate: extAbierto ? 45 : 0 }}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: G_LITE }}>
              <Plus size={18} style={{ color: G }} />
            </motion.div>
          </button>
          <AnimatePresence>
            {extAbierto && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                transition={{ duration: 0.22 }} className="overflow-hidden">
                <div className="border-t" style={{ borderColor: BORD }}>
                  {catalogo.map(rec => {
                    const sel = extras.find(e => e.rec_id === rec.id)
                    return (
                      <div key={rec.id}
                        className="flex items-center gap-4 px-5 py-4 border-t first:border-0"
                        style={{ borderColor: '#F3F4F6' }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] text-gray-800 font-medium">{rec.nombre}</p>
                          {rec.precio_base > 0
                            ? <p className="text-[13px] font-bold mt-0.5" style={{ color: '#C4A87A' }}>+${Number(rec.precio_base).toLocaleString('es-CO')}</p>
                            : <p className="text-[12px] text-gray-400 mt-0.5">Sin costo adicional</p>}
                        </div>
                        <button
                          className="text-[14px] font-bold px-4 py-2.5 rounded-xl border-2 transition-all flex-shrink-0"
                          style={sel
                            ? { background: G, color: '#fff', borderColor: G }
                            : { background: 'white', color: G, borderColor: G_MID }}
                          onClick={() => {
                            if (sel) { setExtras(p => p.filter(e => e.rec_id !== rec.id)); return }
                            const cs = rec.campos_texto || []
                            const nF = rec.requiere_imagen !== false && (rec.max_fotos || 0) > 0 ? rec.max_fotos : 0
                            const ti = {}; cs.forEach(c => { ti[c.label] = Array(c.cantidad || 1).fill('') })
                            setExtras(p => [...p, { rec_id: rec.id, nombre: rec.nombre, files: Array(nF).fill(null), textos: ti, precio_base: rec.precio_base || 0 }])
                          }}>
                          {sel ? '✓ Agregado' : '+ Agregar'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Compostaje */}
      {esCompostaje && (
        <div className="bg-white rounded-2xl border p-5 space-y-4"
          style={{ borderColor: anticipados !== null ? G : BORD }}>
          <div>
            <p className="text-[16px] font-bold text-gray-800">🌱 Proceso de compostaje</p>
            <p className="text-[14px] text-gray-500 mt-1.5 leading-relaxed">
              El proceso dura aproximadamente <strong>2 meses</strong>.<br />
              ¿Cuándo desea recibir los recordatorios?
            </p>
          </div>
          {[
            { val: true,  label: 'Quiero los recordatorios cuanto antes', sub: 'Los elaboramos mientras avanza el proceso.' },
            { val: false, label: 'Prefiero recibirlos todos al final', sub: 'Recibirás todo al término del compostaje.' },
          ].map(opt => (
            <button key={String(opt.val)}
              onClick={() => setAnticipados(opt.val)}
              className="w-full flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all"
              style={{
                borderColor: anticipados === opt.val ? G : BORD,
                background: anticipados === opt.val ? G_LITE : 'white',
              }}>
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

      {/* Indicaciones de diseño */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: BORD }}>
        <label className="text-[16px] font-bold text-gray-800 block mb-1">
          💬 Indicaciones de diseño
          <span className="text-[13px] text-gray-400 font-normal ml-1.5">· opcional</span>
        </label>
        <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
          Cuéntanos indicaciones para tener en cuenta. Nuestro equipo las evaluará y aplicará lo que sea posible.
        </p>
        <textarea value={comentarios} onChange={e => setComentarios(e.target.value)} rows={4}
          placeholder="Escribe aquí tus indicaciones…"
          className="w-full text-[15px] border-2 rounded-xl px-4 py-3.5 outline-none resize-none transition-colors"
          style={{ borderColor: comentarios.trim() ? G : BORD, background: '#FAFCFA' }}
          onFocus={e => e.target.style.borderColor = G}
          onBlur={e  => e.target.style.borderColor = comentarios.trim() ? G : BORD}
        />
      </div>

      <p className="text-center text-[13px] text-gray-400 pb-2 leading-relaxed px-2">
        Al enviar, autorizas el uso de estas fotos para elaborar los recordatorios de {mascota}.
      </p>
    </div>
  )
}

// ── Pantalla de entrada ───────────────────────────────────────────────────────
function EntradaScreen({ cInput, setCInput, onBuscar }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-12" style={{ background: BG }}>
      <div className="w-full max-w-sm">

        <div className="text-center mb-10">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mx-auto mb-5 shadow-lg"
            style={{ background: G }}>🌿</div>
          <h1 className="text-[28px] font-bold text-gray-900">Camino al Cielo</h1>
          <p className="text-[15px] text-gray-500 mt-1.5">Portal para compartir fotos</p>
        </div>

        <div className="bg-white rounded-3xl p-7 shadow-sm border" style={{ borderColor: BORD }}>
          <p className="text-[15px] text-gray-600 mb-6 text-center leading-relaxed">
            Ingresa el código que te enviamos por WhatsApp para comenzar.
          </p>

          <label className="text-[13px] font-bold text-gray-500 block mb-2">
            Código de servicio
          </label>
          <input
            type="text" value={cInput}
            onChange={e => setCInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && onBuscar()}
            placeholder="Ej: ABC12345"
            className="w-full border-2 rounded-2xl px-4 py-4 text-[24px] font-bold text-center tracking-[0.12em] outline-none mb-5 transition-colors"
            style={{ borderColor: cInput.trim() ? G : BORD, background: '#FAFCFA', color: '#1A2E1E' }}
            onFocus={e => e.target.style.borderColor = G}
            onBlur={e  => e.target.style.borderColor = cInput.trim() ? G : BORD}
            autoFocus autoCapitalize="characters"
          />

          <button onClick={onBuscar} disabled={!cInput.trim()}
            className="w-full py-5 rounded-2xl font-bold text-white text-[17px] transition-opacity disabled:opacity-35"
            style={{ background: G }}>
            Continuar →
          </button>
        </div>

        <p className="text-center text-[13px] text-gray-400 mt-6 leading-relaxed">
          ¿No tienes el código?{' '}
          <a href="https://wa.me/573000000000"
            className="font-bold underline underline-offset-2" style={{ color: G }}>
            Escríbenos por WhatsApp
          </a>
        </p>
      </div>
    </div>
  )
}

// ── Pantalla enviado ──────────────────────────────────────────────────────────
function PantallaEnviado({ mascota }) {
  return (
    <Centrado>
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className="w-28 h-28 rounded-3xl flex items-center justify-center text-6xl mb-6 shadow-xl"
        style={{ background: G }}>🌿</motion.div>
      <h1 className="text-[26px] font-bold text-gray-900 mb-3">¡Fotos recibidas!</h1>
      <p className="text-[15px] text-gray-500 leading-relaxed max-w-xs text-center">
        Gracias por compartir las fotos de <strong>{mascota}</strong>.
        <br /><br />
        Nuestro equipo comenzará a trabajar con mucho cariño.
      </p>
      <p className="text-[13px] text-gray-400 mt-6">Puede cerrar esta ventana.</p>
    </Centrado>
  )
}

// ── Info genérica ─────────────────────────────────────────────────────────────
function PantallaInfo({ emoji, titulo, texto, cta }) {
  return (
    <Centrado>
      <div className="text-6xl mb-4">{emoji}</div>
      <h1 className="text-[22px] font-bold text-gray-900 mb-3">{titulo}</h1>
      <p className="text-[15px] text-gray-500 max-w-xs text-center leading-relaxed">{texto}</p>
      {cta && (
        <button onClick={cta.fn}
          className="mt-6 px-8 py-4 rounded-2xl font-bold text-white text-[16px]"
          style={{ background: G }}>{cta.label}</button>
      )}
    </Centrado>
  )
}

function Centrado({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-2" style={{ background: BG }}>
      {children}
    </div>
  )
}
