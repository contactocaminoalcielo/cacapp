import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-0.5 bg-gray-100 rounded-lg p-1',
        className
      )}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'px-3 py-1.5 rounded-md text-[12px] font-semibold text-gray-500 cursor-pointer transition-all',
        'border-none bg-transparent outline-none',
        'hover:text-gray-700',
        'data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm',
        className
      )}
      {...props}
    />
  )
}

export function TabsContent({ ...props }) {
  return <TabsPrimitive.Content {...props} />
}
