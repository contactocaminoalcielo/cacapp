import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Trash2, HelpCircle, Info, CheckCircle2 } from 'lucide-react'

const VARIANT_CFG = {
  danger: {
    icon:         Trash2,
    iconBg:       '#FEF2F2',
    iconColor:    '#DC2626',
    confirmClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    icon:         AlertTriangle,
    iconBg:       '#FFFBEB',
    iconColor:    '#D97706',
    confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  info: {
    icon:         HelpCircle,
    iconBg:       '#EFF6FF',
    iconColor:    '#2563EB',
    confirmClass: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  success: {
    icon:         CheckCircle2,
    iconBg:       '#F0FDF4',
    iconColor:    '#16A34A',
    confirmClass: 'bg-green-600 hover:bg-green-700 text-white',
  },
}

export function ConfirmDialog({
  open,
  title,
  message,
  variant      = 'danger',
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  onConfirm,
  onCancel,
}) {
  const cfg  = VARIANT_CFG[variant] || VARIANT_CFG.danger
  const Icon = cfg.icon

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel?.() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[400] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          style={{ animation: 'fadeIn 0.15s ease-out' }}
        >
          <Dialog.Content
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5"
            style={{ animation: 'slideIn 0.18s ease-out' }}
            onInteractOutside={e => e.preventDefault()}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>

            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: cfg.iconBg }}>
                <Icon size={26} style={{ color: cfg.iconColor }} />
              </div>
              <div>
                <p className="text-[16px] font-bold text-gray-900 leading-tight">{title}</p>
                {message && (
                  <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed whitespace-pre-line">{message}</p>
                )}
              </div>
            </div>

            <div className="flex gap-2.5">
              <button type="button" onClick={onCancel}
                className="flex-1 py-2.5 px-4 rounded-xl text-[13px] font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                {cancelLabel}
              </button>
              <button type="button" onClick={onConfirm}
                className={`flex-1 py-2.5 px-4 rounded-xl text-[13px] font-semibold transition-colors ${cfg.confirmClass}`}>
                {confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: scale(0.93) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </Dialog.Root>
  )
}

export function AlertDialog({ open, title, message, variant = 'danger', onClose }) {
  const cfg  = VARIANT_CFG[variant] || VARIANT_CFG.danger
  const Icon = cfg.icon

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose?.() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[400] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          style={{ animation: 'fadeIn 0.15s ease-out' }}
        >
          <Dialog.Content
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5"
            style={{ animation: 'slideIn 0.18s ease-out' }}
            onInteractOutside={e => e.preventDefault()}
          >
            <Dialog.Title className="sr-only">{title || 'Aviso'}</Dialog.Title>

            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: cfg.iconBg }}>
                <Icon size={26} style={{ color: cfg.iconColor }} />
              </div>
              <div>
                <p className="text-[16px] font-bold text-gray-900 leading-tight">{title || 'Aviso'}</p>
                {message && (
                  <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed whitespace-pre-line">{message}</p>
                )}
              </div>
            </div>

            <Dialog.Close asChild>
              <button type="button"
                className="w-full py-2.5 px-4 rounded-xl text-[13px] font-semibold bg-[#1A5CD8] hover:bg-[#0B1D4F] text-white transition-colors">
                Entendido
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
