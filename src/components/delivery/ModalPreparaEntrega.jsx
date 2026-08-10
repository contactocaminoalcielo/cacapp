import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { fmt, waLink } from '@/lib/utils'
import { crearNotificacion } from '@/lib/notificaciones'
import { generarCertificadoEntrega } from '@/lib/certificadoEntrega'
import { X, Truck, MapPin, User, Calendar, MessageCircle, Download, Check, AlertCircle } from 'lucide-react'
import { esAliadoVip, VipBadge } from '@/components/servicio/VipAliado'

export default function ModalPreparaEntrega({ servicioId, onClose, onGuardado }) {
  const { personalData: yo } = useAuth()
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [genCert,    setGenCert]    = useState(false)
  const [error,      setError]      = useState(null)
  const [ok,         setOk]         = useState(false)
  const [publicado,  setPublicado]  = useState(false)

  // Datos cargados (fuente de verdad para los auto-fills)
  const [svc,        setSvc]        = useState(null)
  const [entrega,    setEntrega]    = useState(null)
  const [items,      setItems]      = useState([])
  const [mensajeros, setMensajeros] = useState([])

  // Formulario
  const [tipoEntrega,      setTipoEntrega]      = useState('DOMICILIO')
  const [direccionEntrega, setDireccionEntrega] = useState('')
  const [ciudad,           setCiudad]           = useState('')
  const [barrio,           setBarrio]           = useState('')
  const [localidad,        setLocalidad]        = useState('')
  const [indicaciones,     setIndicaciones]     = useState('')
  const [contactoNombre,   setContactoNombre]   = useState('')
  const [contactoTelefono, setContactoTelefono] = useState('')
  const [telefonoAdicional,setTelefonoAdicional]= useState('')
  const [horarios,         setHorarios]         = useState('')
  const [fechaProg,        setFechaProg]        = useState('')
  const [notas,            setNotas]            = useState('')
  const [mensajeroId,      setMensajeroId]      = useState('')

  useEffect(() => { cargar() }, [servicioId])

  // Nombre de quien la tiene (la tomó del pool o se la asignaron)
  const tomadaPor = (() => {
    const m = mensajeros.find(x => x.id === entrega?.mensajero_id)
    return m ? `${m.nombre} ${m.apellido}`.trim() : null
  })()

  // ── Rellena todos los campos de dirección/contacto según el tipo ────────────
  // svcData: datos del servicio (con mascotas.clientes y aliados)
  // entData: entrega existente (null = primera vez, rellena desde la fuente)
  function fillFromTipo(tipo, svcData, entData) {
    const cli = svcData?.mascotas?.clientes
    const al  = svcData?.aliados
    // Datos que el cliente dejó en el portal de fotos (prefill para domicilio).
    const dc  = svcData?.datos_entrega_cliente || {}

    if (tipo === 'DOMICILIO') {
      const recDir = svcData?.punto_recogida !== 'CLINICA_ALIADA'
        ? (svcData?.direccion_recogida || '') : ''
      setDireccionEntrega (entData?.direccion_entrega  || dc.direccion || cli?.direccion || recDir)
      setCiudad           (entData?.ciudad             || cli?.ciudad    || svcData?.ciudad_recogida || '')
      setBarrio           (entData?.barrio             || dc.barrio || svcData?.barrio_recogida || '')
      setLocalidad        (entData?.localidad          || dc.localidad || '')
      setIndicaciones     (entData?.indicaciones       || svcData?.indicaciones_recogida || '')
      setContactoNombre   (entData?.contacto_nombre    || dc.recibe || (cli ? `${cli.nombre || ''} ${cli.apellido || ''}`.trim() : ''))
      setContactoTelefono (entData?.contacto_telefono  || dc.telefono || cli?.whatsapp || cli?.telefono || '')
      setTelefonoAdicional(entData?.telefono_adicional || dc.telefono_adicional || '')
      setHorarios         (entData?.horarios_atencion  || dc.horarios || '')

    } else if (tipo === 'ALIADO') {
      setDireccionEntrega (entData?.direccion_entrega  || al?.direccion || '')
      setCiudad           (entData?.ciudad             || al?.ciudad    || '')
      setBarrio           (entData?.barrio             || al?.barrio    || '')
      setLocalidad        (entData?.localidad          || al?.localidad || '')
      setIndicaciones     (entData?.indicaciones       || (al ? `Entregar en ${al.nombre}` : ''))
      setContactoNombre   (entData?.contacto_nombre    || al?.contacto_nombre  || '')
      setContactoTelefono (entData?.contacto_telefono  || al?.whatsapp || al?.telefono || '')
      setTelefonoAdicional(entData?.telefono_adicional || '')
      setHorarios         (entData?.horarios_atencion  || '')

    } else if (tipo === 'PRESENCIAL') {
      setDireccionEntrega (entData?.direccion_entrega  || 'Sede Camino al Cielo')
      setCiudad           (entData?.ciudad             || 'Bogotá')
      setBarrio           (entData?.barrio             || '')
      setLocalidad        (entData?.localidad          || '')
      setIndicaciones     (entData?.indicaciones       || '')
      setContactoNombre   (entData?.contacto_nombre    || '')
      setContactoTelefono (entData?.contacto_telefono  || '')
      setTelefonoAdicional(entData?.telefono_adicional || '')
      setHorarios         (entData?.horarios_atencion  || '')
    }
  }

  // ── Cambio manual de tipo por el usuario ────────────────────────────────────
  // Al cambiar tipo manualmente, siempre rellena desde la fuente (sin entData)
  function handleCambiarTipo(tipo) {
    setTipoEntrega(tipo)
    fillFromTipo(tipo, svc, null)
  }

  async function cargar() {
    setLoading(true)
    try {
      const [{ data: svcRaw, error: e1 }, { data: entData }, { data: itmsData }, { data: persData }] = await Promise.all([
        db.from('servicios').select(
          'id, fecha_ingreso, fecha_listo, valor_total, valor_pagado, estado_pago, metodo_pago, ' +
          'direccion_recogida, barrio_recogida, ciudad_recogida, indicaciones_recogida, ' +
          'punto_recogida, mascota_id, plan_id, aliado_origen_id, ' +
          'datos_entrega_cliente, datos_entrega_recibidos_en'
        ).eq('id', servicioId).single(),
        db.from('entregas').select('*').eq('servicio_id', servicioId).maybeSingle(),
        db.from('servicio_recordatorios')
          .select('id, estado, origen, precio_cobrado, recordatorios(nombre, categoria)')
          .eq('servicio_id', servicioId).neq('origen', 'REMOVIDO'),
        db.from('personal').select('id, nombre, apellido, rol_principal_id')
          .eq('activo', true).in('rol_principal_id', [2, 3]).order('nombre'),
      ])
      if (e1) throw e1

      // Mascota
      let mascotaData = null
      if (svcRaw?.mascota_id) {
        const { data: m } = await db.from('mascotas')
          .select('id_mascota, nombre, peso_kg, cliente_id, especies(nombre)')
          .eq('id_mascota', svcRaw.mascota_id).maybeSingle()
        mascotaData = m
      }

      // Cliente
      let clienteData = null
      if (mascotaData?.cliente_id) {
        const { data: c } = await db.from('clientes')
          .select('nombre, apellido, email, telefono, whatsapp, direccion, ciudad')
          .eq('id_cliente', mascotaData.cliente_id).maybeSingle()
        clienteData = c
      }

      // Plan y aliado en paralelo
      const [{ data: planData }, { data: aliadoData }] = await Promise.all([
        svcRaw?.plan_id
          ? db.from('planes').select('nombre, codigo').eq('id', svcRaw.plan_id).maybeSingle()
          : Promise.resolve({ data: null }),
        svcRaw?.aliado_origen_id
          ? db.from('aliados')
              .select('id_aliado, nombre, direccion, barrio, localidad, ciudad, contacto_nombre, whatsapp, telefono, vip')
              .eq('id_aliado', svcRaw.aliado_origen_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const svcData = {
        ...svcRaw,
        mascotas: mascotaData ? { ...mascotaData, clientes: clienteData } : null,
        planes:   planData,
        aliados:  aliadoData,
      }

      setSvc(svcData)
      setEntrega(entData)
      setItems(itmsData || [])
      setMensajeros(persData || [])

      // Determinar tipo: primero lo guardado, luego inferir del servicio
      const tipo = entData?.tipo_entrega
        || (svcRaw?.punto_recogida === 'CLINICA_ALIADA' && aliadoData ? 'ALIADO' : 'DOMICILIO')
      setTipoEntrega(tipo)

      // Rellenar campos según tipo y datos guardados
      fillFromTipo(tipo, svcData, entData || null)

      // Resto de campos no relacionados al tipo
      if (entData) {
        setNotas(entData.notas || '')
        setMensajeroId(entData.mensajero_id || '')
        if (entData.fecha_programada) setFechaProg(entData.fecha_programada)
      }

    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Dos vías (decisión David 2026-07-31):
  //   publicar → al pool: la ven todos los mensajeros/técnicos y la toma quien pueda
  //   asignar  → directo a una persona, como siempre
  // La entrega ya tomada por alguien no se puede re-publicar sin quitársela: eso
  // se hace cambiando el mensajero a mano.
  async function guardar({ publicar } = { publicar: false }) {
    if (!publicar && !mensajeroId) { setError('Elige a quién se la asignas, o publícala para que la tomen'); return }
    // Una entrega que ya salió (o se hizo) no se re-publica ni se reasigna desde
    // aquí: se le quitaría el trabajo a quien la está haciendo.
    if (['EN_CAMINO', 'ENTREGADA'].includes(entrega?.estado)) {
      setError(entrega.estado === 'EN_CAMINO'
        ? 'Esta entrega ya va en camino — no se puede reasignar desde aquí.'
        : 'Esta entrega ya se completó.')
      return
    }
    setSaving(true); setError(null)
    try {
      const patch = {
        tipo_entrega:       tipoEntrega,
        direccion_entrega:  direccionEntrega || null,
        ciudad:             ciudad           || null,
        barrio:             barrio           || null,
        localidad:          localidad        || null,
        indicaciones:       indicaciones     || null,
        contacto_nombre:    contactoNombre   || null,
        contacto_telefono:  contactoTelefono || null,
        telefono_adicional: telefonoAdicional|| null,
        horarios_atencion:  horarios         || null,
        fecha_programada:   fechaProg        || null,
        notas:              notas            || null,
        ...(publicar
          ? { mensajero_id: null, estado: 'DISPONIBLE', publicada_en: new Date().toISOString(),
              publicada_por: yo?.id || null, tomada_en: null }
          : { mensajero_id: mensajeroId, estado: 'ASIGNADA' }),
        ...(tipoEntrega === 'ALIADO' && svc?.aliados?.id_aliado
          ? { aliado_id: svc.aliados.id_aliado } : {}),
      }

      if (entrega?.id) {
        const { error: e } = await db.from('entregas').update(patch).eq('id', entrega.id)
        if (e) throw e
      } else {
        const { error: e } = await db.from('entregas').insert({ servicio_id: servicioId, ...patch })
        if (e) throw e
      }

      // Al publicar no se notifica a nadie: la entrega aparece en el tab Entregas
      // de todos los mensajeros y técnicos, con su contador. Notificar a todos por
      // cada entrega sería ruido — quien esté disponible la ve al entrar.
      const mascota = svc?.mascotas
      const cliente = mascota?.clientes
      if (!publicar) {
        await crearNotificacion({
          para_personal_id: mensajeroId,
          tipo:             'ENTREGA_ASIGNADA',
          titulo:           'Nueva entrega asignada',
          mensaje:          `Entregar recordatorios de ${mascota?.nombre || 'mascota'}` +
            `${cliente ? ` (${cliente.nombre} ${cliente.apellido})` : ''}. ` +
            `${direccionEntrega ? `Dir: ${direccionEntrega}` : ''}` +
            `${fechaProg ? ` · Fecha: ${fechaProg}` : ''}`,
          servicio_id: servicioId,
          datos: {
            mascota:   mascota?.nombre,
            cliente:   cliente ? `${cliente.nombre} ${cliente.apellido}` : null,
            direccion: direccionEntrega,
            ciudad,
            saldo:     Math.max(0, (svc?.valor_total || 0) - (svc?.valor_pagado || 0)),
            notas,
          },
        })
      }

      setPublicado(publicar)
      setOk(true)
      setTimeout(() => { onGuardado(); onClose() }, 800)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function descargarCertificado() {
    if (!svc) return
    setGenCert(true)
    try {
      const mensajero = mensajeros.find(m => m.id === mensajeroId) || null
      // El certificado refleja lo que hay en pantalla (aunque no se haya guardado aún).
      const entregaCert = {
        ...(entrega || {}),
        tipo_entrega:       tipoEntrega,
        direccion_entrega:  direccionEntrega || null,
        ciudad:             ciudad           || null,
        barrio:             barrio           || null,
        localidad:          localidad        || null,
        indicaciones:       indicaciones     || null,
        contacto_nombre:    contactoNombre   || null,
        contacto_telefono:  contactoTelefono || null,
        telefono_adicional: telefonoAdicional|| null,
        horarios_atencion:  horarios         || null,
      }
      await generarCertificadoEntrega({ svc, entrega: entregaCert, mensajero, items })
    } catch (e) { setError('Error al generar certificado: ' + e.message) }
    finally { setGenCert(false) }
  }

  function abrirWhatsApp() {
    const cliente = svc?.mascotas?.clientes
    if (!cliente?.whatsapp) return
    const wa = String(cliente.whatsapp).replace(/\D/g, '')
    const mascota = svc?.mascotas?.nombre || 'tu mascota'
    const dirRef = direccionEntrega || svc?.direccion_recogida || 'la registrada'
    const msg =
      `¡Hola ${cliente.nombre}! 🐾\n\nTus recordatorios de *${mascota}* ya están listos.\n\n` +
      `¿Confirmamos la dirección de entrega: *${dirRef}*?\n` +
      `Si deseas otra dirección, cuéntanos. En Camino al Cielo te acompañamos 🕊️`
    window.open(waLink(cliente.whatsapp, msg), '_blank')
  }

  const saldo = svc ? Math.max(0, (svc.valor_total || 0) - (svc.valor_pagado || 0)) : 0
  const cliente = svc?.mascotas?.clientes

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-6 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-indigo-600" />
            <span className="font-bold text-gray-900">Preparar entrega</span>
            {svc && <span className="text-[12px] text-gray-400 ml-1">· {svc.mascotas?.nombre}</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 gap-3 text-gray-400">
            <div className="spinner" /><span className="text-sm">Cargando datos…</span>
          </div>
        ) : (
          <div className="p-5 space-y-5 overflow-y-auto max-h-[80vh]">

            {ok && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-sm font-semibold"
                style={{ background: '#D1FAE5', color: '#065F46' }}>
                <Check size={15} />
                {publicado
                  ? '¡Publicada! Ya aparece en la app de mensajeros y técnicos.'
                  : '¡Entrega configurada! Notificando al mensajero…'}
              </div>
            )}

            {/* Estado del pool: qué pasó con esta entrega hasta ahora */}
            {!ok && entrega?.estado === 'DISPONIBLE' && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-[13px]"
                style={{ background: '#EEF2FF', color: '#3730A3' }}>
                <Truck size={14} />
                Publicada{entrega.publicada_en
                  ? ` el ${new Date(entrega.publicada_en).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : ''} — esperando que alguien la tome.
              </div>
            )}
            {!ok && ['ASIGNADA', 'EN_CAMINO'].includes(entrega?.estado) && tomadaPor && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-[13px]"
                style={{ background: '#F5F3FF', color: '#5B21B6' }}>
                <User size={14} />
                {entrega.tomada_en ? 'La tomó' : 'Asignada a'} {tomadaPor}
                {entrega.estado === 'EN_CAMINO' ? ' · va en camino' : ''}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-sm"
                style={{ background: '#FEE2E2', color: '#991B1B' }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            {/* Resumen servicio */}
            {svc && (
              <div className="rounded-xl p-3 flex flex-wrap gap-4 text-[12px]"
                style={{ background: '#F4F7F4', border: '1px solid rgba(30,80,40,0.08)' }}>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Mascota</div>
                  <div className="font-semibold text-gray-800 flex items-center gap-1.5 flex-wrap">
                    <span>{svc.mascotas?.nombre} · {svc.mascotas?.especies?.nombre}</span>
                    {esAliadoVip(svc) && <VipBadge />}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Propietario</div>
                  <div className="font-semibold text-gray-800">
                    {cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Plan</div>
                  <div className="font-semibold text-gray-800">{svc.planes?.nombre || '—'}</div>
                </div>
                {saldo > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Saldo a cobrar</div>
                    <div className="font-bold text-red-600 text-[14px]">{fmt(saldo)}</div>
                  </div>
                )}
                {saldo === 0 && (
                  <div className="flex items-center gap-1 text-green-700 font-semibold">
                    <Check size={12} /> Pagado completo
                  </div>
                )}
              </div>
            )}

            {/* Datos que dejó el cliente en el portal de fotos (prefill ya aplicado) */}
            {svc?.datos_entrega_cliente && (
              <div className="rounded-xl p-3 text-[12px]" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
                <div className="flex items-center gap-1.5 mb-1.5 font-bold text-[#3730A3]">
                  <MapPin size={12} /> Datos que dejó el cliente para la entrega
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#3730A3]">
                  {svc.datos_entrega_cliente.direccion &&          <span><b>Dir:</b> {svc.datos_entrega_cliente.direccion}</span>}
                  {svc.datos_entrega_cliente.barrio &&             <span><b>Barrio:</b> {svc.datos_entrega_cliente.barrio}</span>}
                  {svc.datos_entrega_cliente.localidad &&          <span><b>Localidad:</b> {svc.datos_entrega_cliente.localidad}</span>}
                  {svc.datos_entrega_cliente.recibe &&             <span><b>Recibe:</b> {svc.datos_entrega_cliente.recibe}</span>}
                  {svc.datos_entrega_cliente.telefono &&           <span><b>Tel:</b> {svc.datos_entrega_cliente.telefono}</span>}
                  {svc.datos_entrega_cliente.telefono_adicional && <span><b>Tel 2:</b> {svc.datos_entrega_cliente.telefono_adicional}</span>}
                  {svc.datos_entrega_cliente.horarios &&           <span><b>Horarios:</b> {svc.datos_entrega_cliente.horarios}</span>}
                </div>
                <p className="text-[10px] text-[#6366F1] mt-1.5">Ya los cargamos abajo; ajústalos si es necesario. No es una hora exacta confirmada.</p>
              </div>
            )}

            {/* WhatsApp cliente */}
            {cliente?.whatsapp && (
              <button onClick={abrirWhatsApp}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: '#25D366' }}>
                <MessageCircle size={14} /> Contactar cliente por WhatsApp
              </button>
            )}

            {/* Tipo de entrega */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                Tipo de entrega
              </label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: 'DOMICILIO',  label: '🏠 Domicilio' },
                  { value: 'ALIADO',     label: '🏥 Veterinaria aliada' },
                  { value: 'PRESENCIAL', label: '🏢 Presencial en sede' },
                ].map(op => (
                  <button key={op.value}
                    onClick={() => handleCambiarTipo(op.value)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all"
                    style={{
                      background:  tipoEntrega === op.value ? '#4F46E5' : 'transparent',
                      color:       tipoEntrega === op.value ? '#fff'    : '#6B7280',
                      borderColor: tipoEntrega === op.value ? '#4F46E5' : '#E5E7EB',
                    }}>
                    {op.label}
                  </button>
                ))}
              </div>
              {tipoEntrega === 'ALIADO' && svc?.aliados && (
                <div className="mt-2 px-3 py-2 rounded-lg text-[12px]"
                  style={{ background: '#EEF2FF', color: '#3730A3' }}>
                  🏥 <strong>{svc.aliados.nombre}</strong>
                  {svc.aliados.direccion && <span> · {svc.aliados.direccion}</span>}
                  {svc.aliados.localidad && <span> · {svc.aliados.localidad}</span>}
                  {svc.aliados.barrio    && <span> · {svc.aliados.barrio}</span>}
                  {svc.aliados.ciudad    && <span> · {svc.aliados.ciudad}</span>}
                  {svc.aliados.contacto_nombre && <span> · Contacto: {svc.aliados.contacto_nombre}</span>}
                </div>
              )}
            </div>

            {/* Dirección */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin size={11} /> Dirección de entrega
              </label>
              <input value={direccionEntrega} onChange={e => setDireccionEntrega(e.target.value)}
                placeholder={tipoEntrega === 'ALIADO' ? 'Dirección de la veterinaria…' : 'Calle, carrera, conjunto…'}
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
                style={{ borderColor: '#E5E7EB' }} />
              <div className="flex gap-2 mt-2">
                <input value={barrio} onChange={e => setBarrio(e.target.value)}
                  placeholder="Barrio / sector"
                  className="flex-1 px-3 py-2 rounded-xl border text-[13px] outline-none"
                  style={{ borderColor: '#E5E7EB' }} />
                <input value={localidad} onChange={e => setLocalidad(e.target.value)}
                  placeholder="Localidad"
                  className="flex-1 px-3 py-2 rounded-xl border text-[13px] outline-none"
                  style={{ borderColor: '#E5E7EB' }} />
                <input value={ciudad} onChange={e => setCiudad(e.target.value)}
                  placeholder="Ciudad"
                  className="flex-1 px-3 py-2 rounded-xl border text-[13px] outline-none"
                  style={{ borderColor: '#E5E7EB' }} />
              </div>
              <textarea value={indicaciones} onChange={e => setIndicaciones(e.target.value)}
                placeholder="Indicaciones de llegada, apto, piso, puntos de referencia…"
                rows={2}
                className="w-full mt-2 px-3 py-2 rounded-xl border text-[13px] outline-none resize-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>

            {/* Contacto */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <User size={11} /> Contacto para entrega
              </label>
              <div className="flex gap-2">
                <input value={contactoNombre} onChange={e => setContactoNombre(e.target.value)}
                  placeholder="Nombre de quien recibe"
                  className="flex-1 px-3 py-2 rounded-xl border text-[13px] outline-none"
                  style={{ borderColor: '#E5E7EB' }} />
                <input value={contactoTelefono} onChange={e => setContactoTelefono(e.target.value)}
                  placeholder="Teléfono"
                  className="flex-1 px-3 py-2 rounded-xl border text-[13px] outline-none"
                  style={{ borderColor: '#E5E7EB' }} />
              </div>
              <input value={telefonoAdicional} onChange={e => setTelefonoAdicional(e.target.value)}
                placeholder="Teléfono adicional (opcional)"
                className="w-full mt-2 px-3 py-2 rounded-xl border text-[13px] outline-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>

            {/* Horarios a tener en cuenta */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Calendar size={11} /> Horarios a tener en cuenta
              </label>
              <textarea value={horarios} onChange={e => setHorarios(e.target.value)}
                placeholder="Horarios que pidió el cliente. No es una hora exacta confirmada de entrega."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>

            {/* Fecha programada */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Calendar size={11} /> Fecha programada (opcional)
              </label>
              <input type="date" value={fechaProg} onChange={e => setFechaProg(e.target.value)}
                className="px-3 py-2 rounded-xl border text-[13px] outline-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>

            {/* Mensajero — opcional: si no eliges a nadie, se publica al pool */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Truck size={11} /> Mensajero / Técnico
              </label>
              <select value={mensajeroId} onChange={e => setMensajeroId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none bg-white"
                style={{ borderColor: mensajeroId ? '#4F46E5' : '#E5E7EB' }}>
                <option value="">— Que la tome quien pueda —</option>
                {mensajeros.map(m => (
                  <option key={m.id} value={m.id}>{m.nombre} {m.apellido}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {mensajeroId
                  ? 'Se le asigna solo a esta persona y le llega una notificación.'
                  : 'Sin elegir a nadie, la entrega queda disponible para todos y la toma el primero que pueda.'}
              </p>
            </div>

            {/* Notas */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                Notas para el mensajero
              </label>
              <textarea value={notas} onChange={e => setNotas(e.target.value)}
                placeholder="Observaciones especiales, instrucciones de cobro, etc."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>

            {/* Ítems */}
            {items.filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO').length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Ítems a entregar
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO').map(i => (
                    <span key={i.id}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7' }}>
                      {i.recordatorios?.nombre || 'Ítem'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Acciones */}
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button onClick={descargarCertificado} disabled={genCert}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: '#EDE9FE', color: '#5B21B6' }}>
                {genCert
                  ? <div className="w-3.5 h-3.5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                  : <Download size={13} />}
                Certificado PDF
              </button>
              <div className="flex-1" />
              <button onClick={onClose}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                Cancelar
              </button>
              <button onClick={() => guardar({ publicar: !mensajeroId })}
                disabled={saving || ok || ['EN_CAMINO', 'ENTREGADA'].includes(entrega?.estado)}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: '#4F46E5' }}>
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Truck size={14} />}
                {saving
                  ? 'Guardando…'
                  : mensajeroId ? 'Asignar entrega' : 'Publicar para que la tomen'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
