// Autorizaciones de datos personales — la prueba, a la vista.
//
// Hasta ahora esto solo se podía consultar por SSH y psql. Si una familia
// escribe «¿qué permiso tienen ustedes para tener mis datos?», o llega un
// requerimiento de la SIC, la respuesta tiene que poder darla coordinación sin
// entrar al servidor.
//
// La tabla SOLO se agrega: aquí no hay editar ni borrar, y no los va a haber.
// Revocar es escribir otra fila que apunta a la autorización revocada
// (migración 163), porque hay que poder probar las dos cosas: que autorizó, y
// que después lo retiró.
import { useState, useEffect, useRef } from 'react'
import { ShieldCheck, Search, Ban } from 'lucide-react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db, dbTodo } from '@/lib/supabase'
import { parsearErrorDB } from '@/lib/utils'

// Cómo se nombra cada punto de captura para alguien que no vive en el código.
const ORIGEN = {
  SOLICITUD_CLIENTE: 'Solicitud del cliente',
  SOLICITUD_ALIADO:  'Solicitud desde una veterinaria',
  AFILIACION_ALIADO: 'Afiliación de veterinaria',
  PORTAL_FOTOS:      'Portal de fotos',
  PORTAL_PLANTA:     'Portal de la planta',
  PORTAL_VISITA:     'Portal de la visita',
  REGISTRO_INTERNO:  'Registro interno',
  REVOCACION:        'Revocación',
}

const MEDIO = {
  PORTAL_WEB:             'La marcó el titular',
  DECLARADA_POR_ALIADO:   'La declaró la veterinaria',
  DECLARADA_POR_PERSONAL: 'La declaró el equipo',
}

const fechaHora = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function TabAutorizaciones() {
  const { confirm, alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [guardando, setGuardando] = useState(null)
  const primeraCarga = useRef(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    if (primeraCarga.current) setLoading(true)
    // dbTodo por el tope mudo de 1000 filas del servidor: esta tabla solo crece.
    const d = await dbTodo(() => db.from('autorizaciones_datos')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id'))
    setData(d)
    primeraCarga.current = false
    setLoading(false)
  }

  // Las revocaciones no se listan como filas sueltas: marcan a la que revocan.
  const revocaciones = new Map()
  data.forEach(r => { if (r.revoca_id) revocaciones.set(r.revoca_id, r) })

  const texto = q.trim().toLowerCase()
  const filas = data
    .filter(r => !r.revoca_id)
    .filter(r => !texto || [r.titular_nombre, r.titular_telefono, r.titular_documento, r.titular_email]
      .some(v => String(v || '').toLowerCase().includes(texto)))

  async function revocar(fila) {
    const quien = fila.titular_nombre || 'este titular'
    const ok = await confirm(
      `Se registra que ${quien} retiró su autorización. La autorización original NO se borra: ` +
      'queda con la marca de revocada, porque hay que poder probar las dos cosas.\n\n' +
      'Hazlo solo cuando el titular lo haya pedido.',
      { title: '¿Registrar la revocación?', variant: 'warning', confirmLabel: 'Registrar revocación' }
    )
    if (!ok) return
    setGuardando(fila.id)
    const { error } = await db.from('autorizaciones_datos').insert({
      origen:           'REVOCACION',
      medio:            'DECLARADA_POR_PERSONAL',
      accion:           'REVOCA',
      politica_version: fila.politica_version,
      revoca_id:        fila.id,
      titular_nombre:    fila.titular_nombre,
      titular_documento: fila.titular_documento,
      titular_telefono:  fila.titular_telefono,
      titular_email:     fila.titular_email,
      servicio_id:   fila.servicio_id,
      cliente_id:    fila.cliente_id,
      solicitud_id:  fila.solicitud_id,
      aliado_id:     fila.aliado_id,
      declarada_por: personalData?.id || null,
      notas: 'Revocación registrada desde Gestión a petición del titular.',
    })
    setGuardando(null)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'No se pudo registrar' }); return }
    await cargar()
  }

  return (
    <div>
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Nombre, teléfono, documento…"
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink3 py-2">
          <ShieldCheck size={14} />
          {filas.length} {filas.length === 1 ? 'autorización' : 'autorizaciones'}
        </div>
      </div>

      <p className="text-[11.5px] text-ink3 leading-relaxed mb-4 max-w-2xl">
        Esta es la prueba de que cada titular autorizó el tratamiento de sus datos, y de qué
        versión de la política aceptó. No se edita ni se borra: si alguien retira su
        autorización, se registra encima y las dos quedan.
      </p>

      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead>
            <tr>
              <Th>Cuándo</Th><Th>Titular</Th><Th>Dónde la dio</Th><Th>Cómo</Th>
              <Th>Política</Th><Th>Estado</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {filas.map(r => {
              const rev = revocaciones.get(r.id)
              return (
                <Tr key={r.id}>
                  <Td className="text-ink3 whitespace-nowrap">{fechaHora(r.created_at)}</Td>
                  <Td>
                    <div className="font-semibold text-ink">{r.titular_nombre || '—'}</div>
                    <div className="text-[11px] text-ink3">
                      {[r.titular_documento, r.titular_telefono].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </Td>
                  <Td className="text-ink3">{ORIGEN[r.origen] || r.origen}</Td>
                  <Td className="text-ink3">{MEDIO[r.medio] || r.medio}</Td>
                  <Td className="text-ink3 whitespace-nowrap">v{r.politica_version}</Td>
                  <Td>
                    {rev ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626]">
                        Revocada {fechaHora(rev.created_at)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-light text-primary-dark">
                        Vigente
                      </span>
                    )}
                  </Td>
                  <Td>
                    {!rev && (
                      <Button size="sm" variant="ghost" disabled={guardando === r.id}
                              onClick={() => revocar(r)}>
                        <Ban size={13} /> {guardando === r.id ? 'Registrando…' : 'Revocar'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              )
            })}
            {!filas.length && (
              <Tr>
                <Td colSpan={7} className="text-center text-ink3 py-8">
                  {texto ? 'Nadie con esos datos autorizó todavía.' : 'Todavía no hay autorizaciones registradas.'}
                </Td>
              </Tr>
            )}
          </tbody>
        </Table></TableWrap>
      )}
    </div>
  )
}
