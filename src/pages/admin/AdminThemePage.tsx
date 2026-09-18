import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { AdminPageHeader } from '@/components/admin'
import type { BrandSettings } from '@/types'
import { Button, Icon, Skeleton } from '@/components/common'
import { Field, Input } from '@/components/common/form'

const PRESETS: Array<{ id: string; name: string; colors: Pick<BrandSettings, 'primary' | 'secondary' | 'accent' | 'background'> }> = [
  {
    id: 'forest',
    name: 'Forest',
    colors: { primary: '#1f3d2b', secondary: '#6b7b3a', accent: '#c9a24b', background: '#f6f1e6' },
  },
  {
    id: 'earth',
    name: 'Earth',
    colors: { primary: '#4a2f1d', secondary: '#8a6b3f', accent: '#d98c3d', background: '#faf6ef' },
  },
  {
    id: 'harvest',
    name: 'Harvest',
    colors: { primary: '#2d5a3c', secondary: '#b09a3c', accent: '#e0753a', background: '#fbf5e9' },
  },
]

export function AdminThemePage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const location = useLocation()
  const logoSection = useRef<HTMLElement | null>(null)
  const themeSection = useRef<HTMLElement | null>(null)
  const [brand, setBrand] = useState<BrandSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const result = useAsync(() => adminService.brand(), [])

  useEffect(() => {
    if (result.data && !brand) setBrand(result.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data])

  useEffect(() => {
    if (location.hash.includes('logo')) {
      logoSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (location.hash.includes('theme')) {
      themeSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash])

  if (result.loading && !result.data) {
    return (
      <>
        <AdminPageHeader title="Logo & theme" description="Brand identity and storefront colours." />
        <Skeleton style={{ width: '100%', height: 480 }} />
      </>
    )
  }

  if (result.error) {
    return (
      <>
        <AdminPageHeader title="Logo & theme" description="Brand identity and storefront colours." />
        <p className="admin-note admin-note--error">{result.error.message}</p>
      </>
    )
  }

  const form = brand ?? result.data!
  const set = <K extends keyof BrandSettings>(key: K, value: BrandSettings[K]) =>
    setBrand((current) => (current ? { ...current, [key]: value } : current))

  const onLogoFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 1_500_000) {
      push({ title: 'Logo too large', description: 'Keep the image under 1.5 MB.', tone: 'danger' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoUrl', String(reader.result ?? ''))
    reader.readAsDataURL(file)
  }

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id)
    if (!preset) return
    set('themePreset', id)
    setBrand((current) => (current ? { ...current, ...preset.colors } : current))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await adminService.saveBrand(form)
      push({ title: 'Branding saved', description: 'Logo and colours are up to date.' })
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const canWrite = can('settings:write') && can('logo:write')

  return (
    <>
      <AdminPageHeader
        title="Logo & theme"
        description="Brand identity and storefront colours."
        actions={
          <a href="#logo" className="link-button is-ghost">
            Logo <Icon name="chevron-down" size={14} />
          </a>
        }
      />

      <form className="admin-form" onSubmit={submit} noValidate>
        <section ref={logoSection} className="admin-card admin-form__section" id="logo" style={{ scrollMarginTop: 24 }}>
          <p className="admin-form__section-title">Logo</p>
          <div className="row" style={{ gap: 16, alignItems: 'center' }}>
            <div className="logo-preview" aria-hidden="true">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="" />
              ) : (
                <span className="logo-preview__fallback">{form.logoName ?? 'Vedhi'}</span>
              )}
            </div>
            <div className="admin-form__grid" style={{ flex: 1 }}>
              <Field label="Brand name" hint="Used when no logo image is uploaded.">
                <Input value={form.logoName ?? ''} onChange={(event) => set('logoName', event.target.value)} />
              </Field>
              <Field label="Logo image">
                <label className="file-drop">
                  <input
                    type="file"
                    accept="image/svg+xml,image/png,image/webp"
                    onChange={(event) => onLogoFile(event.target.files?.[0])}
                  />
                  <Icon name="upload" size={16} />
                  <span>{form.logoUrl || 'Upload an SVG, PNG or WebP logo'}</span>
                </label>
              </Field>
            </div>
          </div>
          {form.logoUrl && (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => set('logoUrl', '')} disabled={!canWrite}>
              Remove uploaded logo
            </Button>
          )}
        </section>

        <section ref={themeSection} className="admin-card admin-form__section" id="theme" style={{ scrollMarginTop: 24 }}>
          <p className="admin-form__section-title">Colour theme</p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`swatch-card${form.themePreset === preset.id ? ' is-selected' : ''}`}
                onClick={() => applyPreset(preset.id)}
              >
                <span className="swatch-card__colors">
                  {[preset.colors.primary, preset.colors.secondary, preset.colors.accent, preset.colors.background].map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span>{preset.name}</span>
                {form.themePreset === preset.id && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
          <div className="admin-form__grid color-grid">
            {(
              [
                ['primary', 'Primary'],
                ['secondary', 'Secondary'],
                ['accent', 'Accent'],
                ['background', 'Background'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="color-field">
                <span>{label}</span>
                <span className="color-field__input">
                  <input type="color" value={form[key]} onChange={(event) => set(key, event.target.value)} />
                  <code>{form[key]}</code>
                </span>
              </label>
            ))}
          </div>
        </section>

        {!canWrite && (
          <div className="admin-alert is-warning">
            <Icon name="alert" size={16} />
            <span>Your role can only view branding. Ask the owner to make changes.</span>
          </div>
        )}

        <div className="admin-form__foot">
          <Button type="submit" icon="check" loading={saving} disabled={!canWrite}>
            Save branding
          </Button>
        </div>
      </form>
    </>
  )
}