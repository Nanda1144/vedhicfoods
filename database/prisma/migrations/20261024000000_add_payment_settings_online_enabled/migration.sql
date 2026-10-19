-- Admin-controlled switch for online payments (Razorpay).
--
-- Existing rows keep their current behaviour (online payments available), while
-- new installations start disabled until an operator explicitly configures and
-- enables the gateway. The column default is then set to false so a stale row
-- cannot silently re-enable payments.
ALTER TABLE "payment_settings"
ADD COLUMN "onlineEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "payment_settings"
ALTER COLUMN "onlineEnabled" SET DEFAULT false;
