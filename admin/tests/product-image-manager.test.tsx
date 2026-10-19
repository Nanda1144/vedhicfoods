// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageUploadField } from '@/components/admin/ImageUploadField'
import { ToastProvider, ToastViewport } from '@/context'

/**
 * Product image manager — uploader interactions.
 *
 * The admin product form does not ship a separate gallery component: the
 * product's *primary* image is managed by `ImageUploadField`, a single-slot
 * uploader (the multi-image surface lives on the hero page and is covered by
 * `admin-hero-page.test.tsx`). This suite therefore drives the real component
 * through a thin controlled harness so replacement / deletion / drag-and-drop
 * are observed exactly as the product form sees them.
 *
 * The decoder + canvas are stubbed (jsdom implements neither) so every valid
 * upload deterministically emits `RESIZED_DATA_URL`.
 *
 * Not exposed by this component, so deliberately not asserted: explicit
 * "set primary" (the field *is* the primary slot) and reorder (single slot).
 */

const RESIZED_DATA_URL = 'data:image/jpeg;base64,resized'

let container: HTMLDivElement
let root: Root
let emitted: string | undefined
let capturedFile: File | undefined

/** Minimal controlled parent that mirrors how the product form owns the value. */
function ManagerHarness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <ImageUploadField
      value={value}
      onChange={(next) => {
        emitted = next
        setValue(next)
      }}
    />
  )
}

function imageFile(name = 'photo.png', type = 'image/png', size = 2048): File {
  const file = new File([new Uint8Array(8)], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

interface RenderResult {
  field: HTMLElement
  input: HTMLInputElement
  preview: () => HTMLImageElement | null
  button: (label: string) => HTMLButtonElement | undefined
}

function renderManager(initial = ''): RenderResult {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(
      <ToastProvider>
        <ManagerHarness initial={initial} />
        <ToastViewport />
      </ToastProvider>,
    )
  })

  const field = container.querySelector('.image-upload') as HTMLElement
  return {
    field,
    input: container.querySelector('input[type="file"]') as HTMLInputElement,
    preview: () => field.querySelector('img'),
    button: (label: string) =>
      Array.from(field.querySelectorAll('button')).find((btn) => btn.textContent?.includes(label)) as
        | HTMLButtonElement
        | undefined,
  }
}

function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function fireDrag(
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  target: Element,
  files: File[] | null,
): { files: File[]; dropEffect: string } | null {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = files === null ? null : { files, dropEffect: 'none' }
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer })
  target.dispatchEvent(event)
  return dataTransfer
}

beforeEach(() => {
  emitted = undefined
  capturedFile = undefined
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      capturedFile = file
      return { width: 2400, height: 1200, close: vi.fn() }
    }),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(RESIZED_DATA_URL)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ProductImageManager (ImageUploadField) — browse', () => {
  it('opens the hidden file picker when the Upload image control is clicked', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { button } = renderManager()

    act(() => button('Upload image')?.click())

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('applies the downscaled image through a file-input change and previews it', async () => {
    const { input, preview } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile()])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('photo.png')
    expect(preview()?.getAttribute('src')).toBe(RESIZED_DATA_URL)
  })

  it('treats a subsequent selection as a replacement of the managed image', async () => {
    const { input, preview } = renderManager('data:image/png;base64,first')
    expect(preview()?.getAttribute('src')).toBe('data:image/png;base64,first')

    await act(async () => {
      chooseFiles(input, [imageFile('second.png')])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
    expect(preview()?.getAttribute('src')).toBe(RESIZED_DATA_URL)
    expect(container.querySelectorAll('.image-upload img')).toHaveLength(1)
  })

  it('uses only the first file when several are selected in one browse action', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile('first.png'), imageFile('second.png'), imageFile('third.png')])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('first.png')
    expect(container.querySelectorAll('.image-upload img')).toHaveLength(1)
  })

  it('does nothing when the picker is cancelled (empty file list)', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [])
    })
    await flush()

    expect(emitted).toBeUndefined()
  })
})

