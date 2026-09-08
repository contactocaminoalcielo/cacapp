import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { db } from '@/lib/supabase'
import { conLimite } from '@/lib/esperas'

const ROL_NOMBRES = { 1: 'COORDINADOR', 2: 'TECNICO', 3: 'MENSAJERO', 4: 'PRODUCTOR', 5: 'OPERARIO', 6: 'ADMIN' }

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,      setSession]      = useState(undefined)
  const [personalData, setPersonalData] = useState(undefined)
  const [authError, setAuthError] = useState('')
  const [intento, setIntento] = useState(0)
  const perfilActual = useRef(null)

  useEffect(() => {
    let activo = true
    let version = 0
    const timers = new Set()
    setAuthError('')
    const aplicar = (sesion, evento) => {
      if (!activo) return
      const turno = ++version
      setSession(sesion)
      if (!sesion) { perfilActual.current = null; setPersonalData(undefined); setAuthError(''); return }
      if (evento === 'TOKEN_REFRESHED' && perfilActual.current === sesion.user.id) return
      if (perfilActual.current !== sesion.user.id) setPersonalData(undefined)
      // Salir del callback de Auth antes de pedir datos con el mismo cliente.
      const timer = setTimeout(async () => {
        timers.delete(timer)
        if (!activo || turno !== version) return
        try {
          const perfil = await conLimite(loadPersonal(sesion.user), 35000, 'No pudimos cargar tu perfil. Revisa la conexión y reintenta.')
          if (!activo || turno !== version) return
          perfilActual.current = sesion.user.id
          setPersonalData(perfil); setAuthError('')
        } catch (_) {
          if (activo && turno === version && perfilActual.current !== sesion.user.id) {
            setAuthError('No pudimos cargar tu perfil. Revisa la conexión y reintenta.')
          }
        }
      }, 0)
      timers.add(timer)
    }
    const inicial = version
    conLimite(db.auth.getSession(), 35000, 'No pudimos recuperar tu sesión. Revisa la conexión y reintenta.')
      .then(({ data, error }) => {
        if (!activo || version !== inicial) return
        if (error) throw error
        aplicar(data.session)
      }).catch(() => {
        if (activo && version === inicial) setAuthError('No pudimos recuperar tu sesión. Revisa la conexión y reintenta.')
      })
    const { data: { subscription } } = db.auth.onAuthStateChange((evento, sesion) => {
      aplicar(sesion, evento)
    })

    return () => { activo = false; timers.forEach(clearTimeout); subscription.unsubscribe() }
  }, [intento])

  async function loadPersonal(user) {
    const email = user.email?.toLowerCase().trim()
    // Solo la fila de este usuario y solo las columnas que la app usa
    // (antes bajaba toda la tabla personal con cédulas, direcciones y docs de todos)
    const filtros = [`auth_user_id.eq.${user.id}`]
    if (email) filtros.push(`email.ilike.${email}`)
    const { data: rows, error } = await db.from('personal')
      .select('id, nombre, apellido, email, rol_principal_id, auth_user_id, activo')
      .or(filtros.join(','))
    if (error) throw error
    const data = (rows || []).find(p =>
      p.auth_user_id === user.id ||
      p.email?.toLowerCase().trim() === email
    ) ?? null
    if (!data) return null
    return { ...data, rol: ROL_NOMBRES[data.rol_principal_id] ?? null }
  }

  async function login(email, password) {
    const { data, error } = await conLimite(db.auth.signInWithPassword({ email, password }), 35000, 'La conexión tardó demasiado. Revisa la señal e intenta de nuevo.')
    if (error) throw error
    return data
  }

  async function logout() {
    await db.auth.signOut()
    setPersonalData(null)
  }

  return (
    <AuthContext.Provider value={{
      session,
      personalData,
      login,
      logout,
      authError,
      retryAuth: () => setIntento(n => n + 1),
      loading: session === undefined,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
