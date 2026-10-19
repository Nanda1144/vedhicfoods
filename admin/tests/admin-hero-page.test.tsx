// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminHeroPage } from '@/pages/admin/AdminHeroPage'
import { ToastProvider, ToastViewport } from '@/context'
import type { WebsiteSettings } from '@/types'

/**
 * The homepage hero is the one admin uploader that accepts *several* files at
 * once. This covers the real handler: a multi-select adds one entry per readable
 * image, and a single oversized file aborts the whole batch with a toast (the
 * `Promise.all` rejects before any state is written). No drag handler exists on
 * this screen, so none is asserted.
 */

const settingsRef = vi.hoisted(() => ({ current: null as WebsiteSettings | null }))

vi.mock('@/pages/admin/useAdminSettings', () => ({
  useAdminSettings: () => ({
    settings: settingsRef.current,
    loading: false,
    persist: vi.fn(),
  }),
}))

function baseSettings(overrides: Partial<WebsiteSettings> = {}): WebsiteSettings {
  return {
    brandName: 'Vedhic',
    tagline: '',
    supportEmail: '',
    supportPhone: '',
    whatsapp: '',
    addressLine: '',
    city: '',
    state: '',
    pincode: '',
    currency: 'INR',
    gstin: '',
    freeShippingThreshold: 0,
    standardShippingFee: 0,
    taxRate: 0,
    announcement: '',
    announcementActive: false,
    socials: [],
    businessHours: '',
    heroTitle: 'Traditional Indian goodness',
    heroTitleAccent: 'grown the slow way',
    heroSubtitle: '',
    heroCtaLabel: 'Shop now',
    heroImages: [],
    storyEnabled: true,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

async function flush(ticks = 5): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function renderPage(settings: WebsiteSettings): Promise<void> {
  settingsRef.current = settings
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(
      <MemoryRouter>
        <ToastProvider>
          <AdminHeroPage />
          <ToastViewport />
        </ToastProvider>
      </MemoryRouter>,
    )
  })
  await flush()
  await flush()
}

function imageFile(name: string): File {
  return new File(['pixels'], name, { type: 'image/png' })
}

function oversizedFile(name: string): File {
  const file = new File(['pixels'], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { configurable: true, value: 1_500_001 })
  return file
}

function chooseFiles(files: File[]): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function imageItems(): Element[] {
  return Array.from(container.querySelectorAll('.hero-image-list__item'))
}

beforeEach(() => {
  settingsRef.current = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AdminHeroPage image uploader', () => {
  it('accepts several images in one selection', async () => {
    await renderPage(baseSettings())

    chooseFiles([imageFile('one.png'), imageFile('two.png'), imageFile('three.png')])
    await flush()

    expect(imageItems()).toHaveLength(3)
    expect(container.textContent).toContain('Image 1')
    expect(container.textContent).toContain('Image 3')
  })

  it('appends to images already on the form', async () => {
    await renderPage(baseSettings({ heroImages: ['data:image/png;base64,existing'] }))

    expect(imageItems()).toHaveLength(1)
    chooseFiles([imageFile('one.png'), imageFile('two.png')])
    await flush()

    expect(imageItems()).toHaveLength(3)
  })

  it('rejects the whole batch when one image exceeds 1.5 MB', async () => {
    await renderPage(baseSettings())

    chooseFiles([imageFile('ok.png'), oversizedFile('huge.png')])
    await flush()

    expect(imageItems()).toHaveLength(0)
    expect(document.body.textContent).toContain('Could not add image')
    expect(document.body.textContent).toContain('huge.png is larger than 1.5 MB.')
  })

  it('does nothing when the picker is cancelled', async () => {
    await renderPage(baseSettings())

    chooseFiles([])
    await flush()

    expect(imageItems()).toHaveLength(0)
  })

  it('currently accepts any readable file — there is no MIME guard on this screen', async () => {
    await renderPage(baseSettings())

    const text = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    chooseFiles([text])
    await flush()

    expect(imageItems()).toHaveLength(1)
  })
})
