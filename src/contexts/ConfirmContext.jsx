import { createContext, useCallback, useContext, useState } from 'react'
import { ConfirmDialog, AlertDialog } from '@/components/ui/confirm-dialog'

const ConfirmCtx = createContext(null)

export function ConfirmProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null)
  const [alertState,   setAlertState]   = useState(null)

  // confirm(message, options?) → Promise<boolean>
  const confirm = useCallback((message, options = {}) =>
    new Promise(resolve => {
      setConfirmState({ message, ...options, resolve })
    }), [])

  // alert(message, options?) → Promise<void>
  const alert = useCallback((message, options = {}) =>
    new Promise(resolve => {
      setAlertState({ message, ...options, resolve })
    }), [])

  function handleConfirm(result) {
    confirmState?.resolve(result)
    setConfirmState(null)
  }

  function handleAlertClose() {
    alertState?.resolve()
    setAlertState(null)
  }

  return (
    <ConfirmCtx.Provider value={{ confirm, alert }}>
      {children}

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || '¿Confirmar acción?'}
        message={confirmState?.message}
        variant={confirmState?.variant || 'danger'}
        confirmLabel={confirmState?.confirmLabel || 'Confirmar'}
        cancelLabel={confirmState?.cancelLabel  || 'Cancelar'}
        onConfirm={() => handleConfirm(true)}
        onCancel={() => handleConfirm(false)}
      />

      <AlertDialog
        open={!!alertState}
        title={alertState?.title}
        message={alertState?.message}
        variant={alertState?.variant || 'danger'}
        onClose={handleAlertClose}
      />
    </ConfirmCtx.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  return ctx
}