describe('ProductImageManager (ImageUploadField) — primary slot and delete', () => {
  it('manages the product primary-image slot and labels it as such', () => {
    renderManager()

    const label = container.querySelector('.field__label')
    expect(label?.textContent).toContain('Primary image')
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(container.querySelectorAll('.image-upload img')).toHaveLength(0)
  })

  it('clears the managed image through the Remove control', async () => {
    const { button, preview } = renderManager('data:image/png;base64,preview')
    expect(preview()).not.toBeNull()

    act(() => button('Remove')?.click())

    expect(emitted).toBe('')
    expect(preview()).toBeNull()
    expect(container.querySelector('.image-upload img')).toBeNull()
  })

  it('does not render a Remove control when no image is set', () => {
    const { button } = renderManager()

    expect(button('Remove')).toBeUndefined()
  })
})

describe('ProductImageManager (ImageUploadField) — drag and drop', () => {
  it('routes a dropped image through the same handler as browse', async () => {
    const { field, preview } = renderManager()

    await act(async () => {
      fireDrag('dragenter', field, [imageFile('dropped.jpg', 'image/jpeg')])
      fireDrag('dragover', field, [])
      fireDrag('drop', field, [imageFile('dropped.jpg', 'image/jpeg')])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('dropped.jpg')
    expect(preview()?.getAttribute('src')).toBe(RESIZED_DATA_URL)
  })

  it('toggles the drag-active class and advertises a copy drop effect', () => {
    const { field } = renderManager()

    act(() => fireDrag('dragenter', field, []))
    expect(field.className).toContain('is-dragging')

    const over: { dt: ReturnType<typeof fireDrag> } = { dt: null }
    act(() => {
      over.dt = fireDrag('dragover', field, [])
    })
    expect(over.dt?.dropEffect).toBe('copy')

    act(() => fireDrag('dragleave', field, []))
    expect(field.className).not.toContain('is-dragging')
  })

  it('uses only the first image when several are dropped', async () => {
    const { field } = renderManager()

    await act(async () => {
      fireDrag('drop', field, [imageFile('first.jpg', 'image/jpeg'), imageFile('second.jpg', 'image/jpeg')])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('first.jpg')
  })

  it('does not crash on a drop with an empty file list or no dataTransfer', async () => {
    const { field } = renderManager()

    await act(async () => {
      fireDrag('drop', field, [])
      fireDrag('drop', field, null)
    })
    await flush()

    expect(emitted).toBeUndefined()
  })
})

describe('ProductImageManager (ImageUploadField) — validation', () => {
  it('rejects a non-image file with a user-visible error and no state change', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile('notes.txt', 'text/plain')])
    })
    await flush()

    expect(emitted).toBeUndefined()
    expect(document.body.textContent).toContain('Unsupported file')
    expect(capturedFile).toBeUndefined()
  })

  it('rejects a PDF declared through the picker', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile('invoice.pdf', 'application/pdf')])
    })
    await flush()

    expect(emitted).toBeUndefined()
    expect(document.body.textContent).toContain('Unsupported file')
  })

  it('rejects an oversized image before reading it', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile('huge.png', 'image/png', 1_500_001)])
    })
    await flush()

    expect(emitted).toBeUndefined()
    expect(document.body.textContent).toContain('Image too large')
    expect(capturedFile).toBeUndefined()
  })

  it('accepts an image exactly at the size limit', async () => {
    const { input } = renderManager()

    await act(async () => {
      chooseFiles(input, [imageFile('edge.png', 'image/png', 1_500_000)])
    })
    await flush()

    expect(emitted).toBe(RESIZED_DATA_URL)
  })

  it('rejects an unsupported dropped file the same way as browse', async () => {
    const { field } = renderManager()

    await act(async () => {
      fireDrag('drop', field, [imageFile('notes.md', 'text/markdown')])
    })
    await flush()

    expect(emitted).toBeUndefined()
    expect(document.body.textContent).toContain('Unsupported file')
  })
})
