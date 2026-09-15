import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

// `flex-wrap` NO es cosmético: sin él la barra se corta y las pestañas de la
// derecha quedan INALCANZABLES. Tres capas esconden el desborde horizontal
// (`html` y `body` en index.css, y la columna de contenido en AppShell), así que
// lo que no cabe no se desplaza — desaparece. La pestaña activa vive en estado,
// no en la URL, así que tampoco hay forma de llegar por link. Pasó en Tenjo: al
// agregar "Salidas" (8 pestañas ≈ 789 px) el operario perdió "Cubículos" en el
// celular. Envolviendo, ninguna pestaña puede quedar fuera a ningún ancho.
// El `gap` se separa por eje para no mover el espaciado horizontal existente y
// darle aire a las filas cuando la barra envuelve.
export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex flex-wrap items-center gap-x-0.5 gap-y-1 bg-gray-100 rounded-lg p-1',
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
