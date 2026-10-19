import type { ReactNode } from 'react'
import { SeoHead } from '@/components/common/SeoHead'

interface RoutePageProps {
  title: string
  description: string
  noIndex?: boolean
  structuredData?: Record<string, unknown>
  children: ReactNode
}

/** Sets the document title for the route it wraps. */
export function RoutePage({ title, description, noIndex, structuredData, children }: RoutePageProps) {
  return <><SeoHead title={title} description={description} noIndex={noIndex} structuredData={structuredData} />{children}</>
}
