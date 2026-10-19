import { RouterProvider } from 'react-router-dom'
import { ToastProvider, ToastViewport, CartProvider, AuthProvider, SettingsProvider } from '@/context'
import { ErrorBoundary, WelcomeSplash } from '@/components/common'
import { router } from '@/routes'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <CartProvider>
              <RouterProvider router={router} />
              <WelcomeSplash />
              <ToastViewport />
            </CartProvider>
          </AuthProvider>
        </SettingsProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}