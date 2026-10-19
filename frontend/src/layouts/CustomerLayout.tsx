import { useLayoutEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AnnouncementBar,
  Navbar,
  Footer,
  CartDrawer,
  MobileNav,
  SearchOverlay,
  RouteOutlet,
} from '@/components/layout'
import { Icon } from '@/components/common'
import { cn } from '@/utils/cn'
import { useCart } from '@/context'
import { SkipLink } from './SkipLink'

const BOTTOM_NAV: Array<{ label: string; to: string; icon: 'home' | 'grid' | 'store' | 'phone' | 'info'; end?: boolean }> = [
  { label: 'Home', to: '/', icon: 'home', end: true },
  { label: 'Categories', to: '/categories', icon: 'grid' },
  { label: 'Shop', to: '/shop', icon: 'store' },
  { label: 'Contact Us', to: '/contact', icon: 'phone' },
  { label: 'About', to: '/about', icon: 'info' },
]

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <ul className="bottom-nav__list">
        {BOTTOM_NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn('bottom-nav__item', item.to === '/shop' && 'bottom-nav__item--shop', isActive && 'is-active')
              }
            >
              <span className="bottom-nav__icon">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="bottom-nav__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function CustomerLayout() {
  const location = useLocation()
  const { isOpen: cartOpen, close: closeCart, open: openCart } = useCart()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const locationKey = `${location.pathname}${location.search}`
  const [syncedLocation, setSyncedLocation] = useState(locationKey)

  // Close the mobile menu / search overlay on navigation (render-time reset).
  if (syncedLocation !== locationKey) {
    setSyncedLocation(locationKey)
    setMenuOpen(false)
    setSearchOpen(false)
  }

  useLayoutEffect(() => {
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1))
      if (target) {
        target.scrollIntoView({ behavior: 'instant', block: 'start' })
        return
      }
    }
    const previous = history.state?.usr as { scrollTo?: string } | undefined
    if (previous?.scrollTo) {
      document.getElementById(previous.scrollTo)?.scrollIntoView({ behavior: 'instant', block: 'start' })
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [location.pathname, location.search, location.hash])

  return (
    <div className="site">
      <SkipLink />
      <AnnouncementBar />
      <Navbar onOpenSearch={() => setSearchOpen(true)} onOpenMenu={() => setMenuOpen(true)} onOpenCart={openCart} />
      <main id="main" className="site__main">
        <RouteOutlet />
      </main>
      <Footer />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer open={cartOpen} onClose={closeCart} />
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <BottomNav />
    </div>
  )
}