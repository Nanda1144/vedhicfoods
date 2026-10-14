import { RouterProvider } from 'react-router-dom'
import { ToastProvider, ToastViewport, CartProvider, AuthProvider, SettingsProvider } from '@/context'
import { router } from '@/routes'

export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <AuthProvider>
          <CartProvider>
            <RouterProvider router={router} />
            <ToastViewport />
          </CartProvider>
        </AuthProvider>
      </SettingsProvider>
    </ToastProvider>
  )
}