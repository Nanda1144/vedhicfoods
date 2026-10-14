import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'
import { placeholderImage, type AspectRatio } from '@/utils/placeholder'

export interface SmartImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  aspect?: AspectRatio
  /** Custom aspect via inline style (e.g. "4 / 5"). */
  ratio?: string
  /** Generates an on-brand fallback instead of a broken icon when src fails. */
  seed?: string
  priority?: boolean
  contain?: boolean
}

export function SmartImage({
  src,
  alt,
  aspect = 'square',
  ratio,
  seed = 'fallback',
  priority = false,
  contain = false,
  className,
  ...props
}: SmartImageProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [resolvedSrc, setResolvedSrc] = useState(src)
  const keyRef = useRef(0)

  useEffect(() => {
    setResolvedSrc(src)
    setStatus('loading')
    keyRef.current = 0
  }, [src])

  const handleError = useCallback(() => {
    const attempt = keyRef.current
    if (attempt === 0) {
      keyRef.current = 1
      setResolvedSrc(
        placeholderImage({
          seed,
          variant: 'generic',
          width: 800,
          height: 800,
          label: 'Image coming soon',
        }),
      )
    } else if (attempt === 1) {
      setStatus('error')
    }
  }, [seed])

  const style = ratio ? { aspectRatio: ratio } : { aspectRatio: `var(--ratio-${aspect})` }

  return (
    <div
      className={cn('image-frame', status === 'error' && 'image-frame--error', className)}
      style={style}
    >
      {status === 'loading' && <span className="image-frame__skeleton" aria-hidden="true" />}
      {status === 'error' ? (
        <span className="image-frame__fallback" role="img" aria-label={alt}>
          <span className="image-frame__fallback-glyph">⊕</span>
        </span>
      ) : (
        <img
          key={resolvedSrc}
          src={resolvedSrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={cn('image-frame__img', contain && 'image-frame__img--contain')}
          onLoad={() => setStatus('ready')}
          onError={handleError}
          {...props}
        />
      )}
    </div>
  )
}