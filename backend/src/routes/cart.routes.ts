import { Router } from 'express'
import { CartController } from '../controllers/cart.controller'
import { DiscountController } from '../controllers/discount.controller'
import { optionalAuth } from '../middleware/auth.middleware'

const router = Router()

// All cart operations support both authenticated users and guest sessions
router.use(optionalAuth)

router.get('/', CartController.getCart)
router.post('/items', CartController.addItem)
router.patch('/items/:itemId', CartController.updateItem)
router.put('/items/:itemId', CartController.updateItem) // For backward compatibility
router.delete('/items/:itemId', CartController.removeItem)
router.delete('/', CartController.clearCart)
router.post('/validate', CartController.validateCart)
router.post('/merge', CartController.mergeCart)
router.post('/apply-coupon', DiscountController.applyCoupon)

export const cartRoutes = router
