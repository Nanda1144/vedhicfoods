// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageUploadField } from '@/components/admin/ImageUploadField'
import { ToastProvider, ToastViewport } from '@/context'

/**
 * Covers the real behaviour of the product-settings image field.
 *
 * The upload path is deliberately non-trivial: a valid image is downscaled on a
 * canvas and emitted as a JPEG data URL, an unsupported type or an oversized
 * file is rejected with a toast before any read happens, and a drag-and-drop is
 * routed through exactly the same `onFile` handler as the hidden file input.
 * The decoder/canvas is stubbed so the assertions are deterministic under jsdom
 * (which implements neither).
 */

const RESIZED_DATA_URL = 'data:image/jpeg;base64,resized'

let container: HTMLDivElement
let root: Root
let capturedFile: File | undefined

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
  onChange: ReturnType<typeof vi.fn>
  field: HTMLElement
  input: HTMLInputElement
}

function renderField(value = ''): RenderResult {
  const onChange = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(
      <ToastProvider>
        <ImageUploadField value={value} onChange={onChange} />
        <ToastViewport />
      </ToastProvider>,
    )
  })

  return {
    onChange,
    field: container.querySelector('.image-upload') as HTMLElement,
    input: container.querySelector('input[type="file"]') as HTMLInputElement,
  }
}

function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function fireDrag(type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', target: Element, files: File[] | null): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: files === null ? null : { files, dropEffect: 'none' },
  })
  target.dispatchEvent(event)
}

beforeEach(() => {
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

describe('ImageUploadField — browse', () => {
  it('downscales a chosen image and reports the resulting data URL', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [imageFile()])
    })
    await flush()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('photo.png')
  })

  it('does nothing when the picker is cancelled (empty file list)', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('updates the preview image when a value is supplied', () => {
    const { field } = renderField('data:image/png;base64,preview')
    const img = field.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,preview')
  })

  it('clears the value through the Remove control', () => {
    const { onChange, field } = renderField('data:image/png;base64,preview')
    const remove = Array.from(field.querySelectorAll('button')).find((btn) => btn.textContent?.includes('Remove'))

    expect(remove).toBeTruthy()
    act(() => remove?.click())

    expect(onChange).toHaveBeenCalledWith('')
  })
})

describe('ImageUploadField — validation', () => {
  it('rejects a non-image file with a user-visible error and no state change', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [imageFile('notes.txt', 'text/plain')])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Unsupported file')
    expect(capturedFile).toBeUndefined()
  })

  it('rejects a PDF attachment', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [imageFile('invoice.pdf', 'application/pdf')])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Unsupported file')
  })

  it('rejects a file above the 1.5 MB limit before reading it', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [imageFile('huge.png', 'image/png', 1_500_001)])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Image too large')
    expect(capturedFile).toBeUndefined()
  })

  it('accepts a file exactly at the size limit', async () => {
    const { onChange, input } = renderField()

    await act(async () => {
      chooseFiles(input, [imageFile('edge.png', 'image/png', 1_500_000)])
    })
    await flush()

    expect(onChange).toHaveBeenCalledWith(RESIZED_DATA_URL)
  })
})

describe('ImageUploadField — drag and drop', () => {
  it('routes a dropped image through the same handler as browse', async () => {
    const { onChange, field } = renderField()

    await act(async () => {
      fireDrag('dragenter', field, [imageFile('dropped.jpg', 'image/jpeg')])
      fireDrag('dragover', field, [])
      fireDrag('drop', field, [imageFile('dropped.jpg', 'image/jpeg')])
    })
    await flush()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(RESIZED_DATA_URL)
    expect(capturedFile?.name).toBe('dropped.jpg')
  })

  it('toggles the drag-active class on enter and clears it on leave', () => {
    const { field } = renderField()

    act(() => fireDrag('dragenter', field, []))
    expect(field.className).toContain('is-dragging')

    act(() => fireDrag('dragleave', field, []))
    expect(field.className).not.toContain('is-dragging')
  })

  it('uses only the first image when several are dropped', async () => {
    const { onChange, field } = renderField()

    await act(async () => {
      fireDrag('drop', field, [imageFile('first.jpg', 'image/jpeg'), imageFile('second.jpg', 'image/jpeg')])
    })
    await flush()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(capturedFile?.name).toBe('first.jpg')
  })

  it('does not crash on a drop with an empty file list', async () => {
    const { onChange, field } = renderField()

    await act(async () => {
      fireDrag('drop', field, [])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not crash on a drop with no dataTransfer at all', async () => {
    const { onChange, field } = renderField()

    await act(async () => {
      fireDrag('drop', field, null)
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects an unsupported dropped file the same way as browse', async () => {
    const { onChange, field } = renderField()

    await act(async () => {
      fireDrag('drop', field, [imageFile('notes.md', 'text/markdown')])
    })
    await flush()

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Unsupported file')
  })
})
