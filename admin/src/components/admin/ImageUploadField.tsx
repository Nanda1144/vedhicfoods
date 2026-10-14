import { useId, useRef } from 'react'
import { Button, Icon } from '@/components/common'
import { Field } from '@/components/common/form'
import { useToast } from '@/context'

const MAX_IMAGE_SIZE = 1_500_000

interface ImageUploadFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  className?: string
}

export function ImageUploadField({ value, onChange, label = 'Primary image', hint, className }: ImageUploadFieldProps) {
  const { push } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const inputId = useId()

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_IMAGE_SIZE) {
      push({ title: 'Image too large', description: 'Keep the image under 1.5 MB.', tone: 'danger' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint} className={className}>
      <div className="image-upload" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="image-upload__preview"
          style={{
            width: 64,
            height: 64,
            borderRadius: 10,
            border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--color-surface-2, #f2f2f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value ? (
            <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Icon name="box" size={20} />
          )}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <Button size="sm" variant="outline" icon="upload" onClick={() => inputRef.current?.click()}>
          Upload image
        </Button>
        {value && (
          <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange('')}>
            Remove
          </Button>
        )}
      </div>
    </Field>
  )
}