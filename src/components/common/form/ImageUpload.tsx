import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { fileToDataUrl } from '@/utils/image'
import { Field } from './Field'
import { Input } from './Input'
import { Icon } from '../Icon'

export interface ImageUploadProps {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  /** Alternative label for the URL input (defaults to `label`). */
  urlLabel?: string
  urlPlaceholder?: string
  /** Called while a file is being processed (can drive a small spinner). */
  className?: string
}

/**
 * Upload-or-paste image field used by the admin product form and the staff
 * invite form. Uploads are downscaled to compact data URLs for the
 * localStorage prototype; the URL text input remains as a fallback.
 */
export function ImageUpload({
  value,
  onChange,
  label = 'Image',
  hint,
  urlLabel = 'Or use an image URL',
  urlPlaceholder = 'https://…',
  className,
}: ImageUploadProps) {
  const generatedId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const dataUrl = await fileToDataUrl(file)
      onChange(dataUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that image.')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const preview: ReactNode = value ? (
    <img src={value} alt="Image preview" className="img-upload__preview" />
  ) : (
    <span className="img-upload__empty">
      <Icon name="box" size={20} />
      No image yet
    </span>
  )

  return (
    <Field label={label} hint={hint} error={error}>
      <div className={cn('img-upload', className)}>
        <div className="img-upload__row">
          <div className="img-upload__box">{preview}</div>
          <div className="img-upload__actions">
            <button
              type="button"
              className="link-button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Icon name="upload" size={15} />
              {busy ? 'Processing…' : value ? 'Replace image' : 'Upload image'}
            </button>
            {value && (
              <button
                type="button"
                className="link-button is-ghost img-upload__remove"
                onClick={() => onChange('')}
                aria-label="Remove image"
              >
                <Icon name="close" size={14} />
                Remove
              </button>
            )}
            <input
              ref={inputRef}
              id={`${generatedId}-file`}
              type="file"
              accept="image/*"
              className="img-upload__file"
              onChange={handleFile}
              aria-label="Choose an image file to upload"
            />
          </div>
        </div>
        <Input
          label={urlLabel}
          value={value.startsWith('data:') ? '' : value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={urlPlaceholder}
          srLabel
        />
      </div>
    </Field>
  )
}