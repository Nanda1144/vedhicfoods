import { Router } from 'express'
import { ProductController } from '../controllers/product.controller'

const router = Router()

// Public Product Catalog Endpoints
router.get('/', ProductController.listProducts)
router.get('/slug/:slug', ProductController.getProduct)
router.get('/:id', ProductController.getProduct)

export const productRoutes = router
