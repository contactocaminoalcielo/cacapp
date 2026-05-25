import { useState, useEffect, useRef } from 'react'
import { db, dbAdmin } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { Camera, Check, ChevronDown, Loader2, Send } from 'lucide-react'

export default function FotosCliente({ codigo }) {
  const [fase, setFase] = useState('cargando') // cargando | form | enviado | ya_procesado | no_encontrado
  const [servicio, setServicio] = useState(null)
  const [items, setItems] = useState([])        // servicio_recordatorios que necesitan foto
  const [fotos, setFotos] = useState({})        // { sr_id: File }
  const [catalogo, setCatalogo] = useState([])  // recordatorios disponibles para agregar
  const [extras, setExtras] = useState([])      // { rec_id, nombre, solo_nombre, file }
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { if (codigo) cargar() }, [codigo])

  async function cargar() {
    if (!codigo?.trim()) { setFase('no_encontrado'); return }
    try {
      const { data, error } = await db
        .from('servicios')
        .select(`
          id, estado, plan_id,
          mascotas(nombre, especies(nombre)),
          planes(nombre),
          servicio_recordatorios(
            id, origen, estado, imagen_cliente_url,
            recordatorios(id, nombre, solo_nombre)
          )
        `)
        .eq('codigo_fotos', codigo.trim().toUpperCase())
        .maybeSingle()

      if (error || !data) { console.error('FotosCliente error:', error); setFase('no_encontrado'); return }

      setServicio(data)

      if (data.estado !== 'EN_CUARTO_FRIO') { setFase('ya_procesado'); return }

      const srs = (data.servicio_recordatorios || []).filter(sr => sr.origen !== 'REMOVIDO')
      setItems(srs.filter(sr => !sr.recordatorios?.solo_nombre))

      const existingRecIds = srs.map(sr => sr.recordatorios?.id).filter(Boolean)
      const { data: recs } = await db
        .from('recordatorios')
        .select('id, nombre, solo_nombre')
        .order('nombre')
      setCatalogo((recs || []).filter(r => !existingRecIds.includes(r.id)))

      setFase('form')
    } catch {
      setFase('no_encontrado')
    }
  }

  async function guardar() {
    setGuardando(true)
    try {
      // 1. Subir fotos de ítems existentes
      for (const [srId, file] of Object.entries(fotos)) {
        if (!file) continue
        const ext = file.name.split('.').pop().toLowerCase() || 'jpg'
        const path = `${servicio.id}/${srId}.${ext}`
        await dbAdmin.storage.from('fotos-clientes').upload(path, file, { upsert: true })
        const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(path)
        await dbAdmin.from('servicio_recordatorios')
          .update({ imagen_cliente_url: publicUrl })
          .eq('id', srId)
      }

      // 2. Insertar extras y subir sus fotos
      for (const extra of extras) {
        const { data: newSr, error: insErr } = await dbAdmin
          .from('servicio_recordatorios')
          .insert({
            servicio_id: servicio.id,
            recordatorio_id: extra.rec_id,
            origen: 'ADICIONAL',
            estado: 'PENDIENTE',
          })
          .select('id')
          .single()

        if (insErr) continue

        if (extra.file && newSr) {
          const ext = extra.file.name.split('.').pop().toLowerCase() || 'jpg'
          const path = `${servicio.id}/${newSr.id}.${ext}`
          await dbAdmin.storage.from('fotos-clientes').upload(path, extra.file, { upsert: true })
          const { data: { publicUrl } } = dbAdmin.storage.from('fotos-clientes').getPublicUrl(path)
          await dbAdmin.from('servicio_recordatorios')
            .update({ imagen_cliente_url: publicUrl })
            .eq('id', newSr.id)
        }
      }

      // 3. Mover servicio a EN_PROCESO
      await dbAdmin.from('servicios').update({
        estado: 'EN_PROCESO',
        fecha_imagenes_recibidas: new Date().toISOString(),
      }).eq('id', servicio.id)

      setFase('enviado')
    } catch (e) {
      alert('Ocurrió un error al enviar. Por favor intenta de nuevo.\n' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  const mascotaNombre = servicio?.mascotas?.nombre || 'tu mascota'
  const especie = servicio?.mascotas?.especies?.nombre || ''
  const fotosSubidas = Object.values(fotos).filter(Boolean).length

  // ── Pantallas de estado ───────────────────────────────────────────────────
  if (fase === 'cargando') return (
    <Pantalla>
      <Loader2 size={36} className="animate-spin mx-auto" style={{ color: '#3D5A27' }} />
      <p className="text-sm text-gray-400 mt-3">Cargando…</p>
    </Pantalla>
  )

  if (fase === 'no_encontrado') return (
    <PantallaInfo
      emoji="❓"
      titulo="Enlace no válido"
      mensaje="El código no fue encontrado o ha expirado. Comunícate con Camino al Cielo para recibir un nuevo enlace."
    />
  )

  if (fase === 'ya_procesado') return (
    <PantallaInfo
      emoji="✅"
      titulo="¡Ya recibimos las fotos!"
      mensaje={`Las imágenes de ${mascotaNombre} ya fueron registradas y el proceso está en marcha. Pronto nos pondremos en contacto contigo.`}
    />
  )

  if (fase === 'enviado') return (
    <PantallaInfo
      emoji="🌿"
      titulo="¡Fotos enviadas con éxito!"
      mensaje={`Gracias por compartir las fotos de ${mascotaNombre}. Iniciaremos la elaboración de los recordatorios con mucho cariño. Te mantendremos informado.`}
      submensaje="Puedes cerrar esta ventana."
    />
  )

  // ── Formulario ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: '#F4F7F4' }}>
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10" style={{ borderColor: '#E5EDE5' }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{ background: '#3D5A27' }}>🌿</div>
          <div>
            <div className="text-sm font-bold text-gray-900 leading-tight">Camino al Cielo</div>
            <div className="text-[11px] text-gray-400">Portal de fotos para recordatorios</div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Hero */}
        <div className="bg-white rounded-2xl p-5 border shadow-sm" style={{ borderColor: '#E5EDE5' }}>
          <div className="flex items-center gap-4">
            <div className="text-5xl">{petEmoji(especie)}</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{mascotaNombre}</h1>
              <div className="inline-flex mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: '#E8F3EB', color: '#3D5A27' }}>
                {servicio?.planes?.nombre}
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-4 leading-relaxed">
            Para iniciar la elaboración de los recordatorios de <strong>{mascotaNombre}</strong>,
            por favor comparte las fotos a continuación. Cada recordatorio tiene su propio espacio.
          </p>
        </div>

        {/* Fotos requeridas */}
        {items.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#7A9880' }}>
                Fotos para los recordatorios
              </p>
              <span className="text-[11px]" style={{ color: fotosSubidas === items.length ? '#3D5A27' : '#9CA3AF' }}>
                {fotosSubidas}/{items.length}
              </span>
            </div>
            {items.map(item => (
              <ItemUploadCard
                key={item.id}
                nombre={item.recordatorios?.nombre || 'Recordatorio'}
                file={fotos[item.id]}
                onChange={f => setFotos(prev => ({ ...prev, [item.id]: f }))}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-5 text-center border" style={{ borderColor: '#E5EDE5' }}>
            <div className="text-3xl mb-2">📋</div>
            <p className="text-sm font-medium text-gray-700">Este plan no requiere fotos específicas.</p>
            <p className="text-xs text-gray-400 mt-1">Puedes agregar recordatorios adicionales si lo deseas.</p>
          </div>
        )}

        {/* Recordatorios adicionales */}
        {catalogo.length > 0 && (
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: '#E5EDE5' }}>
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50"
              onClick={() => setMostrarCatalogo(v => !v)}
            >
              <div>
                <div className="text-sm font-semibold text-gray-800">Agregar recordatorios adicionales</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {extras.length > 0
                    ? `${extras.length} seleccionado${extras.length > 1 ? 's' : ''}`
                    : 'Opcional — personaliza aún más el servicio'}
                </div>
              </div>
              <ChevronDown
                size={18}
                className="text-gray-400 flex-shrink-0 transition-transform duration-200"
                style={{ transform: mostrarCatalogo ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {mostrarCatalogo && (
              <div className="border-t" style={{ borderColor: '#F3F4F6' }}>
                {/* Lista del catálogo */}
                <div className="max-h-64 overflow-y-auto divide-y" style={{ divideColor: '#F9FAFB' }}>
                  {catalogo.map(rec => {
                    const sel = extras.find(e => e.rec_id === rec.id)
                    return (
                      <div key={rec.id} className="flex items-center justify-between px-5 py-3">
                        <span className="text-[13px] text-gray-700">{rec.nombre}</span>
                        <button
                          className="text-[11px] font-bold px-3 py-1 rounded-full border transition-all ml-3 flex-shrink-0"
                          style={sel
                            ? { background: '#3D5A27', color: '#fff', borderColor: '#3D5A27' }
                            : { background: '#F4F7F4', color: '#3D5A27', borderColor: '#C5DEC9' }}
                          onClick={() => {
                            if (sel) {
                              setExtras(prev => prev.filter(e => e.rec_id !== rec.id))
                            } else {
                              setExtras(prev => [...prev, {
                                rec_id: rec.id, nombre: rec.nombre,
                                solo_nombre: rec.solo_nombre, file: null,
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

                {/* Slots de foto para extras seleccionados */}
                {extras.filter(e => !e.solo_nombre).length > 0 && (
                  <div className="px-5 pb-5 pt-1 space-y-3 border-t" style={{ borderColor: '#F3F4F6' }}>
                    <p className="text-[11px] font-semibold pt-3" style={{ color: '#7A9880' }}>
                      Fotos para los recordatorios agregados:
                    </p>
                    {extras.filter(e => !e.solo_nombre).map(extra => (
                      <ItemUploadCard
                        key={extra.rec_id}
                        nombre={extra.nombre}
                        file={extra.file}
                        onChange={f => setExtras(prev =>
                          prev.map(e => e.rec_id === extra.rec_id ? { ...e, file: f } : e)
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Botón enviar */}
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full py-4 rounded-2xl font-bold text-white text-[15px] flex items-center justify-center gap-2.5 shadow-sm transition-opacity disabled:opacity-60"
          style={{ background: '#3D5A27' }}
        >
          {guardando
            ? <><Loader2 size={18} className="animate-spin" /> Enviando…</>
            : <><Send size={16} /> Enviar fotos</>}
        </button>

        <p className="text-center text-[11px] text-gray-400 pb-4">
          Al enviar, autorizas el uso de estas imágenes para la elaboración de los recordatorios.
        </p>
      </main>

      <footer className="text-center text-[11px] py-5 border-t" style={{ color: '#C5DEC9', borderColor: '#E5EDE5' }}>
        Camino al Cielo © {new Date().getFullYear()}
      </footer>
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function ItemUploadCard({ nombre, file, onChange }) {
  const inputRef = useRef(null)
  return (
    <div
      className="bg-white rounded-xl border p-4 transition-all"
      style={{ borderColor: file ? '#86EFAC' : '#E5EDE5' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-gray-800">{nombre}</div>
          {file ? (
            <div className="flex items-center gap-3 mt-2.5">
              <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-500 truncate">{file.name}</div>
                <button
                  className="text-[11px] font-medium mt-1"
                  style={{ color: '#DC2626' }}
                  onClick={() => { if (inputRef.current) inputRef.current.value = ''; onChange(null) }}
                >
                  Cambiar foto
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2.5 inline-flex items-center gap-2 text-[12px] font-semibold px-4 py-2 rounded-xl border-2 border-dashed transition-colors hover:bg-gray-50"
              style={{ borderColor: '#C5DEC9', color: '#3D5A27' }}
            >
              <Camera size={14} />
              Subir foto
            </button>
          )}
        </div>
        {file && (
          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#3D5A27' }}>
            <Check size={13} color="#fff" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => onChange(e.target.files?.[0] || null)}
      />
    </div>
  )
}

function Pantalla({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6"
      style={{ background: '#F4F7F4' }}>
      {children}
    </div>
  )
}

function PantallaInfo({ emoji, titulo, mensaje, submensaje }) {
  return (
    <Pantalla>
      <div className="text-6xl mb-5">{emoji}</div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">{titulo}</h1>
      <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{mensaje}</p>
      {submensaje && <p className="text-xs text-gray-400 mt-3">{submensaje}</p>}
      <div className="mt-10 text-xs" style={{ color: '#C5DEC9' }}>Camino al Cielo</div>
    </Pantalla>
  )
}
