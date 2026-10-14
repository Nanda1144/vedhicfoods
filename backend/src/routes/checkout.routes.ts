import { Router } from 'express'
import { CheckoutController } from '../controllers/checkout.controller'
import { requireAuth } from '../middleware/auth.middleware'

const router = Router()

// Primary Checkout endpoint (requires authenticated customer)
router.post('/', requireAuth, CheckoutController.checkout)

export const checkoutRoutes = router
