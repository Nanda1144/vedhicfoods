import { lazy, type ComponentType } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { CustomerLayout } from '@/layouts/CustomerLayout'
import { NotFoundPage } from '@/pages/customer/NotFoundPage'
import { RouteErrorPage } from '@/pages/customer/RouteErrorPage'
import { SITE } from '@/config/site'
import { RoutePage } from './RoutePage'

function lazyNamed<T extends ComponentType>(importFn: () => Promise<{ [name: string]: T }>, name: string) {
  return lazy(async () => ({ default: (await importFn())[name] }))
}

const HomePage = lazyNamed(() => import('@/pages/customer/HomePage'), 'HomePage')
const AboutPage = lazyNamed(() => import('@/pages/customer/AboutPage'), 'AboutPage')
const CategoriesPage = lazyNamed(() => import('@/pages/customer/CategoriesPage'), 'CategoriesPage')
const ShopPage = lazyNamed(() => import('@/pages/customer/ShopPage'), 'ShopPage')
const ProductDetailPage = lazyNamed(() => import('@/pages/customer/ProductDetailPage'), 'ProductDetailPage')
const CartPage = lazyNamed(() => import('@/pages/customer/CartPage'), 'CartPage')
const CheckoutPage = lazyNamed(() => import('@/pages/customer/CheckoutPage'), 'CheckoutPage')
const OrderSuccessPage = lazyNamed(() => import('@/pages/customer/OrderSuccessPage'), 'OrderSuccessPage')
const InvoicePage = lazyNamed(() => import('@/pages/customer/InvoicePage'), 'InvoicePage')
const ContactPage = lazyNamed(() => import('@/pages/customer/ContactPage'), 'ContactPage')
const FaqPage = lazyNamed(() => import('@/pages/customer/FaqPage'), 'FaqPage')
const SupportPage = lazyNamed(() => import('@/pages/customer/SupportPage'), 'SupportPage')
const PrivacyPolicyPage = lazyNamed(() => import('@/pages/customer/PrivacyPolicyPage'), 'PrivacyPolicyPage')
const TermsPage = lazyNamed(() => import('@/pages/customer/TermsPage'), 'TermsPage')
const RefundPolicyPage = lazyNamed(() => import('@/pages/customer/RefundPolicyPage'), 'RefundPolicyPage')

type SeoOptions = { noIndex?: boolean; structuredData?: Record<string, unknown> }
const titled = (Component: ComponentType, title: string, description: string, options: SeoOptions = {}) => (
  <RoutePage title={title} description={description} {...options}>
    <Component />
  </RoutePage>
)

const homeSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE.brandName,
  url: SITE.url,
  logo: `${SITE.url}/favicon.svg`,
}

export const router = createBrowserRouter([
  {
    element: <CustomerLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: titled(HomePage, 'Vedhic Foods | Organic Indian Foods', 'Traditional organic Indian foods made in small batches. Shop millet laddus, ragi roti, cold-pressed oils and heritage grains.', { structuredData: homeSchema }) },
      { path: '/about', element: titled(AboutPage, 'Our Story | Vedhic Foods', 'Meet the farmers, family recipes and small-batch process behind Vedhic Foods.') },
      { path: '/shop', element: titled(ShopPage, 'Shop Organic Foods | Vedhic Foods', 'Browse organic millet laddus, ragi roti, traditional snacks and pantry staples from Vedhic Foods.') },
      { path: '/categories', element: titled(CategoriesPage, 'Food Categories | Vedhic Foods', 'Explore Vedhic Foods by category, from heritage grains and millets to traditional snacks.') },
      { path: '/product/:slug', element: titled(ProductDetailPage, 'Product | Vedhic Foods', 'Explore product details, ingredients, nutrition and availability from Vedhic Foods.') },
      { path: '/cart', element: titled(CartPage, 'Your Basket | Vedhic Foods', 'Review items in your Vedhic Foods basket before checkout.', { noIndex: true }) },
      { path: '/checkout', element: titled(CheckoutPage, 'Secure Checkout | Vedhic Foods', 'Enter delivery details and complete your Vedhic Foods order securely.', { noIndex: true }) },
      { path: '/order-success/:orderNumber', element: titled(OrderSuccessPage, 'Order Confirmed | Vedhic Foods', 'Your Vedhic Foods order confirmation.', { noIndex: true }) },
      { path: '/invoice/:id', element: titled(InvoicePage, 'Your Invoice | Vedhic Foods', 'View or download your Vedhic Foods invoice.', { noIndex: true }) },
      { path: '/invoice/order/:orderNumber', element: titled(InvoicePage, 'Your Invoice | Vedhic Foods', 'View or download your Vedhic Foods invoice.', { noIndex: true }) },
      { path: '/contact', element: titled(ContactPage, 'Contact Vedhic Foods', 'Get in touch with Vedhic Foods about products, orders and delivery.') },
      { path: '/faq', element: titled(FaqPage, 'Frequently Asked Questions | Vedhic Foods', 'Answers about Vedhic Foods products, ingredients, delivery and orders.') },
      { path: '/support', element: titled(SupportPage, 'Customer Support | Vedhic Foods', 'Contact Vedhic Foods support for help with your order.', { noIndex: true }) },
      { path: '/privacy', element: titled(PrivacyPolicyPage, 'Privacy Policy | Vedhic Foods', 'Read how Vedhic Foods collects, uses and protects customer information.') },
      { path: '/terms', element: titled(TermsPage, 'Terms of Service | Vedhic Foods', 'Review the terms for shopping with Vedhic Foods.') },
      { path: '/refund-policy', element: titled(RefundPolicyPage, 'Returns and Refunds | Vedhic Foods', 'Read Vedhic Foods cancellation, return and refund terms.') },
      { path: '*', element: titled(NotFoundPage, 'Page Not Found | Vedhic Foods', 'The page you requested could not be found.', { noIndex: true }) },
    ],
  },
])
