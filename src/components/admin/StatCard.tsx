import { cn } from '@/utils/cn'
import { Icon, Skeleton, type IconName } from '../common'
import type { CSSProperties } from 'react'

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue'

const TONE_COLORS: Record<Tone, string> = {
  neutral: 'var(--color-text-muted)',
  green: 'var(--color-success)',
  amber: 'var(--color-warning)',
  red: 'var(--color-danger)',
  blue: 'var(--color-info)',
}

interface StatCardProps {
  label: string
  value: string
  delta?: number
  deltaLabel?: string
  icon: IconName
  tone?: Tone
  trend?: 'up' | 'down' | 'neutral'
  loading?: boolean
}

export function StatCard({ label, value, delta, deltaLabel, icon, tone = 'neutral', trend = 'neutral', loading = false }: StatCardProps) {
  if (loading) {
    return (
      <div className="stat-card">
        <div className="row row--between">
          <Skeleton style={{ width: 72, height: 14 }} />
          <Skeleton style={{ width: 36, height: 36, borderRadius: 10 }} />
        </div>
        <Skeleton style={{ width: 112, height: 28, marginTop: 14 }} />
        <Skeleton style={{ width: 88, height: 12, marginTop: 10 }} />
      </div>
    )
  }

  return (
    <div className="stat-card">
      <div className="row row--between">
        <p className="stat-card__label">{label}</p>
        <span className={cn('stat-card__icon', `stat-card__icon--${tone}`)} style={{ '--tone': TONE_COLORS[tone] } as CSSProperties}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="stat-card__value">{value}</p>
      <p className="stat-card__foot">
        {typeof delta === 'number' && (
          <span className={cn('stat-card__delta', `is-${trend}`)}>
            <Icon name={trend === 'up' ? 'trend-up' : trend === 'down' ? 'trend-down' : 'minus'} size={14} />
            {delta}%
          </span>
        )}
        {deltaLabel && <span className="stat-card__delta-label">{deltaLabel}</span>}
      </p>
    </div>
  )
}