import { CATEGORIES } from './categories'

export interface NavLink {
  label: string
  href: string
}

export const PRIMARY_NAV: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Shop', href: '/shop' },
  { label: 'Categories', href: '/categories' },
  { label: 'Contact', href: '/contact' },
]

export const FOOTER_NAV: Record<
  string,
  { title: string; links: NavLink[] }
> = {
  shop: {
    title: 'Shop',
    links: CATEGORIES.map((category) => ({
      label: category.name,
      href: `/shop?category=${category.slug}`,
    })),
  },
  company: {
    title: 'Company',
    links: [
      { label: 'About us', href: '/about' },
      { label: 'Our story', href: '/about#story' },
      { label: 'Categories', href: '/categories' },
      { label: 'Contact', href: '/contact' },
      { label: 'Support', href: '/support' },
    ],
  },
  help: {
    title: 'Help',
    links: [
      { label: 'FAQs', href: '/faq' },
      { label: 'Shipping & delivery', href: '/faq#shipping' },
      { label: 'Returns & refunds', href: '/faq#returns' },
      { label: 'Track an order', href: '/support' },
      { label: 'Wholesale & gifting', href: '/faq#wholesale' },
    ],
  },
  legal: {
    title: 'Legal',
    links: [
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
      { label: 'Refund policy', href: '/refund-policy' },
    ],
  },
}

export interface AccountMenuEntry {
  label: string
  description: string
  href: string
}

export const ACCOUNT_MENU: AccountMenuEntry[] = [
  { label: 'Track an order', description: 'Order status & delivery', href: '/support' },
  { label: 'Invoices', description: 'Download GST invoices', href: '/support' },
  { label: 'FAQs & help', description: 'Shipping, returns & more', href: '/faq' },
  { label: 'Customer Support', description: 'Reach our team', href: '/contact' },
]