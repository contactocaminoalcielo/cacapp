// Fotos del establecimiento. Se reducen en el navegador antes de subir (nunca
// se decodifica una foto a resolución completa: en Android eso es un OOM).
import { useEffect, useRef, useState } from 'react'
import { Camera, Star, Trash2, X } from 'lucide-react'
import { crm } from '@/lib/crmApi'
import { prepararArchivo } from '@/lib/whatsappInbox'
import { useConfirm } from '@/contexts/ConfirmContext'

/** Una foto servida por el backend (con sesión), pintada desde un blob. */
export function FotoCrm({ id, mini = true, className = '', alt = '' }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!id) return
    let vivo = true, u = null
    crm.foto(id, mini).then(b => { if (!vivo) return; u = URL.createObjectURL(b); setUrl(u) }).catch(() => {})
    return () => { vivo = false; if (u) URL.revokeObjectURL(u) }
  }, [id, mini])
  if (!url) return <div className={`bg-gray-100 animate-pulse ${className}`} />
  return <img src={url} alt={alt} className={`object-cover ${className}`} />
}

export default function Fotos({ destino, fotos = [], onCambio }) {
  const { confirm } = useConfirm()
  const input = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState(null)
  const [grande, setGrande] = useState(null)

  async function subir(files) {
    setSubiendo(true); setError(null)
    try {
      for (const file of [...files].slice(0, 8)) {
        if (!file.type.startsWith('image/')) continue
        const foto = await prepararArchivo(file, { ladoMax: 1600, calidad: 0.8 })
        const mini = await prepararArchivo(file, { ladoMax: 360, calidad: 0.7 })
        await crm.subirFoto({ ...destino, base64: foto.base64, mime: 'image/jpeg', miniatura: mini.base64, descripcion: null })
      }
      onCambio?.()
    } catch (e) { setError(e.message) } finally { setSubiendo(false); if (input.current) input.current.value = '' }
  }

  async function borrar(f) {
    if (!(await confirm('¿Borrar esta foto?', { title: 'Borrar foto', confirmText: 'Borrar', danger: true }))) return
    await crm.borrarFoto(f.id).catch(e => setError(e.message))
    onCambio?.()
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {fotos.map(f => (
          <div key={f.id} className="relative group aspect-square rounded-xl overflow-hidden border border-gray-100">
            <button className="w-full h-full" onClick={() => setGrande(f.id)}>
              <FotoCrm id={f.id} className="w-full h-full" />
            </button>
            {f.es_portada && <span className="absolute top-1 left-1 text-[10px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded">Portada</span>}
            <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
              {!f.es_portada && (
                <button title="Usar como portada" onClick={() => crm.portadaFoto(f.id).then(onCambio)}
                  className="w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center text-amber-500"><Star size={13} /></button>
              )}
              <button title="Borrar" onClick={() => borrar(f)}
                className="w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center text-red-500"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
        <button onClick={() => input.current?.click()} disabled={subiendo}
          className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-teal-500 hover:text-teal-600 transition">
          {subiendo ? <div className="spinner" /> : <Camera size={20} />}
          <span className="text-[11px] font-semibold">{subiendo ? 'Subiendo…' : 'Agregar fotos'}</span>
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={e => subir(e.target.files)} />
      {error && <div className="text-[12px] text-red-600 mt-2">{error}</div>}
      {grande && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setGrande(null)}>
          <button className="absolute top-4 right-4 text-white"><X size={24} /></button>
          <FotoCrm id={grande} mini={false} className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}
