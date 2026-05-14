import { cn } from '@/lib/utils'

export function TableWrap({ className, children }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      {children}
    </div>
  )
}

export function Table({ children, className }) {
  return (
    <table className={cn('w-full text-sm border-collapse', className)}>
      {children}
    </table>
  )
}

export function Th({ children, className, ...props }) {
  return (
    <th
      className={cn(
        'text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider',
        'px-4 py-3 bg-gray-50 border-b border-gray-100 whitespace-nowrap',
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({ children, className, ...props }) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-[13px] text-gray-700 border-b border-gray-100 align-middle',
        className
      )}
      {...props}
    >
      {children}
    </td>
  )
}

export function Tr({ children, onClick, className }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'transition-colors',
        onClick ? 'cursor-pointer hover:bg-gray-50/80' : '',
        className
      )}
    >
      {children}
    </tr>
  )
}
