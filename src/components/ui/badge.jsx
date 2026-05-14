import { cn } from '@/lib/utils'

const VARIANT_CLASSES = {
  green:  'bg-green-100 text-green-800 border-green-200',
  amber:  'bg-amber-100 text-amber-800 border-amber-200',
  blue:   'bg-blue-100  text-blue-800  border-blue-200',
  red:    'bg-red-100   text-red-800   border-red-200',
  purple: 'bg-purple-100 text-purple-800 border-purple-200',
  gray:   'bg-gray-100  text-gray-600  border-gray-200',
}

export function Badge({ className, variant = 'green', children, style, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border leading-none',
        VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.gray,
        className
      )}
      style={style}
      {...props}
    >
      {children}
    </span>
  )
}

const ESTADO_MAP = {
  INGRESADO:     { variant: 'blue',   label: 'Ingresado' },
  EN_RECOGIDA:   { variant: 'amber',  label: 'En recogida' },
  EN_CUARTO_FRIO:{ variant: 'blue',   label: 'Cuarto frío' },
  EN_PROCESO:    { variant: 'purple', label: 'En proceso' },
  EN_PRODUCCION: { variant: 'amber',  label: 'En producción' },
  LISTO:         { variant: 'green',  label: 'Listo' },
  EN_ENTREGA:    { variant: 'purple', label: 'En entrega' },
  ENTREGADO:     { variant: 'gray',   label: 'Entregado' },
  CANCELADO:     { variant: 'red',    label: 'Cancelado' },
}

export function EstadoBadge({ estado }) {
  const cfg = ESTADO_MAP[estado] ?? { variant: 'gray', label: estado }
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}
