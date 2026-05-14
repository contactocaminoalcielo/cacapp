import { cn } from '@/lib/utils'
import { AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react'

const VARIANTS = {
  info:  { classes: 'bg-blue-50 text-blue-800 border-blue-200',   Icon: Info },
  warn:  { classes: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle },
  error: { classes: 'bg-red-50 text-red-700 border-red-200',      Icon: AlertCircle },
  success: { classes: 'bg-green-50 text-green-800 border-green-200', Icon: CheckCircle },
}

export function Alert({ variant = 'info', className, children }) {
  const { classes, Icon } = VARIANTS[variant] ?? VARIANTS.info
  return (
    <div className={cn('flex items-start gap-2.5 px-3.5 py-3 rounded-lg border text-[13px] font-medium mb-3', classes, className)}>
      <Icon size={15} className="flex-shrink-0 mt-0.5 opacity-80" />
      <div className="flex-1">{children}</div>
    </div>
  )
}
