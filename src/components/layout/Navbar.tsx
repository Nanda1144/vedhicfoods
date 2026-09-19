import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { PRIMARY_NAV, ACCOUNT_MENU } from '@/data/navigation'
import { useCart, useSettings } from '@/context'
import { useMediaQuery, useOnClickOutside } from '@/hooks'
import { BREAKPOINTS } from '@/constants'
import { Icon, Logo, IconButton } from '../common'

interface NavbarProps {
  onOpenSearch: () => void
  onOpenMenu: () => void
  onOpenCart: () => void
}

export function Navbar({ onOpenSearch, onOpenMenu, onOpenCart }: NavbarProps) {
  const { count } = useCart()
  const { settings } = useSettings()
  const [scrolled, setScrolled] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`)

  useOnClickOutside([accountRef], () => setAccountOpen(false))

  const [didPop, setDidPop] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Subtle "pop" whenever an item is added to the basket.
  useEffect(() => {
    if (!count) return
    setDidPop(true)
    const timer = window.setTimeout(() => setDidPop(false), 500)
    return () => window.clearTimeout(timer)
  }, [count])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenSearch()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [onOpenSearch])

  return (
    <header className={cn('navbar', scrolled && 'is-scrolled')}>
      <div className="navbar__inner container">
        {!isDesktop && (
          <IconButton label="Open menu" onClick={onOpenMenu} className="navbar__menu-btn">
            <Icon name="menu" size={22} />
          </IconButton>
        )}

        <Logo size={isDesktop ? 'md' : 'sm'} tone="light" />

        {isDesktop && (
          <nav className="navbar__nav" aria-label="Primary">
            <ul className="navbar__list">
              {PRIMARY_NAV.map((link) => (
                <li key={link.href}>
                  <NavLink
                    to={link.href}
                    className={({ isActive }) => cn('navbar__link', isActive && 'is-active')}
                    end={link.href === '/'}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="navbar__actions">
          {!isDesktop && (
            <IconButton label="Search products" onClick={onOpenSearch}>
              <Icon name="search" size={21} />
            </IconButton>
          )}

          {isDesktop && (
            <button type="button" className="navbar__search" onClick={onOpenSearch} aria-label="Search products (Ctrl+K)" title="Search products (Ctrl+K)">
              <Icon name="search" size={18} />
            </button>
          )}

          {isDesktop && (
            <div className="navbar__account" ref={accountRef}>
              <button
                type="button"
                className="navbar__account-btn"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountOpen((current) => !current)}
              >
                <Icon name="user" size={19} />
                <span className="navbar__account-label">
                  <span className="navbar__account-title">Account</span>
                  <span className="navbar__account-sub">{settings.brandName}</span>
                </span>
                <Icon name="chevron-down" size={14} />
              </button>
              {accountOpen && (
                <div className="navbar__account-menu" role="menu" aria-label="Account menu">
                  {ACCOUNT_MENU.map((entry) => (
                    <Link key={entry.label} to={entry.href} className="navbar__account-item" role="menuitem" onClick={() => setAccountOpen(false)}>
                      <span className="navbar__account-item-label">{entry.label}</span>
                      <span className="navbar__account-item-desc">{entry.description}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <IconButton
            label="Open shopping cart"
            onClick={onOpenCart}
            className="navbar__cart-btn"
          >
            <Icon name="cart" size={21} />
            {count > 0 && (
              <span className={cn('navbar__cart-count', didPop && 'is-pop')} aria-live="polite">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </IconButton>
        </div>
      </div>
    </header>
  )
}