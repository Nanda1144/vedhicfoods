import { useEffect, useLayoutEffect, useState } from 'react'
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

interface BottomNavProps {
  onOpenSearch: () => void
  onOpenMenu: () => void
  onOpenCart: () => void
}

export function BottomNav({ onOpenSearch, onOpenMenu, onOpenCart }: BottomNavProps) {
  const { count } = useCart()

  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <ul className="bottom-nav__list">
        <li>
          <NavLink
            to="/"
            end
            className={({ isActive }) => cn('bottom-nav__item', isActive && 'is-active')}
          >
            <span className="bottom-nav__icon">
              <Icon name="home" size={20} />
            </span>
            <span>Home</span>
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/shop"
            className={({ isActive }) => cn('bottom-nav__item', isActive && 'is-active')}
          >
            <span className="bottom-nav__icon">
              <Icon name="grid" size={20} />
            </span>
            <span>Shop</span>
          </NavLink>
        </li>
        <li>
          <button type="button" className="bottom-nav__item" aria-label="Search products" onClick={onOpenSearch}>
            <span className="bottom-nav__icon">
              <Icon name="search" size={20} />
            </span>
            <span>Search</span>
          </button>
        </li>
        <li>
          <button type="button" className="bottom-nav__item" aria-label="Open shopping cart" onClick={onOpenCart}>
            <span className="bottom-nav__icon">
              <Icon name="cart" size={20} />
              {count > 0 && (
                <span className="bottom-nav__badge" aria-live="polite">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </span>
            <span>Cart</span>
          </button>
        </li>
        <li>
          <button type="button" className="bottom-nav__item" aria-label="Open menu and account" onClick={onOpenMenu}>
            <span className="bottom-nav__icon">
              <Icon name="user" size={20} />
            </span>
            <span>Account</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

export function CustomerLayout() {
  const location = useLocation()
  const { isOpen: cartOpen, close: closeCart, open: openCart } = useCart()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

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

  useEffect(() => {
    setMenuOpen(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

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
      <BottomNav
        onOpenSearch={() => setSearchOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenCart={openCart}
      />
    </div>
  )
}