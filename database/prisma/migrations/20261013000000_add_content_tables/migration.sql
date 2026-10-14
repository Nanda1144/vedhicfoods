-- Content/CMS models (Testimonial, Faq, ProductReview, NewsletterSubscriber) were
-- declared in schema.prisma and existed in the live database (added out-of-band
-- during schema-drift repair) but were never captured by a migration. A fresh
-- `prisma migrate deploy` therefore produced a database with no `testimonials`,
-- `faqs`, `product_reviews` or `newsletter_subscribers` tables, and every admin
-- content CRUD call (plus storefront review/newsletter writes) failed with
-- P2021 "table does not exist". This migration records them.
--
-- Every statement is written defensively (IF NOT EXISTS / constraint existence
-- check) so it is a safe no-op on databases where the objects already exist,
-- including the live Supabase database.

-- CreateTable
CREATE TABLE IF NOT EXISTS "testimonials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "avatarUrl" TEXT,
    "avatarInitials" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "testimonials_isActive_idx" ON "testimonials"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "testimonials_isFeatured_sortOrder_idx" ON "testimonials"("isFeatured", "sortOrder");

-- CreateTable
CREATE TABLE IF NOT EXISTS "faqs" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "faqs_category_sortOrder_idx" ON "faqs"("category", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "faqs_isActive_idx" ON "faqs"("isActive");

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "isRejected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_reviews_productId_isApproved_idx" ON "product_reviews"("productId", "isApproved");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_reviews_isApproved_createdAt_idx" ON "product_reviews"("isApproved", "createdAt");

-- AddForeignKey (guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_productId_fkey') THEN
        ALTER TABLE "product_reviews"
            ADD CONSTRAINT "product_reviews_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "products"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'footer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_isActive_idx" ON "newsletter_subscribers"("isActive");

-- Missing foreign-key indexes (FK columns with no supporting index get a full
-- table scan on every join/cascade check): orders.addressId,
-- support_notifications.contactId and delivery_history.actorId.
CREATE INDEX IF NOT EXISTS "orders_addressId_idx" ON "orders"("addressId");

CREATE INDEX IF NOT EXISTS "support_notifications_contactId_idx" ON "support_notifications"("contactId");

CREATE INDEX IF NOT EXISTS "delivery_history_actorId_idx" ON "delivery_history"("actorId");
