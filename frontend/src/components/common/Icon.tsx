import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'search'
  | 'cart'
  | 'user'
  | 'menu'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up-right'
  | 'star'
  | 'star-half'
  | 'leaf'
  | 'shield'
  | 'truck'
  | 'award'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'info'
  | 'minus'
  | 'plus'
  | 'trash'
  | 'heart'
  | 'quote'
  | 'phone'
  | 'mail'
  | 'map-pin'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'filter'
  | 'grid'
  | 'list'
  | 'sort'
  | 'lock'
  | 'eye'
  | 'eye-off'
  | 'calendar'
  | 'download'
  | 'printer'
  | 'external'
  | 'home'
  | 'box'
  | 'users'
  | 'chart'
  | 'sliders'
  | 'refresh'
  | 'upload'
  | 'copy'
  | 'tag'
  | 'clock'
  | 'edit'
  | 'logout'
  | 'dots'
  | 'sparkles'
  | 'rupee'
  | 'ban'
  | 'wallet'
  | 'gift'
  | 'store'
  | 'search-x'
  | 'arrow-up'
  | 'arrow-down'
  | 'trend-up'
  | 'trend-down'
  | 'package-open'

const STROKE: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.4-4.4" />
    </>
  ),
  cart: (
    <>
      <path d="M6 7h13l1.2 12.4a1.5 1.5 0 0 1-1.5 1.6H6.3a1.5 1.5 0 0 1-1.5-1.6L6 7z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <circle cx="9.5" cy="20" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="20" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'arrow-right': (
    <>
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M20 12H4" />
      <path d="m10 6-6 6 6 6" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 20V4" />
      <path d="m6 10 6-6 6 6" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4v16" />
      <path d="m6 14 6 6 6-6" />
    </>
  ),
  'arrow-up-right': (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  star: (
    <path
      d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.7l-5.8 3-1.1-6.5-4.7-4.6 6.5-.9z"
      fill="currentColor"
      stroke="none"
    />
  ),
  'star-half': (
    <path
      d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.7V2.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  leaf: (
    <>
      <path d="M20 4C9.5 4 4 9.5 4 20c10.5 0 16-5.5 16-16z" />
      <path d="M4 20C7 13 11.5 8.5 19.5 4.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 2.6v5.1c0 4.7-3 8.1-7 9.6-4-1.5-7-4.9-7-9.6V5.6z" />
      <path d="m9 11.5 2.1 2.1 4-4.2" />
    </>
  ),
  truck: (
    <>
      <path d="M2 6h11v11H2z" />
      <path d="M13 9h4l4 4v4h-8z" />
      <circle cx="6.5" cy="18.5" r="1.8" />
      <circle cx="17" cy="18.5" r="1.8" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8.5 13.5-1.8 7.5 5.3-2.8 5.3 2.8-1.8-7.5" />
      <path d="m12 6 .9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5L19.5 6.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8 12.3 2.7 2.7 5.4-6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.5" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.6" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  minus: <path d="M5.5 12h13" />,
  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M6.5 7l.9 12a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.9-12" />
    </>
  ),
  heart: (
    <path d="M12 20.5C6.5 16.5 3.5 13 3.5 9.3A4.8 4.8 0 0 1 12 6.7a4.8 4.8 0 0 1 8.5 2.6c0 3.7-3 7.2-8.5 11.2z" />
  ),
  quote: (
    <path
      d="M10.4 7.2C7.6 8.2 6 10 6 12.8V17h5v-5H8.2c.1-1.8 1-3 3.1-3.8zM19.4 7.2c-2.8 1-4.4 2.8-4.4 5.6V17h5v-5h-2.8c.1-1.8 1-3 3.1-3.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  phone: (
    <path d="M5 4h4l2 5-2.1 1.6c.9 2 2.5 3.6 4.5 4.5L15 13l5 2v4a1.5 1.5 0 0 1-1.5 1.5C10.3 20.5 3.5 13.7 3.5 5.5A1.5 1.5 0 0 1 5 4z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4.5 7.5 7.5 6 7.5-6" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10z" />
      <circle cx="12" cy="10.8" r="2.4" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M12 3.5c-4.7 0-8.5 3.8-8.5 8.5 0 1.5.4 2.9 1.1 4.2L3.5 20.5l4.5-1.1a8.5 8.5 0 1 0 4-15.9z" />
      <path d="M9.4 8.6c-.3 2.3 1.9 5.6 5 7 .8-.1 1.3-.6 1.5-1.2.1-.3-.1-.5-.4-.6l-1.7-.8c-.2-.1-.4 0-.6.1l-.3.4c-.3-.1-1.3-.8-1.8-1.5-.1-.2-.1-.4 0-.5l.2-.4c.1-.1.2-.3 0-.5l-.8-1.8c-.2-.3-.5-.4-.8-.3z" strokeWidth="1.3" />
    </>
  ),
  instagram: (
    <>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <path
      d="M13.8 21v-7.1h2.4l.4-2.8h-2.8V9.2c0-.8.3-1.4 1.4-1.4h1.5V5.3c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.2H8.4v2.8h2.4V21z"
      fill="currentColor"
      stroke="none"
    />
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M3.5 5.5h17L14 13v6l-4 2v-8z" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="1.8" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6h12" />
      <path d="M8.5 12h12" />
      <path d="M8.5 18h12" />
      <circle cx="4" cy="6" r=".5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r=".5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  sort: (
    <>
      <path d="M7.5 4.5v15" />
      <path d="m4 8 3.5-3.5L11 8" />
      <path d="M16.5 19.5v-15" />
      <path d="m13 16 3.5 3.5L20 16" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.9A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-3 3.9M6.2 6.9C3.9 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 0 0 3.4-.6" />
      <path d="M10 10a2.6 2.6 0 0 0 3.7 3.7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <circle cx="9" cy="15" r=".6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="15" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 11 4.5 4.5L16.5 11" />
      <path d="M4 20h16" />
    </>
  ),
  printer: (
    <>
      <path d="M7 7.5V4h10v3.5" />
      <rect x="6" y="7.5" width="12" height="6.5" rx="1.5" />
      <rect x="7.5" y="14" width="9" height="6.5" rx="1.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10.5 13.5" />
      <path d="M19.5 13.5v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V6a1.5 1.5 0 0 1 1.5-1.5h5" />
    </>
  ),
  home: (
    <>
      <path d="m3.5 11 8.5-7.5L20.5 11" />
      <path d="M5.5 9.5V20h13V9.5" />
    </>
  ),
  box: (
    <>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M15.5 5a3.5 3.5 0 0 1 0 6.5" />
      <path d="M17 14.7c2 .7 3.5 2.6 3.5 5.3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M22 20H2" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h14" />
      <circle cx="9" cy="6" r="2" fill="var(--color-background)" />
      <circle cx="15" cy="12" r="2" fill="var(--color-background)" />
      <circle cx="7" cy="18" r="2" fill="var(--color-background)" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3.5V8h-4.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V5" />
      <path d="m7 9.5 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.5V3.5h9l8.5 8.5-8.5 8.5z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L20.5 7.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m15.5 6 3 3" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 21H5.5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 5.5 3h4" />
      <path d="M15.5 16.5 20 12l-4.5-4.5" />
      <path d="M20 12H9.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
      <path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  rupee: (
    <>
      <path d="M14.5 3.5H8.5v3.5h11" />
      <path d="M7.5 7h12M19.5 7 11 15" />
      <path d="M5 7h2.5v4a6.5 6.5 0 0 0 6.5 6.5h1" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.5 5.5 13 13" />
    </>
  ),
  wallet: (
    <>
      <path d="M5 5a2 2 0 0 1 2-2h13v14H7a2 2 0 0 1-2-2z" />
      <path d="M20 7v16H7a2 2 0 0 1-2-2" />
      <circle cx="16.5" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v8.5h14V12" />
      <path d="M12 8v12.5" />
      <path d="M12 8H8.2a2.7 2.7 0 0 1 0-5.4C10.5 2.6 11.5 5 12 8zM12 8h3.8a2.7 2.7 0 0 0 0-5.4C13.5 2.6 12.5 5 12 8z" />
    </>
  ),
  store: (
    <>
      <path d="M4 10v9.5h16V10" />
      <path d="M3.5 4.5h17L21.7 10H2.3z" />
      <path d="M5 7.5h14M15 10c0 1.5-1.2 2.5-3 2.5S9 11.5 9 10" />
    </>
  ),
  'search-x': (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.4-4.4" />
      <path d="m9.5 9.5 3 3" />
      <path d="m12.5 9.5-3 3" />
    </>
  ),
  'trend-up': (
    <>
      <path d="M3.5 17.5 10.5 10l4 4 6-6.5" />
      <path d="M15 7.5H20.5V13" />
    </>
  ),
  'trend-down': (
    <>
      <path d="M3.5 6.5 10.5 14l4-4 6 6.5" />
      <path d="M15 16.5H20.5V11" />
    </>
  ),
  'package-open': (
    <>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 9 11M21 7.5 15 11M12 12v9" />
      <path d="m7.5 9 -1.5 4 3 3 5.5-3.5" strokeWidth="1.2" />
    </>
  ),
}

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg {...STROKE} width={size} height={size} {...props}>
      {PATHS[name]}
    </svg>
  )
}