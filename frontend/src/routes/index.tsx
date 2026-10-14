import { lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { CustomerLayout } from '@/layouts/CustomerLayout'
import { NotFoundPage } from '@/pages/customer/NotFoundPage'

export function lazyNamed<T extends ComponentType>(importFn: () => Promise<{ [name: string]: T }>, name: string) {
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

interface RoutePageProps {
  title: string
  children: ReactNode
}

function RoutePage({ title, children }: RoutePageProps) {
  useEffect(() => {
    document.title = title
  }, [title])
  return <>{children}</>
}

const titled = (Component: ComponentType, title: string) => (
  <RoutePage title={title}>
    <Component />
  </RoutePage>
)

export const router = createBrowserRouter([
  {
    element: <CustomerLayout />,
    children: [
      { path: '/', element: titled(HomePage, 'Home · Vedhic Foods') },
      { path: '/about', element: titled(AboutPage, 'Our story · Vedhic Foods') },
      { path: '/shop', element: titled(ShopPage, 'Shop · Vedhic Foods') },
      { path: '/categories', element: titled(CategoriesPage, 'Categories · Vedhic Foods') },
      { path: '/product/:slug', element: titled(ProductDetailPage, 'Product · Vedhic Foods') },
      { path: '/cart', element: titled(CartPage, 'Cart · Vedhic Foods') },
      { path: '/checkout', element: titled(CheckoutPage, 'Checkout · Vedhic Foods') },
      { path: '/order-success/:orderNumber', element: titled(OrderSuccessPage, 'Order confirmed · Vedhic Foods') },
      { path: '/invoice/:id', element: titled(InvoicePage, 'Invoice · Vedhic Foods') },
      { path: '/invoice/order/:orderNumber', element: titled(InvoicePage, 'Invoice · Vedhic Foods') },
      { path: '/contact', element: titled(ContactPage, 'Contact · Vedhic Foods') },
      { path: '/faq', element: titled(FaqPage, 'FAQ · Vedhic Foods') },
      { path: '/support', element: titled(SupportPage, 'Support · Vedhic Foods') },
      { path: '*', element: titled(NotFoundPage, 'Not found · Vedhic Foods') },
    ],
  },
])