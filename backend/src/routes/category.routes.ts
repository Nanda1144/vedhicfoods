import { Router } from 'express'
import { CategoryController } from '../controllers/category.controller'

const router = Router()

// Public Category Endpoints
router.get('/', CategoryController.listCategories)
router.get('/slug/:idOrSlug', CategoryController.getCategory)
router.get('/:idOrSlug', CategoryController.getCategory)

export const categoryRoutes = router
