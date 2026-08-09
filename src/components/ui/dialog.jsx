import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-2xl' }) {
  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onClose()}>
      <Dialog.Portal>
        {/* Fondo del modal: tinte de marca en vez de negro puro + más difuminado.
            El contenido de atrás se aleja y el modal se lee como una capa aparte. */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0B1D4F]/35 backdrop-blur-[5px] flex items-center justify-center p-4">
          <Dialog.Content
            className={cn(
              'bg-white rounded-2xl shadow-xl w-full max-h-[90vh] overflow-y-auto relative',
              'border border-gray-100',
              'animate-in fade-in-0 zoom-in-95 duration-150',
              maxWidth
            )}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <Dialog.Title className="text-[15px] font-semibold text-gray-900">
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="px-6 py-5">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
                {footer}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
