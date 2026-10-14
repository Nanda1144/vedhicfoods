-- A contact submission escalates into at most one SupportTicket, which makes
-- ContactSubmission.ticketId a one-to-one relation on the ContactSubmission side.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_submissions_ticketId_key" ON "contact_submissions"("ticketId");