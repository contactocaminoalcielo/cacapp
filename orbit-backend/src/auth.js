// Autorización del backend — aquí vive el control de permisos real
// (en la arquitectura objetivo reemplaza al RLS como mecanismo de seguridad).
import jwt from 'jsonwebtoken'
import { pool } from './db.js'

/** Jobs internos (cron del VPS): requiere el token compartido */
export function requireJob(req, res, next) {
  if (!process.env.JOB_TOKEN || req.headers['x-job-token'] !== process.env.JOB_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

/** Usuarios: valida el JWT emitido por el auth actual (mismo JWT_SECRET).
 *  Cuando se reemplace el login, solo cambia el emisor del token. */
export async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!token) return res.status(401).json({ error: 'Sin token' })
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.apellido, p.activo, r.nombre AS rol
       FROM public.personal p
       LEFT JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE (p.auth_user_id = $1 OR lower(p.email) = lower($2)) AND p.activo
       LIMIT 1`,
      [payload.sub || null, payload.email || '']
    )
    if (!rows[0]) return res.status(403).json({ error: 'Usuario sin personal activo asociado' })
    req.personal = rows[0]
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

/** Restringe a roles específicos (ej: COORDINADOR, ADMIN) */
export const requireRol = (...roles) => (req, res, next) => {
  if (!roles.includes(req.personal?.rol)) {
    return res.status(403).json({ error: `Requiere rol: ${roles.join(' o ')}` })
  }
  next()
}
