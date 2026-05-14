import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        primary:   'bg-[#3D5A27] text-white hover:bg-[#263218] focus:ring-[#3D5A27]/30 shadow-sm active:scale-[0.98]',
        secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus:ring-gray-200',
        gold:      'bg-[#C4A87A] text-[#1A2E1E] hover:bg-[#9E7D4A] hover:text-white focus:ring-[#C4A87A]/40 shadow-sm active:scale-[0.98]',
        danger:    'bg-white text-red-600 border border-red-200 hover:bg-red-50 focus:ring-red-200',
        ghost:     'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:ring-gray-200',
      },
      size: {
        sm:      'h-7 px-3 text-[12px] rounded-md gap-1',
        default: 'h-9 px-4 text-[13px]',
        lg:      'h-11 px-6 text-sm',
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
