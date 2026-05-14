import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { cardVariants, CARD_TRANSITION } from '@/lib/motion'

export function Card({ className, ...props }) {
  return (
    <div
      className={cn('bg-white rounded-xl border border-gray-100 shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn('flex items-center justify-between px-5 py-4 border-b border-gray-100', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }) {
  return (
    <h3 className={cn('text-[14px] font-semibold text-gray-900', className)} {...props} />
  )
}

export function CardSub({ className, ...props }) {
  return (
    <p className={cn('text-[12px] text-gray-400 mt-0.5 font-medium', className)} {...props} />
  )
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />
}

// Animated card — use in place of Card when entrance animation is desired
export function MotionCard({ className, delay = 0, hover = true, ...props }) {
  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      transition={{ ...CARD_TRANSITION, delay }}
      whileHover={hover ? { y: -2, boxShadow: '0 6px 24px rgba(0,0,0,0.08)' } : undefined}
      className={cn('bg-white rounded-xl border border-gray-100 shadow-sm', className)}
      {...props}
    />
  )
}

export function StatCard({ label, value, sub, valueColor, icon: Icon, delay = 0 }) {
  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      transition={{ ...CARD_TRANSITION, delay }}
      whileHover={{ y: -2, boxShadow: '0 6px 24px rgba(0,0,0,0.08)' }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1 cursor-default"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest leading-none">
          {label}
        </span>
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center">
            <Icon size={13} className="text-gray-400" />
          </div>
        )}
      </div>
      <motion.div
        className="text-[28px] font-bold tracking-tight leading-none mt-1 tabular-nums"
        style={{ color: valueColor ?? '#111827' }}
        key={value}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      >
        {value}
      </motion.div>
      {sub && (
        <div className="text-[11px] text-gray-400 font-medium">{sub}</div>
      )}
    </motion.div>
  )
}
