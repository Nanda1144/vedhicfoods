import { Link } from 'react-router-dom'
import { FOOTER_NAV } from '@/data/navigation'
import { TRUST_BADGES } from '@/config/site'
import { useSettings } from '@/context'
import { Icon, Logo, type IconName } from '../common'

const SOCIAL_ICONS: Record<string, IconName> = {
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
  x: 'external',
  linkedin: 'external',
}

export function Footer() {
  const { settings } = useSettings()
  const year = new Date().getFullYear()

  const groups = Object.values(FOOTER_NAV)

  return (
    <footer className="footer">
      <div className="footer__band">
        <div className="container">
          <ul className="footer__trust">
            {TRUST_BADGES.map((badge) => (
              <li key={badge.title} className="footer__trust-item">
                <span className="footer__trust-icon">
                  <Icon name={badge.icon as IconName} size={20} />
                </span>
                <span>
                  <strong>{badge.title}</strong>
                  <span className="footer__trust-copy">{badge.copy}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="footer__main">
        <div className="container footer__grid">
          <div className="footer__brand">
            <Logo size="md" tone="light" />
            <p className="footer__tagline">{settings.tagline}</p>
            <p className="footer__desc">{settings.announcement}</p>
            <ul className="footer__contact">
              <li>
                <Icon name="phone" size={16} />
                <a href={`tel:+91${settings.supportPhone.replace(/\s/g, '')}`}>{settings.supportPhone}</a>
              </li>
              <li>
                <Icon name="mail" size={16} />
                <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a>
              </li>
              <li>
                <Icon name="map-pin" size={16} />
                <span>
                  {settings.addressLine}, {settings.city}, {settings.state} {settings.pincode}
                </span>
              </li>
            </ul>
          </div>

          {groups.map((group, index) => (
            <nav key={index} className="footer__col" aria-label={group.title}>
              <p className="footer__heading">{group.title}</p>
              <ul className="footer__links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="footer__legal">
        <div className="container footer__legal-inner">
          <p>© {year} {settings.brandName}. All rights reserved · FSSAI Lic. 10024031000123</p>
          <div className="cluster cluster-3">
            {settings.socials.map((social) => (
              <a key={social.platform} href={social.href} className="footer__social" aria-label={social.label} target="_blank" rel="noreferrer">
                <Icon name={SOCIAL_ICONS[social.platform] ?? 'external'} size={16} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}