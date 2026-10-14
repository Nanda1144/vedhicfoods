import { Router } from 'express'
import { ContentController } from '../controllers/content.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { newsletterRateLimiter } from '../middleware/rate-limiter.middleware'
import { asyncHandler } from '../utils/async-handler'

// ==========================================
// PUBLIC STOREFRONT CONTENT
// Mounted at `/api/v1/content`
// ==========================================
const router = Router()

// Testimonials, FAQs and approved reviews are public read-only.
router.get('/testimonials', asyncHandler(ContentController.listTestimonials))
router.get('/faqs', asyncHandler(ContentController.listFaqs))
router.get('/reviews', asyncHandler(ContentController.listReviews))

// Writing a review requires a customer session; the row lands in the moderation
// queue (`isApproved: false`) and is surfaced only after staff approval.
router.post('/reviews', authenticate, asyncHandler(ContentController.submitReview))

// Public newsletter subscription, tightly rate-limited.
router.post('/newsletter', newsletterRateLimiter, asyncHandler(ContentController.subscribeNewsletter))

export const contentRoutes = router

// ==========================================
// ADMIN CONTENT MANAGEMENT
// Mounted at `/api/v1/admin/content`. The parent `admin.routes.ts` router has
// already enforced `authenticate` + staff role; the permission slugs below are
// the granular gate evaluated against the actor's resolved RBAC set.
// ==========================================
const adminRouter = Router()

adminRouter.get('/', requirePermission('content.read'), asyncHandler(ContentController.getSummary))

// Testimonials
adminRouter.get('/testimonials', requirePermission('content.read'), asyncHandler(ContentController.listAdminTestimonials))
adminRouter.post('/testimonials', requirePermission('content.update'), asyncHandler(ContentController.createTestimonial))
adminRouter.patch('/testimonials/:id', requirePermission('content.update'), asyncHandler(ContentController.updateTestimonial))
adminRouter.delete('/testimonials/:id', requirePermission('content.update'), asyncHandler(ContentController.deleteTestimonial))

// FAQs
adminRouter.get('/faqs', requirePermission('content.read'), asyncHandler(ContentController.listAdminFaqs))
adminRouter.get('/faq-categories', requirePermission('content.read'), asyncHandler(ContentController.listFaqCategories))
adminRouter.post('/faqs', requirePermission('content.update'), asyncHandler(ContentController.createFaq))
adminRouter.patch('/faqs/:id', requirePermission('content.update'), asyncHandler(ContentController.updateFaq))
adminRouter.delete('/faqs/:id', requirePermission('content.update'), asyncHandler(ContentController.deleteFaq))

// Review moderation
adminRouter.get('/reviews', requirePermission('content.read'), asyncHandler(ContentController.listAdminReviews))
adminRouter.patch('/reviews/:id', requirePermission('content.update'), asyncHandler(ContentController.moderateReview))
adminRouter.delete('/reviews/:id', requirePermission('content.update'), asyncHandler(ContentController.deleteReview))

// Newsletter subscribers
adminRouter.get('/newsletter', requirePermission('content.read'), asyncHandler(ContentController.listSubscribers))
adminRouter.post('/newsletter/:id/unsubscribe', requirePermission('content.update'), asyncHandler(ContentController.unsubscribeSubscriber))
adminRouter.delete('/newsletter/:id', requirePermission('content.update'), asyncHandler(ContentController.deleteSubscriber))

export const adminContentRoutes = adminRouter