import { useId, useRef, useState, type DragEvent } from 'react'
import { Button, Icon } from '@/components/common'
import { Field } from '@/components/common/form'
import { useToast } from '@/context'

const MAX_IMAGE_SIZE = 1_500_000
/**
 * The API body cap is 1 MB (`express.json` in the backend), and the upload
 * travels as a base64 data URL — which inflates the payload by ~33%. Real
 * phone photos are several megabytes, so a raw data URL would be rejected with
 * a 413. Downscale on a canvas to a sane catalogue size first; the quality
 * loop keeps the encoded string within this budget so the request always fits.
 */
const DATA_URL_BUDGET = 900_000
const MAX_DIMENSION = 1600

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to read image'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function toUploadDataUrl(file: File): Promise<string> {
  const source = await loadBitmap(file)
  const srcWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const srcHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcWidth, srcHeight))
  const width = Math.max(1, Math.round(srcWidth * scale))
  const height = Math.max(1, Math.round(srcHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser')
  // JPEG has no alpha channel, so flatten transparency onto white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)
  if (typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close()

  let quality = 0.82
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > DATA_URL_BUDGET && quality > 0.4) {
    quality -= 0.12
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  return dataUrl
}

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
  const [dragActive, setDragActive] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      push({ title: 'Unsupported file', description: 'Choose an image file.', tone: 'danger' })
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      push({ title: 'Image too large', description: 'Keep the image under 1.5 MB.', tone: 'danger' })
      return
    }
    try {
      onChange(await toUploadDataUrl(file))
    } catch {
      // Canvas/decoder failure — fall back to the raw file rather than blocking
      // the operator. It may still be rejected by the API size cap, but small
      // images will succeed.
      const reader = new FileReader()
      reader.onload = () => onChange(String(reader.result ?? ''))
      reader.readAsDataURL(file)
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    void onFile(event.dataTransfer?.files?.[0])
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint} className={className}>
      <div
        className={dragActive ? 'image-upload is-dragging' : 'image-upload'}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 12 }}
      >
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
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Reset the input so re-selecting the *same* file still fires
            // `change`. Browsers suppress the event when the input's value is
            // unchanged, which previously made "remove then re-upload" a no-op.
            event.target.value = ''
            void onFile(file)
          }}
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