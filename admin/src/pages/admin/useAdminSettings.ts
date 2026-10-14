import { useEffect, useState } from 'react'
import { useSettings } from '@/context'
import type { WebsiteSettings } from '@/types'

/**
 * Admin-facing settings accessor. Provides the live settings plus a `persist`
 * helper that writes through to the storefront settings store so the theme /
 * announcement changes reflect instantly on the customer side.
 */
export function useAdminSettings() {
  const { settings, update } = useSettings()
  const [loading, setLoading] = useState(!settings)
  const [local, setLocal] = useState<WebsiteSettings | null>(settings)

  useEffect(() => {
    if (settings) {
      setLocal(settings)
      setLoading(false)
    }
  }, [settings])

  return {
    settings: local ?? settings,
    loading,
    async persist(patch: Partial<WebsiteSettings>) {
      const next = await update(patch)
      setLocal(next)
      return next
    },
  }
}