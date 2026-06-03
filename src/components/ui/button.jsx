import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        primary:   'bg-[#1A5CD8] text-white hover:bg-[#0B1D4F] focus:ring-[#1A5CD8]/30 shadow-sm active:scale-[0.98]',
        secondary: 'bg-white text-[#0B1D4F] border border-[#C0D0F0] hover:bg-[#EEF3FF] hover:border-[#1A5CD8]/30 focus:ring-[#1A5CD8]/20',
        gold:      'bg-[#F5C842] text-[#0B1D4F] hover:bg-[#C9920A] hover:text-white focus:ring-[#F5C842]/40 shadow-sm active:scale-[0.98]',
        danger:    'bg-white text-red-600 border border-red-200 hover:bg-red-50 focus:ring-red-200',
        ghost:     'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:ring-gray-200',
      },
      size: {
        sm:      'h-7 px-3 text-[12px] rounded-md gap-1',
        default: 'h-10 px-4 text-[13px]',
        lg:      'h-12 px-6 text-[14px]',
      }
    },
    defaultVariants: { variant: 'primary', size: 'default' }
  }
)

const Button = forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})
Button.displayName = 'Button'
export { Button, buttonVariants }
