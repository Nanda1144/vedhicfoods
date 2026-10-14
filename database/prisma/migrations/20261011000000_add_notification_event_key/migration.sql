-- Add a per-user idempotency key to in-app notifications.

-- A single logical business event (payment captured, order cancelled, delivery
-- phase reached, promotion published, support reply, staff change) must never
-- produce duplicate notification rows, even when the event is fired more than
-- once (webhook replay, retried admin action, concurrent processing). The
-- partial unique index on (userId, eventKey) is the database-enforced guard.

ALTER TABLE "notifications" ADD COLUMN "eventKey" TEXT;

CREATE UNIQUE INDEX "notifications_user_id_event_key"
  ON "notifications"("userId", "eventKey")
  WHERE "eventKey" IS NOT NULL;