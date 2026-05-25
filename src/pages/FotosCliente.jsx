import { useState, useEffect, useRef } from 'react'
import { db, dbAdmin } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { Camera, Check, ChevronDown, Loader2, Send, X } from 'lucide-react'

const GREEN       = '#3D5A27'
const GREEN_LIGHT = '#E8F3EB'
const GREEN_MID   = '#C5DEC9'
const BG          = '#F4F7F4'
const BORDER      = '#E5EDE5'

export default function FotosCliente({ codigo: codigoProp }) {
  const [fase, setFase]               = useState(codigoProp ? 'cargando' : 'entrada')
  const [codigoInput, setCodigoInput] = useState(codigoProp || '')
  const [servicio, setServicio]       = useState(null)
  const [items, setItems]             = useState([])      // servicio_recordatorios del plan
  const [fotos, setFotos]             = useState({})      // { sr_id: File[] }
  const [textos, setTextos]           = useState({})      // { sr_id: { label: string[] } }
  const [catalogo, setCatalogo]       = useState([])
  const [extras, setExtras]           = useState([])
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false)
  const [guardando, setGuardando]     = useState(false)

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  async function buscar() {
    const cod = codigoInput.trim().toUpperCase()
    if (!cod) return
    setFase('cargando')
    await cargar(cod)
  }

  async function cargar(codigo) {
    try {
      const { data, error } = await db
        .from('servicios')
        .select(`
          id, estado, plan_id,
          mascotas(nombre, especies(nombre)),
          planes(nombre),
          servicio_recordatorios(
            id, origen, estado, imagen_cliente_url, imagenes_cliente_urls,
            recordatorios(id, nombre, solo_nombre, requiere_imagen, max_fotos, campos_texto)
          )
        `)
        .eq('codigo_fotos', codigo)
        .maybeSingle()

      if (error || !data) { setFase('no_encontrado'); return }
      setServicio(data)
      if (data.estado !== 'EN_CUARTO_FRIO') { setFase('ya_procesado'); return }

      const srs = (data.servicio_recordatorios || []).filter(sr => sr.origen !== 'REMOVIDO')
      // Mostrar solo ítems que requieren alguna acción del cliente:
      // - que NO sean solo_nombre
      // - Y que requieran foto O tengan campos de texto
      const itemsConFoto = srs.filter(sr => {
        const rec = sr.recordatorios
        if (!rec || rec.solo_nombre) return false
        const necesitaFoto  = rec.requiere_imagen !== false
        const necesitaTexto = (rec.campos_texto || []).length > 0
        return necesitaFoto || necesitaTexto
      })
      setItems(itemsConFoto)

      // Inicializar fotos (solo para los que requieren imagen)
      const fotosInit = {}
      itemsConFoto.forEach(sr => {
        if (sr.recordatorios?.requiere_imagen !== false)
          fotosInit[sr.id] = Array(sr.recordatorios?.max_fotos || 1).fill(null)
      })
      setFotos(fotosInit)

      // Inicializar textos
      const textosInit = {}
      itemsConFoto.forEach(sr => {
        const campos = sr.recordatorios?.campos_texto || []
        if (campos.length > 0) {
          textosInit[sr.id] = {}
          campos.forEach(c => { textosInit[sr.id][c.label] = Array(c.cantidad || 1).fill('') })
        }
      })
      setTextos(textosInit)

      // Catálogo adicionales
      const existingRecIds = srs.map(sr => sr.recordatorios?.id).filter(Boolean)
      const { data: recs } = await db
        .from('recordatorios')
        .select('id, nombre, solo_nombre, requiere_imagen, max_fotos, precio_base, campos_texto')
        .eq('activo', true)
        .order('nombre')
      setCatalogo((recs || []).filter(r => !existingRecIds.includes(r.id)))

      setFase('form')
    } catch (e) {
      console.error('FotosCliente error:', e)
      setFase('no_encontrado')
    }
  }

  async function guardar() {
    setGuardando(true)
    try {
      // 1. Fotos e ítems del plan
      for (const [srId, files] of Object.entries(fotos)) {
        const validos = (files || []).filter(Boolean)
        const txtData = textos[srId] || {}
        const hasTexto = Object.values(txtData).some(arr => arr.some(v => v?.trim()))
        if (!validos.length && !hasTexto) continue

        const update = {}

        if (validos.length) {
          const urls = []
          for (let i = 0; i < validos.length; i++) {
            const file = validos[i]
            const ext  = file.name.split('.').pop().toLowerCase() || 'jpg'
            const path = `${servicio.id}/${srId}_${i}.${ext}`
            await dbAdmin.storage.from('fotos-clientes').upload(path, file, { upsert: true })
            const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(path)
            urls.push(publicUrl)
          }
          update.imagen_cliente_url    = urls[0]
          update.imagenes_cliente_urls = urls
        }

        if (hasTexto) update.datos_cliente = txtData

        await dbAdmin.from('servicio_recordatorios').update(update).eq('id', srId)
      }

      // 2. Adicionales
      for (const extra of extras) {
        const { data: newSr, error: insErr } = await dbAdmin
          .from('servicio_recordatorios')
          .insert({ servicio_id: servicio.id, recordatorio_id: extra.rec_id, origen: 'ADICIONAL', estado: 'PENDIENTE' })
          .select('id').single()
        if (insErr || !newSr) continue

        const update = {}
        const validos = (extra.files || []).filter(Boolean)
        if (validos.length) {
          const urls = []
          for (let i = 0; i < validos.length; i++) {
            const file = validos[i]
            const ext  = file.name.split('.').pop().toLowerCase() || 'jpg'
            const path = `${servicio.id}/${newSr.id}_${i}.${ext}`
            await dbAdmin.storage.from('fotos-clientes').upload(path, file, { upsert: true })
            const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(path)
            urls.push(publicUrl)
          }
          update.imagen_cliente_url    = urls[0]
          update.imagenes_cliente_urls = urls
        }
        const hasTexto = Object.values(extra.textos || {}).some(arr => arr.some(v => v?.trim()))
        if (hasTexto) update.datos_cliente = extra.textos
        if (Object.keys(update).length) await dbAdmin.from('servicio_recordatorios').update(update).eq('id', newSr.id)
      }

      // 3. Mover a EN_PROCESO
      await dbAdmin.from('servicios').update({
        estado: 'EN_PROCESO',
        fecha_imagenes_recibidas: new Date().toISOString(),
      }).eq('id', servicio.id)

      setFase('enviado')
    } catch (e) {
      alert('Ocurrió un error al enviar. Intenta de nuevo.\n' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  const mascotaNombre   = servicio?.mascotas?.nombre || 'tu mascota'
  const especie         = servicio?.mascotas?.especies?.nombre || ''
  const fotosSubidas    = Object.values(fotos).reduce((a, arr) => a + (arr || []).filter(Boolean).length, 0)
  const fotosRequeridas = items.reduce((a, item) =>
    item.recordatorios?.requiere_imagen !== false ? a + (item.recordatorios?.max_fotos || 1) : a, 0)

  // ── PANTALLA ENTRADA ──────────────────────────────────────────────────────
  if (fase === 'entrada') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10" style={{ background: BG }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-3" style={{ background: GREEN }}>🌿</div>
          <h1 className="text-2xl font-bold text-gray-900">Camino al Cielo</h1>
          <p className="text-sm text-gray-400 mt-1">Portal de fotos · Recordatorios</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border" style={{ borderColor: BORDER }}>
          <p className="text-[13px] text-gray-500 mb-5 text-center leading-relaxed">
            Ingresa el código único que te enviamos por WhatsApp para subir las fotos de los recordatorios.
          </p>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1.5">Código de servicio</label>
          <input
            type="text" value={codigoInput}
            onChange={e => setCodigoInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && buscar()}
            placeholder="Ej: ABC123"
            className="w-full border rounded-xl px-4 py-3 text-xl font-bold text-center tracking-widest outline-none mb-4 transition-all"
            style={{ borderColor: BORDER, background: '#FAFCFA' }}
            autoFocus autoCapitalize="characters"
          />
          <button onClick={buscar} disabled={!codigoInput.trim()}
            className="w-full py-3.5 rounded-xl font-bold text-white text-[15px] transition-opacity disabled:opacity-40"
            style={{ background: GREEN }}>
            Continuar →
          </button>
        </div>
        <p className="text-center text-[11px] text-gray-400 mt-5">
          ¿No tienes el código? Escríbenos por{' '}
          <a href="https://wa.me/573000000000" className="underline" style={{ color: GREEN }}>WhatsApp</a>.
        </p>
      </div>
    </div>
  )

  if (fase === 'cargando') return (
    <Pantalla>
      <Loader2 size={36} className="animate-spin mx-auto" style={{ color: GREEN }} />
      <p className="text-sm text-gray-400 mt-3">Buscando servicio…</p>
    </Pantalla>
  )

  if (fase === 'no_encontrado') return (
    <PantallaInfo emoji="❓" titulo="Código no encontrado"
      mensaje="Verifica el código e intenta de nuevo, o comunícate con nosotros."
      accion={{ label: 'Intentar de nuevo', onClick: () => { setFase('entrada'); setCodigoInput('') } }}
    />
  )

  if (fase === 'ya_procesado') return (
    <PantallaInfo emoji="✅" titulo="¡Ya recibimos las fotos!"
      mensaje={`Las imágenes de ${mascotaNombre} ya fueron registradas y el proceso está en marcha.`}
    />
  )

  if (fase === 'enviado') return (
    <PantallaInfo emoji="🌿" titulo="¡Fotos enviadas con éxito!"
      mensaje={`Gracias por compartir las fotos de ${mascotaNombre}. Iniciaremos la elaboración con mucho cariño.`}
      submensaje="Puedes cerrar esta ventana."
    />
  )

  // ── FORMULARIO ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <header className="bg-white border-b sticky top-0 z-10" style={{ borderColor: BORDER }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ background: GREEN }}>🌿</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 leading-tight">Camino al Cielo</div>
            <div className="text-[11px] text-gray-400">Portal de fotos</div>
          </div>
          <div className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
            style={{ background: fotosSubidas >= fotosRequeridas && fotosRequeridas > 0 ? GREEN_LIGHT : '#F3F4F6', color: fotosSubidas >= fotosRequeridas && fotosRequeridas > 0 ? GREEN : '#9CA3AF' }}>
            {fotosSubidas}/{fotosRequeridas} fotos
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 py-5 space-y-5">

        {/* Hero */}
        <div className="bg-white rounded-2xl p-4 border shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-4">
            <div className="text-4xl leading-none">{petEmoji(especie)}</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{mascotaNombre}</h1>
              <div className="inline-flex mt-0.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: GREEN_LIGHT, color: GREEN }}>
                {servicio?.planes?.nombre}
              </div>
            </div>
          </div>
          {items.length > 0 && (
            <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
              Sube las fotos y completa los textos de cada recordatorio de <strong>{mascotaNombre}</strong>.
            </p>
          )}
        </div>

        {/* Grid de recordatorios del plan */}
        {items.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider px-1 mb-3" style={{ color: '#7A9880' }}>
              Recordatorios incluidos en tu plan
            </p>
            <div className="grid grid-cols-2 gap-3">
              {items.map(item => {
                const campos        = item.recordatorios?.campos_texto || []
                const requiereImg   = item.recordatorios?.requiere_imagen !== false
                const esAmplio      = campos.length > 0 || (requiereImg && (item.recordatorios?.max_fotos || 1) > 3)
                return (
                  <div key={item.id} className={esAmplio ? 'col-span-2' : ''}>
                    <ItemCard
                      nombre={item.recordatorios?.nombre || 'Recordatorio'}
                      maxFotos={requiereImg ? (item.recordatorios?.max_fotos || 1) : 0}
                      camposTexto={campos}
                      files={fotos[item.id] || []}
                      textosValues={textos[item.id] || {}}
                      onFilesChange={files => setFotos(prev => ({ ...prev, [item.id]: files }))}
                      onTextosChange={vals => setTextos(prev => ({ ...prev, [item.id]: vals }))}
                      amplio={esAmplio}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div className="bg-white rounded-2xl p-5 text-center border" style={{ borderColor: BORDER }}>
            <div className="text-3xl mb-2">📋</div>
            <p className="text-sm font-medium text-gray-700">Este plan no requiere fotos específicas.</p>
          </div>
        )}

        {/* Adicionales */}
        {catalogo.length > 0 && (
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: BORDER }}>
            <button className="w-full flex items-center justify-between px-4 py-4 text-left transition-colors hover:bg-gray-50"
              onClick={() => setMostrarCatalogo(v => !v)}>
              <div>
                <div className="text-[13px] font-semibold text-gray-800">Agregar recordatorios adicionales</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {extras.length > 0 ? `${extras.length} seleccionado${extras.length > 1 ? 's' : ''}` : 'Opcional — con costo adicional'}
                </div>
              </div>
              <ChevronDown size={18} className="text-gray-400 flex-shrink-0 transition-transform duration-200"
                style={{ transform: mostrarCatalogo ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>

            {mostrarCatalogo && (
              <div className="border-t" style={{ borderColor: '#F3F4F6' }}>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {catalogo.map(rec => {
                    const sel = extras.find(e => e.rec_id === rec.id)
                    return (
                      <div key={rec.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-gray-700 font-medium leading-tight">{rec.nombre}</div>
                          {rec.precio_base > 0
                            ? <div className="text-[11px] font-bold mt-0.5" style={{ color: '#C4A87A' }}>+${Number(rec.precio_base).toLocaleString('es-CO')}</div>
                            : <div className="text-[11px] text-gray-400 mt-0.5">Sin costo adicional</div>
                          }
                        </div>
                        <button
                          className="text-[11px] font-bold px-3 py-1 rounded-full border transition-all ml-3 flex-shrink-0"
                          style={sel ? { background: GREEN, color: '#fff', borderColor: GREEN } : { background: BG, color: GREEN, borderColor: GREEN_MID }}
                          onClick={() => {
                            if (sel) {
                              setExtras(prev => prev.filter(e => e.rec_id !== rec.id))
                            } else {
                              const campos      = rec.campos_texto || []
                              const reqImg      = rec.requiere_imagen !== false
                              const nFotos      = reqImg ? (rec.max_fotos || 1) : 0
                              const textosInit  = {}
                              campos.forEach(c => { textosInit[c.label] = Array(c.cantidad || 1).fill('') })
                              setExtras(prev => [...prev, {
                                rec_id: rec.id, nombre: rec.nombre,
                                solo_nombre: rec.solo_nombre,
                                requiere_imagen: reqImg,
                                max_fotos: nFotos,
                                campos_texto: campos,
                                precio_base: rec.precio_base || 0,
                                files: Array(nFotos).fill(null),
                                textos: textosInit,
                              }])
                            }
                          }}
                        >
                          {sel ? '✓ Agregado' : '+ Agregar'}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {extras.filter(e => !e.solo_nombre).length > 0 && (
                  <div className="px-3 pb-4 pt-1 border-t" style={{ borderColor: '#F3F4F6' }}>
                    <p className="text-[11px] font-semibold py-3" style={{ color: '#7A9880' }}>Fotos y datos de los adicionales:</p>
                    <div className="grid grid-cols-2 gap-3">
                      {extras.filter(e => !e.solo_nombre).map(extra => {
                        const esAmplio = extra.campos_texto?.length > 0 || (extra.max_fotos > 3)
                        return (
                          <div key={extra.rec_id} className={esAmplio ? 'col-span-2' : ''}>
                            <ItemCard
                              nombre={extra.nombre}
                              maxFotos={extra.max_fotos}   // ya viene 0 si no requiere imagen
                              camposTexto={extra.campos_texto || []}
                              files={extra.files}
                              textosValues={extra.textos || {}}
                              onFilesChange={files => setExtras(prev => prev.map(e => e.rec_id === extra.rec_id ? { ...e, files } : e))}
                              onTextosChange={vals => setExtras(prev => prev.map(e => e.rec_id === extra.rec_id ? { ...e, textos: vals } : e))}
                              amplio={esAmplio}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Botón enviar */}
        <button onClick={guardar} disabled={guardando}
          className="w-full py-4 rounded-2xl font-bold text-white text-[15px] flex items-center justify-center gap-2.5 shadow-sm transition-opacity disabled:opacity-60"
          style={{ background: GREEN }}>
          {guardando ? <><Loader2 size={18} className="animate-spin" /> Enviando…</> : <><Send size={16} /> Enviar fotos y textos</>}
        </button>

        <p className="text-center text-[11px] text-gray-400 pb-4">
          Al enviar, autorizas el uso de estas imágenes para la elaboración de los recordatorios.
        </p>
      </main>

      <footer className="text-center text-[11px] py-5 border-t" style={{ color: GREEN_MID, borderColor: BORDER }}>
        Camino al Cielo © {new Date().getFullYear()}
      </footer>
    </div>
  )
}

// ── ItemCard ──────────────────────────────────────────────────────────────────
function ItemCard({ nombre, maxFotos, camposTexto = [], files, textosValues = {}, onFilesChange, onTextosChange, amplio }) {
  const inputRefs   = useRef([])
  const requiereImg = maxFotos > 0
  const n           = requiereImg ? Math.max(1, maxFotos) : 0
  const arreglo     = Array.from({ length: n }, (_, i) => files?.[i] ?? null)
  const filled      = arreglo.filter(Boolean).length
  const allFilled   = requiereImg ? filled === n : true
  const hasCampos   = camposTexto.length > 0

  function setFile(idx, file) {
    const next = [...arreglo]; next[idx] = file; onFilesChange(next)
  }

  function setTexto(label, idx, val) {
    const arr = [...(textosValues[label] || Array(camposTexto.find(c => c.label === label)?.cantidad || 1).fill(''))]
    arr[idx] = val
    onTextosChange({ ...textosValues, [label]: arr })
  }

  // columnas de fotos según contexto
  const fotoCols = amplio
    ? (n <= 2 ? `grid-cols-${n}` : n <= 4 ? 'grid-cols-4' : 'grid-cols-5')
    : (n === 1 ? '' : 'grid-cols-2')

  return (
    <div className="bg-white rounded-xl border p-3 flex flex-col gap-2.5 transition-all"
      style={{ borderColor: allFilled && hasCampos ? '#86EFAC' : BORDER, boxShadow: allFilled && hasCampos ? '0 0 0 1px #86EFAC' : 'none' }}>

      {/* Nombre + check */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[12px] font-bold text-gray-700 leading-tight flex-1">{nombre}</span>
        {requiereImg && (
          allFilled
            ? <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: GREEN }}>
                <Check size={9} color="#fff" />
              </div>
            : n > 1 && <span className="text-[9px] font-bold flex-shrink-0" style={{ color: filled > 0 ? GREEN : '#9CA3AF' }}>{filled}/{n}</span>
        )}
      </div>

      {/* Slots de fotos — solo si requiere imagen */}
      {requiereImg && (
        <div className={n > 1 || amplio ? `grid ${fotoCols} gap-1.5` : ''}>
          {arreglo.map((file, idx) => (
            <div key={idx} className="relative rounded-lg overflow-hidden bg-gray-50"
              style={{ aspectRatio: amplio && n === 1 ? '16/9' : n === 1 ? '4/3' : '1/1' }}>
              {file ? (
                <>
                  <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => setFile(idx, null)}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center shadow"
                    style={{ background: 'rgba(0,0,0,0.55)' }}>
                    <X size={8} color="#fff" />
                  </button>
                  {n > 1 && (
                    <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-white px-1 rounded"
                      style={{ background: 'rgba(0,0,0,0.4)' }}>{idx + 1}</div>
                  )}
                </>
              ) : (
                <button onClick={() => inputRefs.current[idx]?.click()}
                  className="w-full h-full flex flex-col items-center justify-center gap-0.5 border-2 border-dashed rounded-lg transition-colors hover:bg-gray-100 active:bg-gray-200"
                  style={{ borderColor: GREEN_MID }}>
                  <Camera size={amplio ? 22 : n === 1 ? 18 : 14} style={{ color: GREEN }} />
                  {n > 1 && <span className="text-[8px] font-bold" style={{ color: GREEN }}>{idx + 1}</span>}
                </button>
              )}
              <input ref={el => inputRefs.current[idx] = el}
                type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { setFile(idx, e.target.files?.[0] || null); e.target.value = '' }} />
            </div>
          ))}
        </div>
      )}

      {/* Campos de texto */}
      {hasCampos && (
        <div className="border-t pt-2.5 space-y-3" style={{ borderColor: '#F0F0F0' }}>
          {camposTexto.map(campo => (
            <div key={campo.label}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#7A9880' }}>
                {campo.label} {campo.cantidad > 1 ? `(${campo.cantidad})` : ''}
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: campo.cantidad || 1 }).map((_, i) => (
                  <input
                    key={i}
                    type="text"
                    value={textosValues[campo.label]?.[i] || ''}
                    onChange={e => setTexto(campo.label, i, e.target.value)}
                    placeholder={campo.cantidad > 1 ? `${campo.label} ${i + 1}` : campo.label}
                    className="w-full text-[12px] border rounded-lg px-3 py-2 outline-none transition-all"
                    style={{ borderColor: textosValues[campo.label]?.[i]?.trim() ? '#86EFAC' : BORDER, background: '#FAFCFA' }}
                    onFocus={e => e.target.style.borderColor = GREEN}
                    onBlur={e => e.target.style.borderColor = textosValues[campo.label]?.[i]?.trim() ? '#86EFAC' : BORDER}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Pantalla({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6" style={{ background: BG }}>
      {children}
    </div>
  )
}

function PantallaInfo({ emoji, titulo, mensaje, submensaje, accion }) {
  return (
    <Pantalla>
      <div className="text-6xl mb-5">{emoji}</div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">{titulo}</h1>
      <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{mensaje}</p>
      {submensaje && <p className="text-xs text-gray-400 mt-3">{submensaje}</p>}
      {accion && (
        <button onClick={accion.onClick} className="mt-6 px-6 py-2.5 rounded-xl font-bold text-white text-[13px]" style={{ background: GREEN }}>
          {accion.label}
        </button>
      )}
      <div className="mt-10 text-xs" style={{ color: GREEN_MID }}>Camino al Cielo</div>
    </Pantalla>
  )
}
