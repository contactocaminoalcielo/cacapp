import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full px-3 py-2.5 text-[13px] font-medium text-gray-900 bg-white',
      'border border-gray-200 rounded-lg',
      'placeholder:text-gray-400 placeholder:font-normal',
      'outline-none transition-all duration-150',
      'focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10',
      'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'
