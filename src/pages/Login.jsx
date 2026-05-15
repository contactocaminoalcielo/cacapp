import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await login(email.trim().toLowerCase(), password)
    } catch {
      setError('Correo o contraseña incorrectos. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5"
      style={{ background: 'linear-gradient(160deg, #263218 0%, #111a0b 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[380px]"
      >
        {/* Logo */}
        <div className="text-center mb-8 select-none">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="text-6xl mb-4"
          >
            🕊️
          </motion.div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Camino al Cielo</h1>
          <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Sistema interno · Solo uso autorizado
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header strip */}
          <div className="px-7 pt-6 pb-5" style={{ borderBottom: '1px solid #F3F4F6' }}>
            <h2 className="text-[#111827] text-base font-semibold">Iniciar sesión</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">Ingresa con tu correo de trabajo</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-7 py-6 space-y-4">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 rounded-xl text-[13px] font-medium"
                    style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-[12px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="tu@caminoalcielo.com.co"
                autoComplete="email"
                required
                className="w-full h-12 px-4 rounded-xl border text-[14px] text-gray-900 placeholder:text-gray-300 transition-colors"
                style={{ borderColor: '#E5E7EB', outline: 'none' }}
                onFocus={e  => { e.target.style.borderColor = '#3D5A27'; e.target.style.boxShadow = '0 0 0 3px rgba(61,90,39,0.12)' }}
                onBlur={e   => { e.target.style.borderColor = '#E5E7EB'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full h-12 px-4 rounded-xl border text-[14px] text-gray-900 placeholder:text-gray-300 transition-colors"
                style={{ borderColor: '#E5E7EB', outline: 'none' }}
                onFocus={e  => { e.target.style.borderColor = '#3D5A27'; e.target.style.boxShadow = '0 0 0 3px rgba(61,90,39,0.12)' }}
                onBlur={e   => { e.target.style.borderColor = '#E5E7EB'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <motion.button
              type="submit"
              disabled={loading || !email || !password}
              whileTap={{ scale: 0.97 }}
              className="w-full h-12 rounded-xl font-bold text-[15px] text-white transition-all disabled:opacity-50"
              style={{ background: '#3D5A27' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="spinner w-4 h-4" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  Ingresando...
                </span>
              ) : 'Ingresar'}
            </motion.button>
          </form>
        </div>

        <p className="text-center text-[11px] mt-6" style={{ color: 'rgba(255,255,255,0.22)' }}>
          ¿Problemas para ingresar? Contacta al administrador.
        </p>
      </motion.div>
    </div>
  )
}
