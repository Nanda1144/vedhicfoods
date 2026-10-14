import { RouterProvider } from 'react-router-dom'
import { ToastProvider, ToastViewport, CartProvider, SettingsProvider } from '@/context'
import { router } from '@/routes'

export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <CartProvider>
          <RouterProvider router={router} />
          <ToastViewport />
        </CartProvider>
      </SettingsProvider>
    </ToastProvider>
  )
}