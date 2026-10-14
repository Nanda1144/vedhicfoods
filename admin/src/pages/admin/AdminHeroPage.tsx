import { useEffect, useRef, useState } from 'react'
import { useAdminSettings } from './useAdminSettings'
import { useToast } from '@/context'
import { AdminPageHeader } from '@/components/admin'
import type { WebsiteSettings } from '@/types'
import { Button, Skeleton } from '@/components/common'
import { Field, Input, Textarea } from '@/components/common/form'

const MAX_IMAGE_BYTES = 1_500_000

export function AdminHeroPage() {
  const { settings, loading, persist } = useAdminSettings()
  const { push } = useToast()
  const [form, setForm] = useState<WebsiteSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (settings && !form) setForm(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  if (loading && !settings) {
    return (
      <>
        <AdminPageHeader title="Homepage hero" description="Headline, supporting copy and background images." />
        <Skeleton style={{ width: '100%', height: 420 }} />
      </>
    )
  }

  const visible = form ?? settings!

  const set = <K extends keyof WebsiteSettings>(key: K, value: WebsiteSettings[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const setImages = (heroImages: string[]) => set('heroImages', heroImages)

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      if (file.size > MAX_IMAGE_BYTES) {
        reject(new Error(`${file.name} is larger than 1.5 MB.`))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
      reader.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    try {
      const read = await Promise.all(Array.from(files).map(readFile))
      setImages([...visible.heroImages, ...read.filter(Boolean)])
    } catch (caught) {
      push({ title: 'Could not add image', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    }
  }

  const addUrl = () => {
    const url = urlDraft.trim()
    if (!url) return
    setImages([...visible.heroImages, url])
    setUrlDraft('')
  }

  const removeImage = (index: number) =>
    setImages(visible.heroImages.filter((_, position) => position !== index))

  const moveImage = (index: number, direction: -1 | 1) => {
    const next = [...visible.heroImages]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setImages(next)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await persist({
        heroTitle: visible.heroTitle,
        heroTitleAccent: visible.heroTitleAccent,
        heroSubtitle: visible.heroSubtitle,
        heroCtaLabel: visible.heroCtaLabel,
        heroImages: visible.heroImages,
      })
      push({ title: 'Hero saved', description: 'The storefront homepage now shows this content.' })
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <AdminPageHeader title="Homepage hero" description="Headline, supporting copy and background images shown at the top of the storefront." />

      <form className="admin-form" onSubmit={submit} noValidate>
        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Headline</p>
          <div className="admin-form__grid">
            <Field label="Headline" hint="The first line of the hero title.">
              <Input value={visible.heroTitle} onChange={(event) => set('heroTitle', event.target.value)} placeholder="Traditional Indian goodness" />
            </Field>
            <Field label="Accent phrase" hint="Rendered in the accent colour after the headline.">
              <Input value={visible.heroTitleAccent} onChange={(event) => set('heroTitleAccent', event.target.value)} placeholder="grown the slow way" />
            </Field>
          </div>
          <Field label="Supporting paragraph">
            <Textarea
              rows={3}
              value={visible.heroSubtitle}
              onChange={(event) => set('heroSubtitle', event.target.value)}
              placeholder="Handcrafted millet laddus, ragi roti and heritage organic grains…"
            />
          </Field>
          <Field label="Primary button label">
            <Input value={visible.heroCtaLabel} onChange={(event) => set('heroCtaLabel', event.target.value)} placeholder="Shop now" />
          </Field>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Background images</p>
          <p className="admin-form__hint" style={{ marginBottom: 12 }}>
            These cross-fade behind the hero headline. Leave empty to use the build-time fallback
            (<code>VITE_HERO_IMAGES</code>).
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files)
              event.target.value = ''
            }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Button type="button" variant="outline" icon="upload" onClick={() => fileRef.current?.click()}>
              Upload images
            </Button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Field label="Or paste an image URL">
                <Input
                  value={urlDraft}
                  onChange={(event) => setUrlDraft(event.target.value)}
                  placeholder="https://cdn.example.com/hero.jpg"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addUrl()
                    }
                  }}
                />
              </Field>
            </div>
            <Button type="button" variant="secondary" icon="plus" onClick={addUrl}>
              Add
            </Button>
          </div>

          {visible.heroImages.length === 0 ? (
            <p className="admin-form__hint">No hero images yet.</p>
          ) : (
            <ul className="hero-image-list">
              {visible.heroImages.map((src, index) => (
                <li key={`${index}-${src.slice(0, 24)}`} className="hero-image-list__item">
                  <span className="hero-image-list__thumb">
                    <img src={src} alt="" />
                  </span>
                  <span className="hero-image-list__meta">
                    <strong>Image {index + 1}</strong>
                    <span className="hero-image-list__url">{src.length > 64 ? `${src.slice(0, 61)}…` : src}</span>
                  </span>
                  <span className="hero-image-list__actions">
                    <Button type="button" size="sm" variant="ghost" icon="arrow-up" aria-label="Move up" onClick={() => moveImage(index, -1)} />
                    <Button type="button" size="sm" variant="ghost" icon="arrow-down" aria-label="Move down" onClick={() => moveImage(index, 1)} />
                    <Button type="button" size="sm" variant="ghost" icon="trash" aria-label="Remove" onClick={() => removeImage(index)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="admin-form__foot">
          <Button type="submit" icon="check" loading={saving}>
            Save hero
          </Button>
        </div>
      </form>
    </>
  )
}
