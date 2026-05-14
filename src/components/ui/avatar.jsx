import { cn, initials } from '@/lib/utils'

export function Avatar({ nombre, apellido, size = 'sm', className }) {
  const szClass = size === 'lg' ? 'w-12 h-12 text-base' : 'w-[34px] h-[34px] text-[12px]'
  return (
    <div className={cn('rounded-full flex items-center justify-center font-bold flex-shrink-0 border-2', szClass, className)}
      style={{ background: '#E8F3EB', color: '#1F5A32', borderColor: '#C5DEC9' }}>
      {initials(nombre, apellido)}
    </div>
  )
}
