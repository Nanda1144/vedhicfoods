import { PageHeader } from '@/components/common'
import { NotFoundState } from '@/components/common'

export function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="Error 404" title="Page not found" />
      <section className="section">
        <div className="container center">
          <NotFoundState />
        </div>
      </section>
    </>
  )
}