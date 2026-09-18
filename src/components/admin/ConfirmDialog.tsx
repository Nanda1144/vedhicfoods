import { Icon, Modal, Button } from '../common'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            icon={tone === 'danger' ? 'trash' : 'check'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <span className={tone === 'danger' ? 'admin-icon-chip is-danger' : 'admin-icon-chip'}>
          <Icon name={tone === 'danger' ? 'alert' : 'info'} size={20} />
        </span>
        <p className="admin-muted" style={{ margin: 0 }}>
          {message}
        </p>
      </div>
    </Modal>
  )
}