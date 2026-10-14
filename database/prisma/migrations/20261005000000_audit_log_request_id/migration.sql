-- Audit trail hardening.
--
-- 1. `requestId` correlates an audit entry with the HTTP request that produced it
--    (the `x-request-id` header echoed by requestIdMiddleware), so a support
--    escalation can be traced from a customer report to the exact request.
ALTER TABLE "audit_logs" ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_requestId_idx" ON "audit_logs"("requestId");

-- The admin audit-log feed is always "newest first, filtered by a date window and
-- optionally by action / entity / actor". These composite indexes let PostgreSQL
-- satisfy the ORDER BY from the index instead of sorting the whole table.
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_action_idx" ON "audit_logs"("createdAt", "action");

CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_entity_idx" ON "audit_logs"("createdAt", "entity");

CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_actorId_idx" ON "audit_logs"("createdAt", "actorId");