import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import { Accordion } from './Accordion'
import { SectionHeader } from './SectionHeader'
import { ButtonLink } from './Button'
import { Skeleton } from './Skeleton'

export interface FaqSectionProps {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  align?: 'left' | 'center'
  limit?: number
  className?: string
}

export function FaqSection({
  eyebrow,
  title,
  description,
  align = 'left',
  limit = 5,
  className,
}: FaqSectionProps) {
  const loaded = useAsync(() => contentService.faqs(), [])

  return (
    <>
      <SectionHeader eyebrow={eyebrow} title={title} description={description} align={align} />

      <div className={cn('faq-group', className)}>
        {loaded.loading ? (
          <div className="stack stack-2">
            {Array.from({ length: limit }).map((_, index) => (
              <Skeleton key={index} style={{ width: '100%', height: 56 }} />
            ))}
          </div>
        ) : (
          <Accordion
            exclusive
            items={(loaded.data ?? []).slice(0, limit).map((faq) => ({
              id: faq.id,
              label: faq.question,
              content: <p>{faq.answer}</p>,
            }))}
          />
        )}
      </div>

      <div className="faq-foot">
        <ButtonLink to="/faq" variant="outline" iconRight="arrow-right">
          See all FAQs
        </ButtonLink>
      </div>
    </>
  )
}