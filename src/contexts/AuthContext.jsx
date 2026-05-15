import { createContext, useContext, useEffect, useState } from 'react'
import { db } from '@/lib/supabase'

const ROL_NOMBRES = { 1: 'COORDINADOR', 2: 'TECNICO', 3: 'MENSAJERO', 4: 'PRODUCTOR', 5: 'OPERARIO', 6: 'ADMIN' }

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,      setSession]      = useState(undefined)
  const [personalData, setPersonalData] = useState(undefined)
  const [debug,        setDebug]        = useState('')

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
    const { data: todos, error } = await db.from('personal').select('*')
    // Debug temporal — borrar después
    setDebug(`user.id=${user.id} | user.email=${user.email} | rows=${todos?.length ?? 0} | err=${error?.message ?? 'none'}`)
    const email = user.email?.toLowerCase().trim()
    const data = (todos || []).find(p =>
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
      debug,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
