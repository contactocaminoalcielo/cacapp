import { createContext, useContext, useEffect, useState } from 'react'
import { db } from '@/lib/supabase'

const ROL_NOMBRES = { 1: 'COORDINADOR', 2: 'TECNICO', 3: 'MENSAJERO', 4: 'PRODUCTOR', 5: 'OPERARIO', 6: 'ADMIN' }

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,      setSession]      = useState(undefined)
  const [personalData, setPersonalData] = useState(undefined)

  useEffect(() => {
    db.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadPersonal(session.user)
    })

    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadPersonal(session.user)
      else { setPersonalData(undefined) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadPersonal(user) {
    const email = user.email?.toLowerCase().trim()
    // Solo la fila de este usuario y solo las columnas que la app usa
    // (antes bajaba toda la tabla personal con cédulas, direcciones y docs de todos)
    const filtros = [`auth_user_id.eq.${user.id}`]
    if (email) filtros.push(`email.ilike.${email}`)
    const { data: rows, error } = await db.from('personal')
      .select('id, nombre, apellido, email, rol_principal_id, auth_user_id, activo')
      .or(filtros.join(','))
    if (error) { setPersonalData(null); return }
    const data = (rows || []).find(p =>
      p.auth_user_id === user.id ||
      p.email?.toLowerCase().trim() === email
    ) ?? null
    if (!data) { setPersonalData(null); return }
    setPersonalData({ ...data, rol: ROL_NOMBRES[data.rol_principal_id] ?? null })
  }

  async function login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password })
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
      loading: session === undefined,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
