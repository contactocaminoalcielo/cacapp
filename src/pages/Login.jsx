import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

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
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: 'linear-gradient(150deg, #060E2B 0%, #0B1D4F 55%, #091428 100%)' }}
    >
      {/* Decorative glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(26,92,216,0.18) 0%, transparent 65%)' }} />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(196,168,122,0.12) 0%, transparent 65%)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(26,92,216,0.07) 0%, transparent 60%)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[400px] relative z-10"
      >
        {/* Brand */}
        <div className="text-center mb-8 select-none">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex justify-center mb-5"
          >
            <div className="relative">
              {/* Glow behind logo */}
              <div className="absolute inset-0 rounded-3xl blur-2xl"
                style={{ background: '#1A5CD8', opacity: 0.35, transform: 'scale(1.25)' }} />
              <img
                src="/orbit-logo.png"
                alt="ORBIT"
                className="relative rounded-3xl object-contain shadow-2xl"
                style={{ width: 96, height: 96, background: 'white', padding: 11 }}
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <h1
              className="text-white font-bold leading-none"
              style={{ fontSize: 38, letterSpacing: '0.1em' }}
            >
              ORBIT
            </h1>
            <p className="text-[13px] font-semibold mt-2 tracking-wide"
              style={{ color: '#C4A87A', letterSpacing: '0.04em' }}>
              Gestión Inteligente de Servicios
            </p>
            <p className="text-[11px] mt-1.5 font-medium"
              style={{ color: 'rgba(255,255,255,0.28)' }}>
              Camino al Cielo · Solo uso autorizado
            </p>
          </motion.div>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl shadow-2xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
          }}
        >
          <form onSubmit={handleSubmit} className="px-7 pt-6 pb-7 space-y-5">
            <div>
              <h2 className="text-[17px] font-bold" style={{ color: '#0B1D4F' }}>
                Iniciar sesión
              </h2>
              <p className="text-[12px] text-gray-400 mt-0.5">
                Ingresa con tu correo de trabajo
              </p>
            </div>

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

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wider"
                  style={{ color: '#64748B' }}>
                  Correo electrónico
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  placeholder="tu@caminoalcielo.com.co"
                  autoComplete="email"
                  required
                  className="w-full h-12 px-4 rounded-xl border text-[14px] text-gray-900 placeholder:text-gray-300 transition-all duration-150"
                  style={{ borderColor: '#E2E8F0', outline: 'none', background: '#FAFBFC' }}
                  onFocus={e => { e.target.style.borderColor = '#1A5CD8'; e.target.style.boxShadow = '0 0 0 3px rgba(26,92,216,0.12)'; e.target.style.background = '#fff' }}
                  onBlur={e  => { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#FAFBFC' }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wider"
                  style={{ color: '#64748B' }}>
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="w-full h-12 px-4 pr-11 rounded-xl border text-[14px] text-gray-900 placeholder:text-gray-300 transition-all duration-150"
                    style={{ borderColor: '#E2E8F0', outline: 'none', background: '#FAFBFC' }}
                    onFocus={e => { e.target.style.borderColor = '#1A5CD8'; e.target.style.boxShadow = '0 0 0 3px rgba(26,92,216,0.12)'; e.target.style.background = '#fff' }}
                    onBlur={e  => { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#FAFBFC' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                    style={{ color: '#94A3B8' }}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <motion.button
              type="submit"
              disabled={loading || !email || !password}
              whileTap={{ scale: 0.97 }}
              className="w-full h-12 rounded-xl font-bold text-[15px] text-white transition-all disabled:opacity-50 mt-1"
              style={{ background: 'linear-gradient(135deg, #1A5CD8 0%, #0B1D4F 100%)', letterSpacing: '0.01em' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <span
                    className="w-4 h-4 rounded-full border-2 animate-spin"
                    style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#fff' }}
                  />
                  Ingresando...
                </span>
              ) : 'Ingresar a ORBIT'}
            </motion.button>
          </form>
        </motion.div>

        <p className="text-center text-[11px] mt-5" style={{ color: 'rgba(255,255,255,0.2)' }}>
          ¿Problemas para ingresar? Contacta al administrador.
        </p>
      </motion.div>
    </div>
  )
}
