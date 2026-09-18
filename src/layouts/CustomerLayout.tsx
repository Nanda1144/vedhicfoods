import { useEffect, useLayoutEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  AnnouncementBar,
  Navbar,
  Footer,
  CartDrawer,
  MobileNav,
  SearchOverlay,
  RouteOutlet,
} from '@/components/layout'
import { useCart } from '@/context'
import { SkipLink } from './SkipLink'

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
    </div>
  )
}