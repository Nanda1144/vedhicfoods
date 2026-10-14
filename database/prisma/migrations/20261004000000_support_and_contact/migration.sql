-- ==========================================
-- CONTACT & CUSTOMER SUPPORT SUBSYSTEM
-- Adds: contact_submissions table, support_notifications table,
--       SupportTicket lifecycle columns, TicketStatus.WAITING_FOR_CUSTOMER
-- ==========================================

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('PORTAL', 'CONTACT_FORM', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "ContactSubmissionStatus" AS ENUM ('NEW', 'TRIAGED', 'SPAM', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- RenameTicketStatusEnumValue
-- WAITING_CUSTOMER -> WAITING_FOR_CUSTOMER (product requirement naming).
-- PostgreSQL has no "DROP VALUE", and ADD VALUE cannot be used in the same
-- transaction that adds it, so the enum type is rebuilt and swapped instead.
CREATE TYPE "TicketStatus_v2" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');

ALTER TABLE "support_tickets"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TicketStatus_v2"
    USING (
      CASE "status"::text
        WHEN 'WAITING_CUSTOMER' THEN 'WAITING_FOR_CUSTOMER'
        ELSE "status"::text
      END
    )::"TicketStatus_v2";

ALTER TABLE "support_tickets" ALTER COLUMN "status" SET DEFAULT 'OPEN';

DROP TYPE "TicketStatus";
ALTER TYPE "TicketStatus_v2" RENAME TO "TicketStatus";

-- AlterTable
ALTER TABLE "support_tickets"
  ADD COLUMN     "source" "TicketSource" NOT NULL DEFAULT 'PORTAL',
  ADD COLUMN     "category" TEXT,
  ADD COLUMN     "closedAt" TIMESTAMP(3),
  ADD COLUMN     "closedById" TEXT,
  ADD COLUMN     "closeReason" TEXT,
  ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
  ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "reopenedCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill lastMessageAt from the newest existing message (or creation time)
UPDATE "support_tickets" t
SET "lastMessageAt" = COALESCE(
  (SELECT MAX(m."createdAt") FROM "support_messages" m WHERE m."ticketId" = t."id"),
  t."createdAt"
);

-- AlterTable
ALTER TABLE "support_messages"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT,
    "message" TEXT NOT NULL,
    "status" "ContactSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "spamScore" INTEGER NOT NULL DEFAULT 0,
    "spamReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSpam" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "ticketId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "triagedById" TEXT,
    "triagedAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notifications" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "messageId" TEXT,
    "contactId" TEXT,
    "recipient" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "dedupeKey" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_submissions_reference_key" ON "contact_submissions"("reference");

-- CreateIndex
CREATE INDEX "contact_submissions_status_idx" ON "contact_submissions"("status");

-- CreateIndex
CREATE INDEX "contact_submissions_email_idx" ON "contact_submissions"("email");

-- CreateIndex
CREATE INDEX "contact_submissions_submittedAt_idx" ON "contact_submissions"("submittedAt");

-- CreateIndex
CREATE INDEX "contact_submissions_isSpam_idx" ON "contact_submissions"("isSpam");

-- CreateIndex
CREATE INDEX "contact_submissions_userId_idx" ON "contact_submissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "support_notifications_dedupeKey_key" ON "support_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "support_notifications_ticketId_idx" ON "support_notifications"("ticketId");

-- CreateIndex
CREATE INDEX "support_notifications_status_idx" ON "support_notifications"("status");

-- CreateIndex
CREATE INDEX "support_notifications_createdAt_idx" ON "support_notifications"("createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_assignedStaffId_idx" ON "support_tickets"("status", "assignedStaffId");

-- CreateIndex
CREATE INDEX "support_tickets_lastMessageAt_idx" ON "support_tickets"("lastMessageAt");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Granular RBAC permissions for the support & contact subsystems
INSERT INTO "permissions" ("id", "slug", "name", "module", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'support.read', 'View Support Tickets', 'support', 'Can view all customer support tickets and conversations', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support.reply', 'Reply To Support Tickets', 'support', 'Can post staff replies on customer support tickets', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support.update', 'Update Support Tickets', 'support', 'Can change ticket status, priority and resolution', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support.assign', 'Assign Support Tickets', 'support', 'Can assign support tickets to staff members', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support.close', 'Close Support Tickets', 'support', 'Can close and reopen customer support tickets', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'contacts.read', 'View Contact Submissions', 'contacts', 'Can view public contact form submissions', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'contacts.manage', 'Manage Contact Submissions', 'contacts', 'Can triage, archive and annotate contact submissions', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Grant the new support permissions to the STAFF role (OWNER/ADMIN hold every permission)
INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'STAFF'
  AND p."slug" IN (
    'support.read',
    'support.reply',
    'support.update',
    'support.assign',
    'support.close',
    'contacts.read',
    'contacts.manage'
  )
ON CONFLICT DO NOTHING;