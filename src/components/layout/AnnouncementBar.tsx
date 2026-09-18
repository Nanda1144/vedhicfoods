import { useSettings } from '@/context'
import { Icon } from '../common/Icon'

export function AnnouncementBar() {
  const { settings, loading } = useSettings()
  const label = loading ? '…' : settings.announcement
  const isActive = !loading && settings.announcementActive

  return (
    <div className="announcement" role="region" aria-label="Announcement">
      <div className="announcement__marquee">
        <div className="announcement__track">
          {Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="announcement__item">
              {isActive && (
                <span className="announcement__new" aria-hidden="true">New</span>
              )}
              <Icon name="leaf" size={14} />
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}