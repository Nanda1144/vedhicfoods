import { Link } from 'react-router-dom'
import { Icon, Badge, Button, type IconName } from '../common'

interface PagePlaceholderProps {
  icon: IconName
  eyebrow?: string
  title: string
  description: string
  features?: string[]
  actions?: Array<{ label: string; href?: string; onClick?: () => void; primary?: boolean }>
}

export function PagePlaceholder({ icon, eyebrow, title, description, features, actions }: PagePlaceholderProps) {
  return (
    <section className="placeholder-page">
      <div className="placeholder-page__inner">
        {eyebrow && <Badge tone="warning" dot>{eyebrow}</Badge>}
        <span className="placeholder-page__icon" aria-hidden="true">
          <Icon name={icon} size={30} />
        </span>
        <h2>{title}</h2>
        <p>{description}</p>

        {features && features.length > 0 && (
          <ul className="placeholder-page__list">
            {features.map((feature) => (
              <li key={feature}>
                <Icon name="check" size={15} />
                {feature}
              </li>
            ))}
          </ul>
        )}

        <div className="placeholder-page__actions">
          {actions?.length ? (
            actions.map((action) =>
              action.href ? (
                <Link key={action.label} to={action.href} className={`btn btn--${action.primary ? 'primary' : 'outline'} btn--md`}>
                  <span className="btn__label">{action.label}</span>
                </Link>
              ) : (
                <Button key={action.label} variant={action.primary ? 'primary' : 'outline'} size="md" onClick={action.onClick}>
                  {action.label}
                </Button>
              ),
            )
          ) : (
            <Link to="/admin" className="btn btn--primary btn--md">
              <Icon name="arrow-left" size={17} />
              <span className="btn__label">Back to dashboard</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}